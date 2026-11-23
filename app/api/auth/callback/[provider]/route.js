import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, fetchUserProfile, getBaseUrl, getProviderConfig } from "@/lib/oauth";
import { startSession } from "@/lib/sessions/store";
import { createLoginChallenge, getPrimaryUser, isMfaEnabled } from "@/lib/mfa/store";
import { setChallengeCookie } from "@/lib/mfa/challengeCookie";
import { recordAudit } from "@/lib/audit";
import { safeNextPath } from "@/lib/url";
import { docClient, TableNames } from "@/lib/dynamodb";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import crypto from "crypto";
import { isAllowlistedAdmin } from "@/lib/users/adminAllowlist";
import { findUserByEmail, findUserByUsername, isKeyTaken, normalizeEmail, USERNAME_RE } from "@/lib/users/identity";

/**
 * GET /api/auth/callback/[provider]
 *
 * Handles the OAuth callback after the user authorises with the provider.
 *
 * 1. Validates the CSRF state token
 * 2. Exchanges the authorization code (with the PKCE verifier) for tokens
 * 3. Verifies the identity (ID token signature + nonce for OIDC providers)
 * 4. Refuses emails the provider hasn't verified
 * 5. Finds or creates the user in DynamoDB
 * 6. Starts a server-side session (revoking any previous one)
 * 7. Redirects to the saved `next` path, or /dashboard
 */
const FLOW_COOKIES = ["oauth_state", "oauth_nonce", "oauth_verifier", "oauth_next"];

