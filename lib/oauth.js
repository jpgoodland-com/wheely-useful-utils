import crypto from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getTrustedBaseUrl } from "./url";

/**
 * OAuth provider configuration and helpers.
 *
 * Supports Google, Microsoft (Entra ID) and GitHub.
 * Client IDs / secrets are read from environment variables so they can be
 * injected via Secrets Manager in production or docker-compose locally.
 *
 * Google and Microsoft are OpenID Connect providers: identity comes from a
 * signed ID token (verified against the provider's JWKS, with PKCE and a
 * nonce), never from a profile API. An email is only returned as
 * `emailVerified: true` when the provider vouches for it:
 *   - Google: `email_verified === true`.
 *   - Microsoft: the `xms_edov` optional claim, or a personal (MSA)
 *     account, whose email Microsoft verifies. Work-account `mail` and
 *     `userPrincipalName` can be set to any value by a tenant admin
 *     ("nOAuth"), so they are never trusted. Enable `xms_edov` on the app
 *     registration (Token configuration → optional claims).
 *   - GitHub: only an address that is both primary and verified.
 */

const MICROSOFT_PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    scopes: "openid email profile",
    oidc: true,
    clientIdEnv: "OAUTH_GOOGLE_CLIENT_ID",
    clientSecretEnv: "OAUTH_GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    scopes: "openid email profile",
    oidc: true,
    clientIdEnv: "OAUTH_MICROSOFT_CLIENT_ID",
    clientSecretEnv: "OAUTH_MICROSOFT_CLIENT_SECRET",
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userinfoUrl: "https://api.github.com/user",
    emailsUrl: "https://api.github.com/user/emails",
    scopes: "read:user user:email",
    oidc: false,
    clientIdEnv: "OAUTH_GITHUB_CLIENT_ID",
    clientSecretEnv: "OAUTH_GITHUB_CLIENT_SECRET",
  },
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);

// Only RSA/EC signatures; never "none" or HMAC (which a client secret could forge).
const ALLOWED_ALGS = ["RS256", "PS256", "ES256"];

const jwksCache = new Map();
function jwksFor(provider) {
  if (!jwksCache.has(provider)) {
    jwksCache.set(provider, createRemoteJWKSet(new URL(PROVIDERS[provider].jwksUri)));
  }
  return jwksCache.get(provider);
}

/**
 * Determine the canonical base URL for the application from an incoming Request.
 * Respects reverse proxy headers (x-forwarded-proto, x-forwarded-host, host)
 * and production environment flags (FORCE_HTTPS, NODE_ENV, APP_DOMAIN).
 *
 * @param {Request} [req]
 * @returns {string} e.g. "https://wheel-app.example.com" or "http://localhost:3000"
 */
export function getBaseUrl(req) {
  return getTrustedBaseUrl(req);
}

/**
 * Check if the mock OAuth sandbox is enabled for the provider.
 * Never in production: a mock code would otherwise sign anyone in as any
 * email. Elsewhere it is on when OAUTH_MOCK=true, or in development when
 * the client ID is missing or a mock value.
 */
export function isMockEnabled(provider) {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.OAUTH_MOCK === "true") {
    return true;
  }
  if (process.env.NODE_ENV === "development") {
    const cfg = PROVIDERS[provider];
    if (cfg) {
      const clientId = process.env[cfg.clientIdEnv] || "";
      const clientSecret = process.env[cfg.clientSecretEnv] || "";
      if (!clientId || !clientSecret || clientId === "mock-client-id" || clientId.startsWith("mock-")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Return the provider config object, or null if unsupported.
 */
export function getProviderConfig(provider) {
  return PROVIDERS[provider] || null;
}

/**
 * Read client credentials from the environment for a given provider.
 * Returns { clientId, clientSecret } or throws if missing.
 */
export function getClientCredentials(provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unsupported OAuth provider: ${provider}`);
  const clientId = process.env[cfg.clientIdEnv] || "";
  const clientSecret = process.env[cfg.clientSecretEnv] || "";
  return { clientId, clientSecret };
}

/**
 * Fresh per-login secrets: `state` (CSRF), `nonce` (binds the ID token to
 * this login) and the PKCE `verifier`. The route keeps them in httpOnly
 * cookies and passes them back to exchangeCode/fetchUserProfile.
 */
export function createFlowSecrets() {
  const b64 = (n) => crypto.randomBytes(n).toString("base64url");
  return { state: b64(24), nonce: b64(24), verifier: b64(48) };
}

export function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Build the full authorization URL the browser should redirect to.
 *
 * @param {string} provider   One of 'google' | 'microsoft' | 'github'
 * @param {{state: string, nonce?: string, verifier?: string}} flow
 * @param {string} redirectUri  Absolute callback URL
 * @returns {string}
 */
export function getAuthUrl(provider, flow, redirectUri) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unsupported OAuth provider: ${provider}`);

  if (isMockEnabled(provider)) {
    const origin = new URL(redirectUri).origin;
    const params = new URLSearchParams({
      provider,
      state: flow.state,
      redirect_uri: redirectUri,
    });
    return `${origin}/auth/mock?${params.toString()}`;
  }

  const { clientId } = getClientCredentials(provider);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scopes,
    state: flow.state,
  });

  if (cfg.oidc) {
    params.set("nonce", flow.nonce);
    params.set("code_challenge", pkceChallenge(flow.verifier));
    params.set("code_challenge_method", "S256");
  }

  // Google requires prompt=consent for reliable offline refresh
  if (provider === "google") {
    params.set("prompt", "consent");
  }

  return `${cfg.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 *
 * @param {string} provider
 * @param {string} code
 * @param {string} redirectUri
 * @param {string} [verifier]  PKCE code verifier (OIDC providers)
 * @returns {Promise<{access_token: string, id_token?: string}>}
 */
export async function exchangeCode(provider, code, redirectUri, verifier) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unsupported OAuth provider: ${provider}`);

  if (isMockEnabled(provider) && code && code.startsWith("mock-code-")) {
    const parts = code.split("-");
    const emailEncoded = parts.slice(3).join("-");
    return { access_token: `mock-token-${provider}-${emailEncoded}` };
  }

  const { clientId, clientSecret } = getClientCredentials(provider);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (cfg.oidc) {
    if (!verifier) throw new Error(`Missing PKCE verifier for ${provider}`);
    body.set("code_verifier", verifier);
  }

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  // GitHub requires Accept: application/json to return JSON instead of form-encoded
  if (provider === "github") {
    headers["Accept"] = "application/json";
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!res.ok) {
    // Don't include the body: it can echo the code or client details.
    throw new Error(`Token exchange failed for ${provider}: ${res.status}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange for ${provider} returned no access token`);
  return { access_token: data.access_token, id_token: data.id_token };
}

