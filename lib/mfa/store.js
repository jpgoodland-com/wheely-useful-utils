import crypto from "crypto";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretBox";
import { hashToken } from "@/lib/tokens";
import { getTrustedBaseUrl } from "@/lib/url";
import { isPrimaryUser } from "@/lib/users/identity";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { findRecoveryCode, generateRecoveryCodes } from "./recoveryCodes";
export { isMfaEnabled, mfaMethods, mfaStatus } from "./status";

/**
 * Multi-factor authentication (security plan H1).
 *
 * Factors live on the primary USER#<id> item only (never the username
 * pointer):
 *   mfaTotp            { secretEnc, enabledAt }   seed encrypted by secretBox
 *   mfaTotpLastStep    last accepted TOTP step (replay guard, condition key)
 *   mfaTotpPending     { secretEnc, expiresAtMs } during setup
 *   webauthnCredentials [{ id, publicKey, counter, transports, name, createdAt, lastUsedAt }]
 *   mfaRecovery        [sha256 of each unused recovery code]
 *   mfaVersion         bumped on every factor change (condition key)
 *
 * A login that passes the password (or provider) step but needs a second
 * factor gets a short-lived challenge instead of a session:
 *   MFACHAL#<sha256(token)>  { userId, amr, next, attempts, expiresAtMs, webauthnChallenge }
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SETUP_TTL_MS = 10 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
const RP_NAME = "Wheely Useful Utils";

const usersTable = () => TableNames.Users;
const userKey = (userId) => ({ PK: `USER#${userId}` });
const totpContext = (userId) => ({ userId, purpose: "totp" });

export async function getPrimaryUser(userId) {
  const { Item } = await docClient.send(new GetCommand({ TableName: usersTable(), Key: userKey(userId), ConsistentRead: true }));
  return isPrimaryUser(Item) && Item.userId === userId ? Item : null;
}

/** Conditional write on the user's factor state; fails if it changed meanwhile. */
async function updateFactors(user, set, remove = []) {
  const names = {};
  const values = { ":prev": user.mfaVersion ?? 0, ":next": (user.mfaVersion ?? 0) + 1 };
  const sets = ["mfaVersion = :next"];
  Object.entries(set).forEach(([k, v], i) => {
    sets.push(`#s${i} = :s${i}`);
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
  });
  const removes = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  // Items written before MFA existed have no mfaVersion yet.
  if (user.mfaVersion === undefined) {
    await docClient.send(new UpdateCommand({
      TableName: usersTable(), Key: userKey(user.userId),
      UpdateExpression: "SET mfaVersion = :zero", ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":zero": 0 },
    }));
  }
  await docClient.send(new UpdateCommand({
    TableName: usersTable(),
    Key: userKey(user.userId),
    UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
    ConditionExpression: "mfaVersion = :prev",
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: values,
  }));
}

// ── TOTP ─────────────────────────────────────────────────────────────────

export async function startTotpSetup(user) {
  const secret = generateTotpSecret();
  await updateFactors(user, {
    mfaTotpPending: { secretEnc: await encryptSecret(secret, totpContext(user.userId)), expiresAtMs: Date.now() + SETUP_TTL_MS },
  });
  return { secret, otpauthUrl: otpauthUrl({ secret, account: user.email || user.username }) };
}

/**
 * Confirms setup with a code from the app. Returns { recoveryCodes } (new
 * codes when the user had none), or null for a wrong/expired code.
 */
export async function confirmTotpSetup(user, code) {
  const pending = user.mfaTotpPending;
  if (!pending || Date.now() > pending.expiresAtMs) return null;
  const secret = await decryptSecret(pending.secretEnc, totpContext(user.userId));
  const step = verifyTotp(secret, code);
  if (step === null) return null;
  const fresh = user.mfaRecovery?.length ? null : generateRecoveryCodes();
  await updateFactors(
    user,
    {
      mfaTotp: { secretEnc: pending.secretEnc, enabledAt: new Date().toISOString() },
      mfaTotpLastStep: step,
      ...(fresh ? { mfaRecovery: fresh.hashes } : {}),
    },
    ["mfaTotpPending"]
  );
  return { recoveryCodes: fresh ? fresh.codes : null };
}

