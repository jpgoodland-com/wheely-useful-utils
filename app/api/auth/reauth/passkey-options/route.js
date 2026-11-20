import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPrimaryUser, reauthPasskeyOptions } from "@/lib/mfa/store";

/** POST /api/auth/reauth/passkey-options: WebAuthn options to confirm it's you. */
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const user = await getPrimaryUser(session.userId);
    if (!user?.webauthnCredentials?.length) return NextResponse.json({ error: "No passkeys are set up." }, { status: 404 });
    return NextResponse.json(await reauthPasskeyOptions(session.sessionId, user, req));
  } catch (e) {
    console.error("Reauth passkey options error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
