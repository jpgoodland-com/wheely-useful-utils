import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { getSession } from "@/lib/session";
import { consumeSharedLimit, retryAfterSeconds } from "@/lib/sharedRateLimit";
import { logSecurityEvent } from "@/lib/securityLog";
import { getClientIp } from "@/lib/clientIp";
import { readJsonLimited } from "@/lib/requestBody";
import { markReauthenticated } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { getPrimaryUser, isMfaEnabled, verifyReauthFactor } from "@/lib/mfa/store";

const FACTOR_METHODS = new Set(["totp", "recovery", "webauthn"]);

/**
 * POST /api/auth/reauth { password?, method?, code?, response? }
 *
 * Step-up for sensitive actions. The user proves everything their account
 * has: the password if it has one, and a second factor (TOTP, recovery
 * code or passkey) if MFA is set up. Accounts with neither re-authenticate
 * by signing in with their provider again, which starts a fresh session
 * (see components/ReauthDialog.js).
 */
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = getClientIp(req.headers);
  // Keyed per user as well as per IP, so one account can't be brute-forced
  // from many addresses through this endpoint.
  const { allowed, resetMs } = await consumeSharedLimit(`reauth:${session.userId}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429, headers: { "Retry-After": retryAfterSeconds(resetMs) } });
  }

  const { body, error } = await readJsonLimited(req, 16 * 1024);
  if (error) return error;

  try {
    const user = await getPrimaryUser(session.userId);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const mfa = isMfaEnabled(user);

    if (!user.password && !mfa) {
      return NextResponse.json({ error: "This account signs in with a provider. Continue with it to confirm." }, { status: 400 });
    }
    if (user.password && (typeof body.password !== "string" || !body.password)) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    if (mfa && !FACTOR_METHODS.has(body.method)) {
      return NextResponse.json({ error: "Enter a code from your authenticator app or use a passkey." }, { status: 400 });
    }

    const passwordOk = user.password ? await bcrypt.compare(body.password, user.password) : true;
    // Check the factor only after the password, so a wrong password can't be
    // used to burn the user's codes.
    const factorOk = passwordOk && mfa
      ? await verifyReauthFactor(session.sessionId, user, req, { method: body.method, code: typeof body.code === "string" ? body.code : undefined, response: body.response })
      : true;

    if (!passwordOk || !factorOk) {
      logSecurityEvent("login_failed", { ip, reason: "reauth" });
      return NextResponse.json({ error: !passwordOk ? "Incorrect password" : "That code didn't work" }, { status: 401 });
    }
    await markReauthenticated(session.sessionId);
    await recordAudit(req, { action: "auth.reauthenticated", actorUserId: session.userId, details: { method: mfa ? body.method : "pwd" } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Reauth error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