async function verifyUserTotp(user, code) {
  if (!user.mfaTotp) return false;
  const secret = await decryptSecret(user.mfaTotp.secretEnc, totpContext(user.userId));
  const lastStep = typeof user.mfaTotpLastStep === "number" ? user.mfaTotpLastStep : -1;
  const step = verifyTotp(secret, code, { lastStep });
  if (step === null) return false;
  try {
    // Two requests with the same code: only the first one wins.
    await docClient.send(new UpdateCommand({
      TableName: usersTable(), Key: userKey(user.userId),
      UpdateExpression: "SET mfaTotpLastStep = :step",
      ConditionExpression: "mfaTotpLastStep = :prev",
      ExpressionAttributeValues: { ":step": step, ":prev": lastStep },
    }));
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
  return true;
}

async function consumeRecoveryCode(user, code) {
  const index = findRecoveryCode(user.mfaRecovery, code);
  if (index < 0) return false;
  const remaining = user.mfaRecovery.filter((_, i) => i !== index);
  try {
    await updateFactors(user, { mfaRecovery: remaining });
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
  return true;
}

/** Checks a TOTP or recovery code (used by login and by step-up). */
export async function verifyCode(user, { method, code }) {
  if (method === "totp") return verifyUserTotp(user, code);
  if (method === "recovery") return consumeRecoveryCode(user, code);
  return false;
}

export async function removeTotp(user) {
  const keepRecovery = user.webauthnCredentials?.length > 0;
  await updateFactors(user, {}, ["mfaTotp", "mfaTotpPending", "mfaTotpLastStep", ...(keepRecovery ? [] : ["mfaRecovery"])]);
}

export async function regenerateRecoveryCodes(user) {
  const fresh = generateRecoveryCodes();
  await updateFactors(user, { mfaRecovery: fresh.hashes });
  return fresh.codes;
}

// ── Passkeys (WebAuthn) ──────────────────────────────────────────────────

/** Relying party for this deployment: the trusted base URL, never Host/Origin. */
export function relyingParty(req) {
  const origin = getTrustedBaseUrl(req);
  return { origin, rpID: new URL(origin).hostname };
}

const regKey = (userId) => ({ PK: `WEBAUTHNREG#${userId}` });

export async function startPasskeyRegistration(user, req) {
  const { rpID } = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email || user.username,
    userDisplayName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username,
    userID: new TextEncoder().encode(user.userId),
    attestationType: "none",
    excludeCredentials: (user.webauthnCredentials || []).map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await docClient.send(new PutCommand({
    TableName: usersTable(),
    Item: { ...regKey(user.userId), challenge: options.challenge, expiresAtMs: Date.now() + SETUP_TTL_MS, expiresAt: Math.ceil((Date.now() + SETUP_TTL_MS) / 1000) },
  }));
  return options;
}

/** Returns { recoveryCodes } on success (new codes if the user had none), or null. */
export async function finishPasskeyRegistration(user, req, response, name) {
  const { Item: pending } = await docClient.send(new GetCommand({ TableName: usersTable(), Key: regKey(user.userId), ConsistentRead: true }));
  // Single use: the challenge is gone whatever the outcome.
  await docClient.send(new DeleteCommand({ TableName: usersTable(), Key: regKey(user.userId) }));
  if (!pending || Date.now() > pending.expiresAtMs) return null;

  const { origin, rpID } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  const { credential } = verification.registrationInfo;
  const existing = user.webauthnCredentials || [];
  if (existing.some((c) => c.id === credential.id)) return null;
  const fresh = user.mfaRecovery?.length ? null : generateRecoveryCodes();
  await updateFactors(user, {
    webauthnCredentials: [
      ...existing,
      {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
        name: String(name || "Passkey").trim().slice(0, 40) || "Passkey",
        createdAt: new Date().toISOString(),
      },
    ],
    ...(fresh ? { mfaRecovery: fresh.hashes } : {}),
  });
  return { recoveryCodes: fresh ? fresh.codes : null };
}

export async function removePasskey(user, credentialId) {
  const existing = user.webauthnCredentials || [];
  const remaining = existing.filter((c) => c.id !== credentialId);
  if (remaining.length === existing.length) return false;
  const lastFactor = remaining.length === 0 && !user.mfaTotp;
  await updateFactors(user, { webauthnCredentials: remaining }, lastFactor ? ["mfaRecovery"] : []);
  return true;
}

async function passkeyOptions(user, req) {
  return generateAuthenticationOptions({
    rpID: relyingParty(req).rpID,
    allowCredentials: (user.webauthnCredentials || []).map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: "required",
  });
}

async function verifyPasskey(user, req, response, expectedChallenge) {
  const credential = (user.webauthnCredentials || []).find((c) => c.id === response?.id);
  if (!credential || !expectedChallenge) return false;
  const { origin, rpID } = relyingParty(req);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: credential.id, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports },
    });
  } catch {
    return false;
  }
  if (!result.verified) return false;
  const updated = (user.webauthnCredentials || []).map((c) =>
    c.id === credential.id ? { ...c, counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() } : c
  );
  try {
    await updateFactors(user, { webauthnCredentials: updated });
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
  return true;
}

