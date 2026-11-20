import { NextResponse } from "next/server";
import { getPrimaryUser, loginPasskeyOptions, readLoginChallenge } from "@/lib/mfa/store";
import { challengeTokenFrom } from "@/lib/mfa/challengeCookie";

/** POST /api/auth/mfa/passkey-options: WebAuthn options for the pending sign-in. */
export async function POST(req) {
  try {
    const token = challengeTokenFrom(req);
    const challenge = await readLoginChallenge(token);
    const user = challenge && (await getPrimaryUser(challenge.userId));
    if (!user?.webauthnCredentials?.length) {
      return NextResponse.json({ error: "Your sign-in expired. Please start again." }, { status: 401 });
    }
    return NextResponse.json(await loginPasskeyOptions(token, challenge, user, req));
  } catch (e) {
    console.error("Passkey options error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
