/**
 * Edge and race paths of the MFA store and helpers that the route tests
 * don't reach: concurrent use of one code, legacy user items, duplicate
 * passkeys, expired challenges, passkey step-up and error mapping.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
jest.mock("@simplewebauthn/server", () => ({
  ...jest.requireActual("@simplewebauthn/server"),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { docClient } from "@/lib/dynamodb";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secretBox";
import { generateRecoveryCodes } from "@/lib/mfa/recoveryCodes";
import { currentStep, generateTotpSecret, totpForStep } from "@/lib/mfa/totp";
import {
  confirmTotpSetup,
  finishPasskeyRegistration,
  getPrimaryUser,
  reauthPasskeyOptions,
  removePasskey,
  removeTotp,
  startPasskeyRegistration,
  startTotpSetup,
  verifyCode,
  verifyReauthFactor,
} from "@/lib/mfa/store";
import { challengeTokenFrom, clearChallengeCookie, setChallengeCookie } from "@/lib/mfa/challengeCookie";
import { mfaErrorResponse } from "@/lib/mfa/http";
import { consumeSharedLimit } from "@/lib/sharedRateLimit";
import { seedUser, USERS_TABLE } from "@/__tests__/helpers/users";

const req = new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } });
const user = () => docClient.get(USERS_TABLE, "USER#u1");

async function withTotp(extra = {}) {
  const secret = generateTotpSecret();
  docClient.put(USERS_TABLE, {
    ...user(),
    mfaTotp: { secretEnc: await encryptSecret(secret, { userId: "u1", purpose: "totp" }), enabledAt: "x" },
    mfaTotpLastStep: -1,
    mfaVersion: 1,
    ...extra,
  });
  return secret;
}

beforeEach(() => {
  docClient.reset();
  seedUser(docClient, { userId: "u1", username: "alice" });
  jest.clearAllMocks();
});

describe("TOTP races and legacy items", () => {
  it("lets only one of two concurrent requests use a code", async () => {
    const secret = await withTotp();
    const code = totpForStep(secret, currentStep());
    const stale = user();
    expect(await verifyCode(stale, { method: "totp", code })).toBe(true);
    // The second request read the user before the first wrote lastStep.
    expect(await verifyCode(stale, { method: "totp", code })).toBe(false);
  });

  it("starts setup on an item written before MFA existed (no mfaVersion)", async () => {
    expect(user().mfaVersion).toBeUndefined();
    const { secret } = await startTotpSetup(user());
    expect(user().mfaVersion).toBe(1);
    expect(await confirmTotpSetup(await getPrimaryUser("u1"), totpForStep(secret, currentStep()))).toMatchObject({ recoveryCodes: expect.any(Array) });
  });

  it("refuses to confirm without a pending setup", async () => {
    expect(await confirmTotpSetup(user(), "123456")).toBeNull();
  });

  it("keeps existing recovery codes when TOTP is added to a passkey user, and keeps them on TOTP removal", async () => {
    const { hashes } = generateRecoveryCodes();
    docClient.put(USERS_TABLE, { ...user(), mfaRecovery: hashes, webauthnCredentials: [{ id: "c", publicKey: "AQ", counter: 0 }], mfaVersion: 1 });
    const { secret } = await startTotpSetup(user());
    const result = await confirmTotpSetup(await getPrimaryUser("u1"), totpForStep(secret, currentStep()));
    expect(result.recoveryCodes).toBeNull();
    await removeTotp(await getPrimaryUser("u1"));
    expect(user().mfaRecovery).toEqual(hashes);
  });

  it("lets only one of two concurrent requests use a recovery code", async () => {
    const { codes, hashes } = generateRecoveryCodes();
    await withTotp({ mfaRecovery: hashes });
    const stale = user();
    expect(await verifyCode(stale, { method: "recovery", code: codes[1] })).toBe(true);
    expect(await verifyCode(stale, { method: "recovery", code: codes[2] })).toBe(false);
  });

  it("rejects unknown methods", async () => {
    expect(await verifyCode(user(), { method: "sms", code: "1" })).toBe(false);
  });
});

describe("passkeys", () => {
  const credential = { id: "cred-1", publicKey: new Uint8Array([1]), counter: 0, transports: [] };

  it("refuses a registration whose challenge expired", async () => {
    await startPasskeyRegistration(user(), req);
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "WEBAUTHNREG#u1"), expiresAtMs: Date.now() - 1 });
    verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo: { credential } });
    expect(await finishPasskeyRegistration(user(), req, { id: "x" }, "k")).toBeNull();
  });

  it("refuses an unverified registration and a duplicate credential", async () => {
    await startPasskeyRegistration(user(), req);
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    expect(await finishPasskeyRegistration(user(), req, { id: "x" }, "k")).toBeNull();

    docClient.put(USERS_TABLE, { ...user(), webauthnCredentials: [{ id: "cred-1", publicKey: "AQ", counter: 0 }], mfaVersion: 1 });
    await startPasskeyRegistration(user(), req);
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: true, registrationInfo: { credential } });
    expect(await finishPasskeyRegistration(user(), req, { id: "cred-1" }, "k")).toBeNull();
  });

  it("names a passkey safely", async () => {
    await startPasskeyRegistration(user(), req);
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: true, registrationInfo: { credential } });
    await finishPasskeyRegistration(user(), req, { id: "cred-1" }, "   ");
    expect(user().webauthnCredentials[0].name).toBe("Passkey");
  });

  it("removing a passkey that isn't there is a no-op", async () => {
    expect(await removePasskey(user(), "nope")).toBe(false);
  });

  describe("step-up", () => {
    beforeEach(() => {
      docClient.put(USERS_TABLE, { ...user(), webauthnCredentials: [{ id: "cred-1", publicKey: "AQ", counter: 2 }], mfaVersion: 1 });
    });

    it("verifies against the session's own challenge, once", async () => {
      const options = await reauthPasskeyOptions("sid-1", user(), req);
      verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } });
      expect(await verifyReauthFactor("sid-1", user(), req, { method: "webauthn", response: { id: "cred-1" } })).toBe(true);
      expect(verifyAuthenticationResponse.mock.calls[0][0].expectedChallenge).toBe(options.challenge);
      expect(await verifyReauthFactor("sid-1", user(), req, { method: "webauthn", response: { id: "cred-1" } })).toBe(false);
    });

    it("refuses another session's challenge, an expired one, or a failed assertion", async () => {
      await reauthPasskeyOptions("sid-1", user(), req);
      verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } });
      expect(await verifyReauthFactor("sid-2", user(), req, { method: "webauthn", response: { id: "cred-1" } })).toBe(false);

      await reauthPasskeyOptions("sid-1", user(), req);
      docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "REAUTHCHAL#sid-1"), expiresAtMs: Date.now() - 1 });
      expect(await verifyReauthFactor("sid-1", user(), req, { method: "webauthn", response: { id: "cred-1" } })).toBe(false);

      await reauthPasskeyOptions("sid-1", user(), req);
      verifyAuthenticationResponse.mockRejectedValueOnce(new Error("bad signature"));
      expect(await verifyReauthFactor("sid-1", user(), req, { method: "webauthn", response: { id: "cred-1" } })).toBe(false);
    });
  });
});

describe("helpers", () => {
  it("reads the challenge cookie only by its exact name", () => {
    const h = (cookie) => new Request("http://x", { headers: cookie ? { cookie } : {} });
    expect(challengeTokenFrom(h("a=1; mfa_challenge=tok%3D"))).toBe("tok=");
    expect(challengeTokenFrom(h("xmfa_challenge=no"))).toBeNull();
    expect(challengeTokenFrom(h())).toBeNull();
  });

  it("sets and clears the challenge cookie scoped to the MFA API", () => {
    const res = { cookies: { set: jest.fn() } };
    setChallengeCookie(res, "t");
    clearChallengeCookie(res);
    expect(res.cookies.set.mock.calls[0][0]).toMatchObject({ name: "mfa_challenge", path: "/api/auth/mfa", httpOnly: true, maxAge: 300 });
    expect(res.cookies.set.mock.calls[1][0]).toMatchObject({ name: "mfa_challenge", maxAge: 0 });
  });

  it("maps a lost write race to 409 and hides other errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(mfaErrorResponse({ name: "ConditionalCheckFailedException" }, "x").status).toBe(409);
    const res = mfaErrorResponse(new Error("secret detail"), "x");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });

  it("treats a counter write without returned attributes as the first hit", async () => {
    docClient.beforeSend = (name, input) => { if (name === "UpdateCommand") delete input.ReturnValues; };
    expect(await consumeSharedLimit("k", 1, 60_000)).toMatchObject({ allowed: true, hits: 1 });
  });
});

describe("secretBox configuration", () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it("uses LOCAL_SECRET_KEY when set, and rejects a wrong-length key", async () => {
    process.env.LOCAL_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
    const blob = await encryptSecret("s", { userId: "u", purpose: "p" });
    expect(await decryptSecret(blob, { userId: "u", purpose: "p" })).toBe("s");
    delete process.env.LOCAL_SECRET_KEY;
    await expect(decryptSecret(blob, { userId: "u", purpose: "p" })).rejects.toThrow();
    process.env.LOCAL_SECRET_KEY = Buffer.alloc(16).toString("base64");
    await expect(encryptSecret("s", { userId: "u", purpose: "p" })).rejects.toThrow(/32 bytes/);
  });

  it("rejects values in an unknown format", async () => {
    await expect(decryptSecret("plain:abc", { userId: "u", purpose: "p" })).rejects.toThrow(/unknown format/);
    await expect(decryptSecret(undefined, { userId: "u", purpose: "p" })).rejects.toThrow();
  });
});

describe("unexpected DynamoDB errors are not swallowed", () => {
  const boom = () => Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });

  it("TOTP and recovery checks rethrow anything but a lost condition", async () => {
    const { codes, hashes } = generateRecoveryCodes();
    const secret = await withTotp({ mfaRecovery: hashes });
    docClient.beforeSend = (name) => { if (name === "UpdateCommand") throw boom(); };
    await expect(verifyCode(user(), { method: "totp", code: totpForStep(secret, currentStep()) })).rejects.toThrow(/throttled/);
    await expect(verifyCode(user(), { method: "recovery", code: codes[0] })).rejects.toThrow(/throttled/);
  });

  it("a passkey counter update that loses a race fails the check; other errors rethrow", async () => {
    docClient.put(USERS_TABLE, { ...user(), webauthnCredentials: [{ id: "cred-1", publicKey: "AQ", counter: 2 }], mfaVersion: 1 });
    verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } });
    const stale = user();
    docClient.put(USERS_TABLE, { ...user(), mfaVersion: 2 });
    await reauthPasskeyOptions("sid-1", stale, req);
    expect(await verifyReauthFactor("sid-1", stale, req, { method: "webauthn", response: { id: "cred-1" } })).toBe(false);

    await reauthPasskeyOptions("sid-1", user(), req);
    docClient.beforeSend = (name) => { if (name === "UpdateCommand") throw boom(); };
    await expect(verifyReauthFactor("sid-1", user(), req, { method: "webauthn", response: { id: "cred-1" } })).rejects.toThrow(/throttled/);
  });
});

describe("mfaContext", () => {
  it("refuses without a session or when the user record is gone", async () => {
    jest.resetModules();
    jest.doMock("@/lib/session", () => ({ ...jest.requireActual("@/lib/session"), getSession: jest.fn() }));
    const { getSession } = require("@/lib/session");
    const { mfaContext } = require("@/lib/mfa/http");
    getSession.mockResolvedValueOnce(null);
    expect((await mfaContext()).response.status).toBe(401);
    getSession.mockResolvedValueOnce({ userId: "ghost", authAt: Date.now() });
    expect((await mfaContext({ stepUp: true })).response.status).toBe(401);
  });
});
