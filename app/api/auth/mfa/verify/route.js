import { NextResponse } from "next/server";
import { readJsonLimited } from "@/lib/requestBody";
import { consumeSharedLimit, retryAfterSeconds } from "@/lib/sharedRateLimit";
import { logSecurityEvent } from "@/lib/securityLog";
import { getClientIp } from "@/lib/clientIp";
import { safeNextPath } from "@/lib/url";
import { startSession } from "@/lib/sessions/store";
import {
  deleteLoginChallenge,
  getPrimaryUser,
  MAX_CHALLENGE_ATTEMPTS,
  readLoginChallenge,
  verifyLoginChallenge,
} from "@/lib/mfa/store";
import { challengeTokenFrom, clearChallengeCookie } from "@/lib/mfa/challengeCookie";

const METHODS = new Set(["totp", "recovery", "webauthn"]);

/**
 * POST /api/auth/mfa/verify
 *   { method: "totp" | "recovery", code } or { method: "webauthn", response }
 *
 * Completes a sign-in that passed its first factor. Each challenge allows
 * MAX_CHALLENGE_ATTEMPTS tries; after that the user must sign in again.
 */
export async function POST(req) {
  const ip = getClientIp(req.headers);
  const token = challengeTokenFrom(req);
  const expired = () =>
    clearChallengeCookie(NextResponse.json({ error: "Your sign-in expired. Please start again.", restart: true }, { status: 401 }));

  try {
    const challenge = await readLoginChallenge(token);
    if (!challenge) return expired();

    // Per user as well as per challenge, so restarting the login doesn't
    // reset the guess budget.
    const { allowed, resetMs } = await consumeSharedLimit(`mfa:${challenge.userId}`, 10, 15 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429, headers: { "Retry-After": retryAfterSeconds(resetMs) } });
    }

    const { body, error } = await readJsonLimited(req, 16 * 1024);
    if (error) return error;
    const input = { method: body.method, code: typeof body.code === "string" ? body.code : undefined, response: body.response };
    if (!METHODS.has(input.method) || (input.method !== "webauthn" && !input.code) || (input.method === "webauthn" && typeof input.response !== "object")) {
      return NextResponse.json({ error: "Enter a code or use a passkey." }, { status: 400 });
    }

    const user = await getPrimaryUser(challenge.userId);
    if (!user) return expired();

    const ok = await verifyLoginChallenge(token, challenge, user, req, input);
    if (!ok) {
      logSecurityEvent("login_failed", { ip, reason: "mfa" });
      const attemptsLeft = MAX_CHALLENGE_ATTEMPTS - (challenge.attempts + 1);
      if (attemptsLeft <= 0) {
        await deleteLoginChallenge(token);
        return expired();
      }
      return NextResponse.json({ error: "That didn't work. Check the code and try again.", attemptsLeft }, { status: 401 });
    }

    await deleteLoginChallenge(token);
    const next = safeNextPath(challenge.next, "/dashboard");
    const response = NextResponse.json({ success: true, next });
    await startSession(response, user, { amr: challenge.amr, req, mfa: true, sameSite: "lax" });
    return clearChallengeCookie(response);
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") return expired();
    console.error("MFA verify error:", e?.message);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
