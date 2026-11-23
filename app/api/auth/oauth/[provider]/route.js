import { NextResponse } from "next/server";
import { createFlowSecrets, getAuthUrl, getBaseUrl, getProviderConfig } from "@/lib/oauth";
import { safeNextPath } from "@/lib/url";

/**
 * GET /api/auth/oauth/[provider]
 *
 * Initiates the OAuth flow by redirecting the browser to the provider's
 * authorization endpoint. The flow secrets (state for CSRF, nonce for the
 * ID token, PKCE verifier) are kept in short-lived httpOnly cookies scoped
 * to the callback path.
 */
export async function GET(req, { params }) {
  const { provider } = await params;

  const cfg = getProviderConfig(provider);
  if (!cfg) {
    return NextResponse.json(
      { error: `Unsupported OAuth provider: ${provider}` },
      { status: 400 }
    );
  }

  // Build the callback URL using the canonical base URL
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/callback/${provider}`;

  const flow = createFlowSecrets();
  const authUrl = getAuthUrl(provider, flow, redirectUri);

  const response = NextResponse.redirect(authUrl);
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/callback",
    maxAge: 60 * 10, // 10 minutes
    sameSite: "lax", // Lax required — callback is a cross-site redirect
  };
  response.cookies.set({ ...cookie, name: "oauth_state", value: flow.state });
  response.cookies.set({ ...cookie, name: "oauth_nonce", value: flow.nonce });
  response.cookies.set({ ...cookie, name: "oauth_verifier", value: flow.verifier });
  // Where to land afterwards (e.g. back to a settings page after re-auth).
  // Only same-site paths are kept.
  const next = safeNextPath(new URL(req.url).searchParams.get("next"), "");
  if (next) response.cookies.set({ ...cookie, name: "oauth_next", value: next });

  return response;
}
