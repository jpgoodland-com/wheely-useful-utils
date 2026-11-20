import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listSessions, revokeSession } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";

/** DELETE /api/auth/sessions/:id: sign out one of your own sessions. */
export async function DELETE(req, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  try {
    // Only ids from the caller's own list can be revoked; anything else is
    // reported as not found, so other users' session ids can't be probed.
    const own = await listSessions(session.userId);
    if (!own.some((s) => s.sid === sessionId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await revokeSession(sessionId);
    await recordAudit(req, { action: "auth.session_revoked", actorUserId: session.userId, details: { current: sessionId === session.sessionId } });
    return NextResponse.json({ success: true, current: sessionId === session.sessionId });
  } catch (e) {
    console.error("Revoke session error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