function clearFlowCookies(response) {
  for (const name of FLOW_COOKIES) {
    response.cookies.set({ name, value: "", httpOnly: true, path: "/api/auth/callback", maxAge: 0 });
  }
  // Older deployments set oauth_state on "/"
  response.cookies.set({ name: "oauth_state", value: "", httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

function safeEqual(a, b) {
  return typeof a === "string" && typeof b === "string" && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req, { params }) {
  const { provider } = await params;
  const baseUrl = getBaseUrl(req);
  const fail = (code) => clearFlowCookies(NextResponse.redirect(new URL(`/login?error=${code}`, baseUrl)));

  const cfg = getProviderConfig(provider);
  if (!cfg) {
    return NextResponse.redirect(new URL("/login?error=unsupported_provider", baseUrl));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // Provider returned an error (e.g. user denied consent)
  if (errorParam) {
    return fail(encodeURIComponent(errorParam.slice(0, 64)));
  }

  if (!code || !state) {
    return fail("missing_params");
  }

  // CSRF check — H3: constant-time comparison to prevent timing attacks
  const cookieStore = await cookies();
  if (!safeEqual(cookieStore.get("oauth_state")?.value, state)) {
    return fail("invalid_state");
  }

  try {
    // Build redirect URI (must match the one used in the initial request)
    const redirectUri = `${baseUrl}/api/auth/callback/${provider}`;

    const tokens = await exchangeCode(provider, code, redirectUri, cookieStore.get("oauth_verifier")?.value);
    const profile = await fetchUserProfile(provider, tokens, { nonce: cookieStore.get("oauth_nonce")?.value });

    if (!profile.email) {
      return fail("no_email");
    }
    // C2: an email the provider hasn't verified proves nothing about who
    // owns the mailbox, so it can't sign in to or create an account.
    if (profile.emailVerified !== true) {
      return fail("email_unverified");
    }

    const email = normalizeEmail(profile.email);
    let user = await findUserByEmail(email);

    if (user) {
      const providers = Array.isArray(user.oauthProviders) ? [...user.oauthProviders] : [];
      const wasUnverified = user.isVerified === false;
      if (!providers.includes(provider) || wasUnverified) {
        if (!providers.includes(provider)) providers.push(provider);
        // C5: an unverified account was never proven to belong to whoever
        // created it. The provider has now proven the mailbox, so the
        // account becomes theirs; any password the creator set is removed.
        const update = wasUnverified
          ? {
              UpdateExpression: "SET oauthProviders = :p, isVerified = :v, emailVerifiedAt = :t REMOVE password, verificationTokenHash, verificationTokenExpiry, expiresAt",
              ExpressionAttributeValues: { ":p": providers, ":v": true, ":t": new Date().toISOString() },
            }
          : {
              UpdateExpression: "SET oauthProviders = :p",
              ExpressionAttributeValues: { ":p": providers },
            };
        await docClient.send(new UpdateCommand({ TableName: TableNames.Users, Key: { PK: user.PK }, ...update }));
        // Also update the username pointer item
        if (user.username) {
          await docClient.send(new UpdateCommand({ TableName: TableNames.Users, Key: { PK: `USER#USERNAME#${user.username}` }, ...update }));
        }
      }
    } else {
      // A legacy item (an old username containing "@") still claims this
      // address; never create a second account under the same key.
      if (await isKeyTaken(email)) {
        return fail("account_conflict");
      }

      // New user — create account (no password, verified by the provider)
      const userId = crypto.randomUUID();
      const username = await generateUniqueUsername(email);

      let firstName = null;
      let lastName = null;
      if (profile.name) {
        const parts = String(profile.name).trim().split(/\s+/);
        firstName = parts[0]?.slice(0, 50) || null;
        lastName = parts.slice(1).join(" ").slice(0, 50) || null;
      }

      const userItem = {
        PK: `USER#${userId}`,
        userId,
        email,
        username,
        firstName,
        lastName,
        EmailOrUsername: email,
        isVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        isAdmin: isAllowlistedAdmin(email),
        authProvider: provider,
        oauthProviders: [provider],
        createdAt: new Date().toISOString(),
      };

      // Store primary user item
      await docClient.send(new PutCommand({
        TableName: TableNames.Users,
        Item: userItem,
        ConditionExpression: "attribute_not_exists(PK)",
      }));

      // Store username pointer
      await docClient.send(new PutCommand({
        TableName: TableNames.Users,
        Item: {
          ...userItem,
          PK: `USER#USERNAME#${username}`,
          EmailOrUsername: username,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }));

      user = userItem;
      await recordAudit(req, { action: "account.created", actorUserId: userId, details: { method: `oauth:${provider}` } });
    }

    const next = safeNextPath(cookieStore.get("oauth_next")?.value, "/dashboard");

    // A provider sign-in is the first factor only when the user has MFA.
    const primary = isMfaEnabled(user) ? user : await getPrimaryUser(user.userId);
    if (isMfaEnabled(primary)) {
      const challenge = await createLoginChallenge(primary, { amr: `oauth:${provider}`, next });
      const toMfa = NextResponse.redirect(new URL("/login/mfa", baseUrl));
      return clearFlowCookies(setChallengeCookie(toMfa, challenge));
    }

    const response = NextResponse.redirect(new URL(next, baseUrl));
    // Lax: the callback completes a cross-site redirect from the provider.
    await startSession(response, user, { amr: `oauth:${provider}`, req, sameSite: "lax" });

    return clearFlowCookies(response);
  } catch (error) {
    // Message only: errors can carry token or profile details.
    console.error(`OAuth callback error (${provider}):`, error?.message);
    return fail("oauth_failed");
  }
}

/**
 * Generate a unique, valid username from an email prefix.
 * If the base name is taken, append a random hex suffix.
 */
async function generateUniqueUsername(email) {
  let base = email.split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .substring(0, 20);
  if (base.length < 3) base = `user${base}`;

  const isFree = async (candidate) =>
    USERNAME_RE.test(candidate) && !(await findUserByUsername(candidate)) && !(await isKeyTaken(candidate));

  if (await isFree(base)) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}_${crypto.randomBytes(3).toString("hex")}`;
    if (await isFree(candidate)) return candidate;
  }
  return `user_${crypto.randomBytes(8).toString("hex")}`;
}