/**
 * Verify an OIDC ID token: signature (provider JWKS), algorithm, issuer,
 * audience, expiry and nonce. Returns the claims or throws.
 */
export async function verifyIdToken(provider, idToken, nonce) {
  const cfg = PROVIDERS[provider];
  if (!cfg?.oidc) throw new Error(`${provider} is not an OIDC provider`);
  if (!idToken) throw new Error(`${provider} returned no ID token`);
  const { clientId } = getClientCredentials(provider);

  const { payload } = await jwtVerify(idToken, jwksFor(provider), {
    algorithms: ALLOWED_ALGS,
    audience: clientId,
    ...(cfg.issuers ? { issuer: cfg.issuers } : {}),
    clockTolerance: 60,
  });

  if (provider === "microsoft") {
    // The common endpoint issues tenant-specific issuers; it must match the
    // token's own tenant id.
    if (typeof payload.tid !== "string" || payload.iss !== `https://login.microsoftonline.com/${payload.tid}/v2.0`) {
      throw new Error("Microsoft ID token has an unexpected issuer");
    }
  }
  if (payload.azp && payload.azp !== clientId) throw new Error("ID token azp mismatch");
  if (!nonce || typeof payload.nonce !== "string" || payload.nonce.length !== nonce.length ||
      !crypto.timingSafeEqual(Buffer.from(payload.nonce), Buffer.from(nonce))) {
    throw new Error("ID token nonce mismatch");
  }
  return payload;
}

/**
 * Fetch the authenticated user's identity.
 *
 * @param {string} provider
 * @param {{access_token: string, id_token?: string}} tokens
 * @param {{nonce?: string}} [flow]
 * @returns {Promise<{ email: string, name: string, emailVerified: boolean, subject: string }>}
 */
export async function fetchUserProfile(provider, tokens, flow = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unsupported OAuth provider: ${provider}`);
  const accessToken = tokens?.access_token;

  if (isMockEnabled(provider) && accessToken && accessToken.startsWith(`mock-token-${provider}-`)) {
    const prefix = `mock-token-${provider}-`;
    const encoded = accessToken.substring(prefix.length);
    let email = "";
    try {
      email = Buffer.from(encoded, "base64").toString("utf-8");
      if (!email.includes("@")) {
        email = "mock-user@example.com";
      }
    } catch (e) {
      email = "mock-user@example.com";
    }
    const name = email.split("@")[0] || "Mock User";
    return { email, name, emailVerified: true, subject: `mock:${email}` };
  }

  if (cfg.oidc) {
    const claims = await verifyIdToken(provider, tokens?.id_token, flow.nonce);
    const email = typeof claims.email === "string" ? claims.email : "";
    let emailVerified = false;
    if (provider === "google") emailVerified = claims.email_verified === true;
    if (provider === "microsoft") {
      emailVerified = claims.xms_edov === true || claims.xms_edov === "true" || claims.tid === MICROSOFT_PERSONAL_TENANT;
    }
    const subject = provider === "microsoft" ? `${claims.tid}:${claims.oid || claims.sub}` : claims.sub;
    return { email, name: claims.name || email.split("@")[0], emailVerified, subject: String(subject) };
  }

  // GitHub (plain OAuth 2.0)
  const headers = { Authorization: `Bearer ${accessToken}`, "User-Agent": "wheel-app" };
  const res = await fetch(cfg.userinfoUrl, { headers });
  if (!res.ok) {
    throw new Error(`Userinfo fetch failed for ${provider}: ${res.status}`);
  }
  const data = await res.json();

  // The /user email is whatever the user made public and isn't marked as
  // verified, so always use /user/emails and require primary + verified.
  let email = "";
  const emailsRes = await fetch(cfg.emailsUrl, { headers });
  if (emailsRes.ok) {
    const emails = await emailsRes.json();
    const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
    email = primary?.email || "";
  }
  return {
    email,
    name: data.name || data.login || email.split("@")[0],
    emailVerified: Boolean(email),
    subject: String(data.id),
  };
}
