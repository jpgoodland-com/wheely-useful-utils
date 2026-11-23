import { NextResponse } from "next/server";
import { getPrimaryUser, isMfaEnabled, regenerateRecoveryCodes } from "@/lib/mfa/store";
import { mfaContext, mfaErrorResponse, statusResponse } from "@/lib/mfa/http";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

/** POST /api/auth/mfa/recovery-codes: replace all recovery codes (shown once). */
export async function POST(req) {
  try {
    const { user, response } = await mfaContext({ stepUp: true });
    if (response) return response;
    if (!isMfaEnabled(user)) return NextResponse.json({ error: "Set up an authenticator app or passkey first." }, { status: 409 });
    const recoveryCodes = await regenerateRecoveryCodes(user);
    await recordAudit(req, { action: "mfa.recovery_regenerated", actorUserId: user.userId });
    logSecurityEvent("mfa_changed", { change: "recovery_regenerated" });
    return statusResponse(await getPrimaryUser(user.userId), { recoveryCodes });
  } catch (e) {
    return mfaErrorResponse(e, "Recovery codes error");
  }
}
