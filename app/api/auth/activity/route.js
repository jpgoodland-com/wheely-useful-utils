import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { decodeCursor, encodeCursor, listAudit } from "@/lib/audit";

/** GET /api/auth/activity?cursor=: the signed-in user's own security events. */
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const scope = `user#${session.userId}`;
    const cursor = new URL(req.url).searchParams.get("cursor");
    const { records, next } = await listAudit(scope, { limit: 25, before: decodeCursor(cursor, scope) });
    return NextResponse.json(
      { records: records.map(({ action, ts, ip, ua, result, details }) => ({ action, at: ts.split("#")[0], ip, userAgent: ua, result, details })), next: encodeCursor(next) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("Activity list error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
