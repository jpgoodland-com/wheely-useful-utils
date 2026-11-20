import { NextResponse } from "next/server";
import { getSession, requireRecentAuth } from "@/lib/session";
import { getPrimaryUser, mfaStatus } from "./store";

/**
 * Loads the signed-in user's primary item for an MFA settings route.
 * Changes to factors need a recent re-auth (`stepUp`), so a hijacked
 * session can't swap in the attacker's authenticator.
 * Returns { session, user } or { response } to return as-is.
 */
export async function mfaContext({ stepUp = false } = {}) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (stepUp) {
    const needed = requireRecentAuth(session);
    if (needed) return { response: needed };
  }
  const user = await getPrimaryUser(session.userId);
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session, user };
}

export const statusResponse = (user, extra = {}) => NextResponse.json({ ...mfaStatus(user), ...extra });

export function mfaErrorResponse(e, label) {
  if (e?.name === "ConditionalCheckFailedException") {
    return NextResponse.json({ error: "Your security settings changed in another tab. Reload and try again." }, { status: 409 });
  }
  console.error(`${label}:`, e?.message);
  return NextResponse.json({ error: "Internal Error" }, { status: 500 });
}