// ── Login challenges ─────────────────────────────────────────────────────

const challengeKey = (token) => ({ PK: `MFACHAL#${hashToken(token)}` });

/** After the first factor passes: returns the token for the mfa_challenge cookie. */
export async function createLoginChallenge(user, { amr, next }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;
  await docClient.send(new PutCommand({
    TableName: usersTable(),
    Item: { ...challengeKey(token), userId: user.userId, amr, next: next || null, attempts: 0, expiresAtMs, expiresAt: Math.ceil(expiresAtMs / 1000) },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  return token;
}

export async function readLoginChallenge(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const { Item } = await docClient.send(new GetCommand({ TableName: usersTable(), Key: challengeKey(token), ConsistentRead: true }));
  if (!Item || Date.now() > Item.expiresAtMs || Item.attempts >= MAX_CHALLENGE_ATTEMPTS) return null;
  return Item;
}

export async function deleteLoginChallenge(token) {
  await docClient.send(new DeleteCommand({ TableName: usersTable(), Key: challengeKey(token) }));
}

/** Passkey options for a pending login; the challenge is kept on the login challenge item. */
export async function loginPasskeyOptions(token, challenge, user, req) {
  const options = await passkeyOptions(user, req);
  await docClient.send(new UpdateCommand({
    TableName: usersTable(), Key: challengeKey(token),
    UpdateExpression: "SET webauthnChallenge = :c",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: { ":c": options.challenge },
  }));
  return options;
}

/**
 * Checks the second factor for a pending login. Counts every attempt; the
 * challenge dies after MAX_CHALLENGE_ATTEMPTS, so codes can't be guessed.
 */
export async function verifyLoginChallenge(token, challenge, user, req, input) {
  await docClient.send(new UpdateCommand({
    TableName: usersTable(), Key: challengeKey(token),
    UpdateExpression: "SET attempts = :n",
    ConditionExpression: "attempts = :prev",
    ExpressionAttributeValues: { ":n": challenge.attempts + 1, ":prev": challenge.attempts },
  }));
  if (input.method === "webauthn") {
    // Each passkey challenge is single-use.
    await docClient.send(new UpdateCommand({ TableName: usersTable(), Key: challengeKey(token), UpdateExpression: "REMOVE webauthnChallenge" }));
    return verifyPasskey(user, req, input.response, challenge.webauthnChallenge);
  }
  return verifyCode(user, input);
}

// ── Step-up with a second factor ─────────────────────────────────────────

const reauthKey = (sid) => ({ PK: `REAUTHCHAL#${sid}` });

/** Passkey options for re-authenticating the current session. */
export async function reauthPasskeyOptions(sid, user, req) {
  const options = await passkeyOptions(user, req);
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;
  await docClient.send(new PutCommand({
    TableName: usersTable(),
    Item: { ...reauthKey(sid), userId: user.userId, challenge: options.challenge, expiresAtMs, expiresAt: Math.ceil(expiresAtMs / 1000) },
  }));
  return options;
}

/** Checks a second factor for step-up: TOTP/recovery code or a passkey assertion. */
export async function verifyReauthFactor(sid, user, req, input) {
  if (input.method !== "webauthn") return verifyCode(user, input);
  const { Item } = await docClient.send(new GetCommand({ TableName: usersTable(), Key: reauthKey(sid), ConsistentRead: true }));
  await docClient.send(new DeleteCommand({ TableName: usersTable(), Key: reauthKey(sid) }));
  if (!Item || Item.userId !== user.userId || Date.now() > Item.expiresAtMs) return false;
  return verifyPasskey(user, req, input.response, Item.challenge);
}
