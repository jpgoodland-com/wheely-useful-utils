import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listSessions, revokeAllSessions } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

/** GET /api/auth/sessions: where the current user is signed in. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sessions = await listSessions(session.userId);
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.sid,
        current: s.sid === session.sessionId,
        createdAt: new Date(s.createdAt).toISOString(),
        lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        method: s.amr,
        ip: s.ip,
        userAgent: s.ua,
      })),
    });
  } catch (e) {
    console.error("List sessions error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

/** DELETE /api/auth/sessions: sign out everywhere except this browser. */
export async function DELETE(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const revoked = await revokeAllSessions(session.userId, { exceptSid: session.sessionId });
    await recordAudit(req, { action: "auth.sessions_revoked", actorUserId: session.userId, details: { count: revoked } });
    logSecurityEvent("sessions_revoked", { count: revoked });
    return NextResponse.json({ success: true, revoked });
  } catch (e) {
    console.error("Revoke sessions error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
