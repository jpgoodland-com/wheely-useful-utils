import { NextResponse } from "next/server";
import { readJsonLimited } from "@/lib/requestBody";
import { markSessionMfa, revokeAllSessions } from "@/lib/sessions/store";
import { finishPasskeyRegistration, getPrimaryUser, startPasskeyRegistration } from "@/lib/mfa/store";
import { mfaContext, mfaErrorResponse, statusResponse } from "@/lib/mfa/http";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

const MAX_PASSKEYS = 10;

/**
 * POST /api/auth/mfa/passkeys
 *   {}                       -> registration options (step-up required)
 *   { response, name }       -> finish registering the passkey
 */
export async function POST(req) {
  try {
    const { body, error } = await readJsonLimited(req, 32 * 1024);
    if (error) return error;

    if (!body.response) {
      const { user, response } = await mfaContext({ stepUp: true });
      if (response) return response;
      if ((user.webauthnCredentials || []).length >= MAX_PASSKEYS) {
        return NextResponse.json({ error: `You can register up to ${MAX_PASSKEYS} passkeys.` }, { status: 409 });
      }
      return NextResponse.json(await startPasskeyRegistration(user, req));
    }

    const { session, user, response } = await mfaContext();
    if (response) return response;
    if (typeof body.response !== "object") return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
    const result = await finishPasskeyRegistration(user, req, body.response, typeof body.name === "string" ? body.name : "");
    if (!result) return NextResponse.json({ error: "The passkey couldn't be registered. Please try again." }, { status: 400 });

    await markSessionMfa(session.sessionId);
    await revokeAllSessions(user.userId, { exceptSid: session.sessionId });
    await recordAudit(req, { action: "mfa.passkey_added", actorUserId: user.userId });
    logSecurityEvent("mfa_changed", { change: "passkey_added" });
    return statusResponse(await getPrimaryUser(user.userId), { recoveryCodes: result.recoveryCodes });
  } catch (e) {
    return mfaErrorResponse(e, "Passkey registration error");
  }
}
