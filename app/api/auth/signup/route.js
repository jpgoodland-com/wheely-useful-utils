import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { hashPassword } from "@/lib/users/passwordHash";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { validatePassword } from "@/lib/password";
import { BREACHED_MESSAGE, isBreachedPassword } from "@/lib/users/breachedPassword";
import { checkRateLimit } from "@/lib/rateLimit";
import { getTrustedBaseUrl } from "@/lib/url";
import { getClientIp } from "@/lib/clientIp";
import { newToken } from "@/lib/tokens";
import { recordAudit } from "@/lib/audit";
import { isAllowlistedAdmin } from "@/lib/users/adminAllowlist";
import {
  EMAIL_RE,
  findUserByEmail,
  findUserByUsername,
  isKeyTaken,
  normalizeEmail,
  normalizeUsername,
  usernameError,
} from "@/lib/users/identity";

// Unverified accounts are deleted by DynamoDB TTL after this long, so an
// address can't be squatted indefinitely.
const UNVERIFIED_TTL_SECS = 7 * 24 * 60 * 60;

// Same reply whether or not the email is registered (no enumeration).
const genericOk = () =>
  NextResponse.json({ success: true, message: "Please check your email to verify your account" });

export async function POST(req) {
  try {
    const ip = getClientIp(req.headers);
    const { allowed, resetMs } = checkRateLimit(`signup:${ip}`, 5, 15 * 60 * 1000);
    if (!allowed) {
      const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSecs) } }
      );
    }

    const { email: rawEmail, username: rawUsername, password, firstName, lastName } = await req.json();

    if (!rawEmail || !rawUsername || !password || !firstName || !lastName) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (
      typeof firstName !== "string" ||
      firstName.trim().length === 0 ||
      firstName.trim().length > 50 ||
      typeof lastName !== "string" ||
      lastName.trim().length === 0 ||
      lastName.trim().length > 50
    ) {
      return NextResponse.json({ error: "First and last name must each be between 1 and 50 characters" }, { status: 400 });
    }

    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const badUsername = usernameError(rawUsername);
    if (badUsername) {
      return NextResponse.json({ error: badUsername }, { status: 400 });
    }
    const username = normalizeUsername(rawUsername);

    // Server-side password validation (authoritative)
    const { valid: pwValid, errors: pwErrors } = validatePassword(password);
    if (!pwValid) {
      return NextResponse.json(
        { error: "Password does not meet requirements: " + pwErrors.join("; ") },
        { status: 400 }
      );
    }

    if (await isBreachedPassword(password)) {
      return NextResponse.json({ error: BREACHED_MESSAGE }, { status: 400 });
    }

    const hostUrl = getTrustedBaseUrl(req);
    const existing = await findUserByEmail(email);

    if (existing?.isVerified) {
      // Tell the real owner instead of telling the caller.
      await sendEmail({
        to: email,
        subject: "Someone tried to sign up with your email",
        text: `Someone tried to create a Spin the Wheel account with this email address, which already has an account.\n\nIf this was you, sign in or reset your password at ${hostUrl}/forgot-password. If it wasn't, you can ignore this email.`,
        html: `<p>Someone tried to create a Spin the Wheel account with this email address, which already has an account.</p><p>If this was you, <a href="${hostUrl}/login">sign in</a> or <a href="${hostUrl}/forgot-password">reset your password</a>. If it wasn't, you can ignore this email.</p>`,
      });
      return genericOk();
    }

    // A legacy item (e.g. an old username containing "@") still claims the
    // address. Don't create a duplicate; the username migration resolves it.
    if (!existing && (await isKeyTaken(email))) {
      console.warn(JSON.stringify({ event: "signup_key_conflict" }));
      return genericOk();
    }

    const usernameOwner = await findUserByUsername(username);
    if ((usernameOwner && usernameOwner.userId !== existing?.userId) || (!usernameOwner && (await isKeyTaken(username)))) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // C5: an unverified account holding this address was never proven to
    // belong to whoever made it. The address owner signing up replaces it,
    // so a squatter's password can't survive into the real account.
    if (existing) {
      await docClient.send(new DeleteCommand({ TableName: TableNames.Users, Key: { PK: `USER#${existing.userId}` } }));
      if (existing.username) {
        await docClient.send(new DeleteCommand({ TableName: TableNames.Users, Key: { PK: `USER#USERNAME#${existing.username}` } }));
      }
    }

    const hashedPassword = await hashPassword(password);
    const userId = crypto.randomUUID();
    const { token: verificationToken, hash: verificationTokenHash } = newToken();
    // M1: Verification token expires after 24 hours
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const userItem = {
      PK: `USER#${userId}`,
      userId,
      email,
      username,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      EmailOrUsername: email,
      password: hashedPassword,
      isVerified: false,
      isAdmin: isAllowlistedAdmin(email),
      authProvider: "credentials",
      verificationTokenHash,
      verificationTokenExpiry,
      expiresAt: Math.floor(Date.now() / 1000) + UNVERIFIED_TTL_SECS,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({ TableName: TableNames.Users, Item: userItem }));
    await docClient.send(new PutCommand({
      TableName: TableNames.Users,
      Item: { ...userItem, PK: `USER#USERNAME#${username}`, EmailOrUsername: username },
    }));

    await recordAudit(req, { action: "account.created", actorUserId: userId, details: { method: "pwd" } });

    const verificationLink = `${hostUrl}/verify?userId=${userId}&token=${verificationToken}`;
    const greetingName = firstName.trim() || username;

    await sendEmail({
      to: email,
      subject: "Verify Your Account",
      text: `Hello ${greetingName},\n\nWelcome! Please verify your account by clicking this link:\n\n${verificationLink}\n\nIf you didn't create this account, ignore this email and it will be deleted.`,
      html: `<p>Hello ${escapeHtml(greetingName)},</p><p>Welcome! Please verify your account by clicking the link below:</p><p><a href="${verificationLink}">Verify my account</a></p><p>If you didn't create this account, ignore this email and it will be deleted.</p>`,
    });

    return genericOk();
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
