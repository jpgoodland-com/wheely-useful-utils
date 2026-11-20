import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { checkRateLimit } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/securityLog";
import { getClientIp } from "@/lib/clientIp";
import { findUserByIdentifier } from "@/lib/users/identity";
import { startSession } from "@/lib/sessions/store";
import { createLoginChallenge, getPrimaryUser, isMfaEnabled, mfaMethods } from "@/lib/mfa/store";
import { setChallengeCookie } from "@/lib/mfa/challengeCookie";
import { consumeSharedLimit, retryAfterSeconds } from "@/lib/sharedRateLimit";

// A real bcrypt hash of a random string. Comparing against it when the
// account doesn't exist (or has no password) keeps the response time the
// same as a wrong password, so timing can't reveal which accounts exist.
const DUMMY_HASH = "$2b$10$gxBYgDKx3QHplohtDznQ3.vDp4Q2hfCEoiiwNYr9.ykh5ERDI4Z7."; // nosemgrep: generic.secrets.security.detected-bcrypt-hash.detected-bcrypt-hash (random dummy, not a credential)

// One message for every failure, so the response never says whether the
// account exists or how it signs in.
const INVALID = "Invalid credentials. If you signed up with Google, Microsoft or GitHub, use that button instead.";

export async function POST(req) {
  try {
    // H1: Rate limit — 10 attempts per 15 minutes per IP
    const clientIp = getClientIp(req.headers);
    const { allowed, resetMs, firstBlocked } = checkRateLimit(`login:${clientIp}`, 10, 15 * 60 * 1000);
    if (!allowed) {
      if (firstBlocked) logSecurityEvent("rate_limited", { tier: "login", ip: clientIp });
      const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSecs) } }
      );
    }

    const { identifier, password } = await req.json(); // identifier is email or username

    if (!identifier || !password || typeof identifier !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Shared across tasks: per IP, and per account so rotating IPs doesn't
    // help a password-guessing run. The account limit counts attempts on
    // the typed identifier whether or not it exists, so being throttled
    // doesn't reveal that an account is real.
    const [byIp, byAccount] = await Promise.all([
      consumeSharedLimit(`login-ip:${clientIp}`, 30, 15 * 60 * 1000),
      consumeSharedLimit(`login-id:${identifier.trim().toLowerCase()}`, 10, 15 * 60 * 1000),
    ]);
    if (!byIp.allowed || !byAccount.allowed) {
      logSecurityEvent("login_throttled", { ip: clientIp, scope: byAccount.allowed ? "ip" : "account" });
      return NextResponse.json(
        { error: "Too many sign-in attempts. Wait 15 minutes or reset your password." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds(Math.max(byIp.resetMs, byAccount.resetMs)) } }
      );
    }

    const user = await findUserByIdentifier(identifier);
    const match = await bcrypt.compare(password, user?.password || DUMMY_HASH);

    if (!user || !user.password || !match) {
      logSecurityEvent("login_failed", { ip: clientIp });
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }

    if (user.isVerified === false) {
      return NextResponse.json({ error: "Please verify your email address before logging in. Check your email inbox for a verification link." }, { status: 403 });
    }

    // Factors live on the primary item; a username login found the pointer.
    const primary = await getPrimaryUser(user.userId);
    if (!primary) {
      logSecurityEvent("login_failed", { ip: clientIp });
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }
    if (isMfaEnabled(primary)) {
      // Password is right, but no session until the second factor passes.
      const challenge = await createLoginChallenge(primary, { amr: "pwd" });
      return setChallengeCookie(NextResponse.json({ mfaRequired: true, methods: mfaMethods(primary) }), challenge);
    }

    const response = NextResponse.json({
      success: true,
      userId: user.userId,
      username: user.username,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      isAdmin: user.isAdmin === true,
    });
    await startSession(response, user, { amr: "pwd", req, sameSite: "strict" });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
