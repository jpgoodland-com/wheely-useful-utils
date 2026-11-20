import { NextResponse } from "next/server";
import { clearSessionCookie, readSession, revokeSession, sessionTokenFrom } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { hashToken } from "@/lib/tokens";

export async function POST(req) {
  const response = NextResponse.json({ success: true });
  try {
    // Delete the session server-side, so a copied cookie stops working too.
    const token = sessionTokenFrom(req);
    if (token) {
      const found = await readSession(token);
      await revokeSession(hashToken(token));
      if (found) await recordAudit(req, { action: "auth.logout", actorUserId: found.user.userId });
    }
  } catch (error) {
    console.error("Logout error:", error?.message);
  }
  return clearSessionCookie(response);
}
