import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { readJsonLimited } from "@/lib/requestBody";
import { checkRateLimit } from "@/lib/rateLimit";
import { markSessionMfa, revokeAllSessions } from "@/lib/sessions/store";
import { confirmTotpSetup, getPrimaryUser, removeTotp, startTotpSetup } from "@/lib/mfa/store";
import { mfaContext, mfaErrorResponse, statusResponse } from "@/lib/mfa/http";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

// The secret is shown once; keep it out of every cache.
const noStore = { "Cache-Control": "no-store" };

/** POST /api/auth/mfa/totp: start authenticator-app setup. */
export async function POST() {
  try {
    const { user, response } = await mfaContext({ stepUp: true });
    if (response) return response;
    if (user.mfaTotp) return NextResponse.json({ error: "An authenticator app is already set up." }, { status: 409 });
    const { secret, otpauthUrl } = await startTotpSetup(user);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    return NextResponse.json({ secret, otpauthUrl, qrDataUrl }, { headers: noStore });
  } catch (e) {
    return mfaErrorResponse(e, "TOTP setup error");
  }
}

/** PUT /api/auth/mfa/totp { code }: confirm setup with a code from the app. */
export async function PUT(req) {
  try {
    const { session, user, response } = await mfaContext();
    if (response) return response;
    const { allowed } = checkRateLimit(`mfa-setup:${user.userId}`, 10, 15 * 60 * 1000);
    if (!allowed) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });

    const { body, error } = await readJsonLimited(req, 4096);
    if (error) return error;
    if (typeof body.code !== "string") return NextResponse.json({ error: "Enter the 6-digit code from your app." }, { status: 400 });

    const result = await confirmTotpSetup(user, body.code);
    if (!result) return NextResponse.json({ error: "That code didn't match. Check the time on your device and try again." }, { status: 400 });

    // This session just proved it holds the new factor; every other session
    // must sign in again with it.
    await markSessionMfa(session.sessionId);
    await revokeAllSessions(user.userId, { exceptSid: session.sessionId });
    await recordAudit(req, { action: "mfa.totp_enabled", actorUserId: user.userId });
    logSecurityEvent("mfa_changed", { change: "totp_enabled" });
    return statusResponse(await getPrimaryUser(user.userId), { recoveryCodes: result.recoveryCodes });
  } catch (e) {
    return mfaErrorResponse(e, "TOTP confirm error");
  }
}

/** DELETE /api/auth/mfa/totp: remove the authenticator app. */
export async function DELETE(req) {
  try {
    const { user, response } = await mfaContext({ stepUp: true });
    if (response) return response;
    if (!user.mfaTotp) return NextResponse.json({ error: "No authenticator app is set up." }, { status: 404 });
    await removeTotp(user);
    await recordAudit(req, { action: "mfa.totp_removed", actorUserId: user.userId });
    logSecurityEvent("mfa_changed", { change: "totp_removed" });
    return statusResponse(await getPrimaryUser(user.userId));
  } catch (e) {
    return mfaErrorResponse(e, "TOTP remove error");
  }
}
