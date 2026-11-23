import { NextResponse } from "next/server";
import { getPrimaryUser, mfaMethods, readLoginChallenge } from "@/lib/mfa/store";
import { challengeTokenFrom } from "@/lib/mfa/challengeCookie";

/** GET /api/auth/mfa/challenge: which second factors the pending login can use. */
export async function GET(req) {
  try {
    const challenge = await readLoginChallenge(challengeTokenFrom(req));
    const user = challenge && (await getPrimaryUser(challenge.userId));
    if (!user) return NextResponse.json({ error: "Your sign-in expired. Please start again." }, { status: 401 });
    return NextResponse.json({ methods: mfaMethods(user) });
  } catch (e) {
    console.error("MFA challenge error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
