import { NextResponse } from "next/server";
import { getPrimaryUser, removePasskey } from "@/lib/mfa/store";
import { mfaContext, mfaErrorResponse, statusResponse } from "@/lib/mfa/http";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

/** DELETE /api/auth/mfa/passkeys/:id: remove one of your passkeys. */
export async function DELETE(req, { params }) {
  try {
    const { user, response } = await mfaContext({ stepUp: true });
    if (response) return response;
    const { credentialId } = await params;
    if (!(await removePasskey(user, credentialId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await recordAudit(req, { action: "mfa.passkey_removed", actorUserId: user.userId });
    logSecurityEvent("mfa_changed", { change: "passkey_removed" });
    return statusResponse(await getPrimaryUser(user.userId));
  } catch (e) {
    return mfaErrorResponse(e, "Passkey remove error");
  }
}
