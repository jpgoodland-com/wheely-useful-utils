import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { decodeCursor, encodeCursor, listAudit } from "@/lib/audit";

/** GET /api/admin/audit?cursor=: platform audit log, newest first (admins). */
export async function GET(req) {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const cursor = new URL(req.url).searchParams.get("cursor");
    const { records, next } = await listAudit("platform", { limit: 50, before: decodeCursor(cursor, "platform") });
    return NextResponse.json({ records, next: encodeCursor(next) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Audit list error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
