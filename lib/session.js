import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasRecentAuth, readSession, sessionCookieName } from "./sessions/store";
import { isMfaEnabled, mfaMethods } from "./mfa/status";

/**
 * The signed-in user for this request, or null.
 *
 * Reads the server-side session on every call (lib/sessions/store.js), so
 * revocation and admin changes take effect on the next request. The shape
 * is the one routes have always used, plus:
 *   sessionId  id of the current session (for revoke / re-auth)
 *   authAt     epoch ms of the last password or provider check
 *   amr        how this session signed in
 *   hasPassword, oauthProviders  which re-auth methods the user has
 *   mfa        this session passed a second factor
 *   mfaEnabled the account has a second factor set up
 *   adminMfaRequired  the account is an admin but this session has no MFA,
 *              so admin rights are withheld (isAdmin is false) until it does
 */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return null;
  const found = await readSession(token);
  if (!found) return null;
  const { session, user } = found;
  return {
    userId: user.userId,
    email: user.email,
    username: user.username,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    // Platform admin needs MFA (security plan H1): without it, admin rights
    // are withheld rather than granted on a password alone.
    isAdmin: user.isAdmin === true && session.mfa === true,
    adminMfaRequired: user.isAdmin === true && session.mfa !== true,
    sessionId: session.sid,
    authAt: session.authAt,
    amr: session.amr,
    hasPassword: Boolean(user.password),
    oauthProviders: Array.isArray(user.oauthProviders) ? user.oauthProviders : [],
    mfa: session.mfa === true,
    mfaEnabled: isMfaEnabled(user),
    mfaMethods: mfaMethods(user),
  };
}

/**
 * Step-up check for sensitive actions (security plan H4). Returns null when
 * the session re-authenticated recently, otherwise a 401 the client answers
 * by asking the user to confirm who they are (components/ReauthDialog.js).
 */
export function requireRecentAuth(session) {
  if (hasRecentAuth(session)) return null;
  return NextResponse.json(
    { error: "Please confirm it's you to continue.", reauthRequired: true },
    { status: 401 }
  );
}
