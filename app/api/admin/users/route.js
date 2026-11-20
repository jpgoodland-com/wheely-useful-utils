import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSession } from "@/lib/session";
import crypto from "crypto";
import { validatePassword } from "@/lib/password";
import { BREACHED_MESSAGE, isBreachedPassword } from "@/lib/users/breachedPassword";
import { EMAIL_RE, isKeyTaken, normalizeEmail, normalizeUsername, usernameError } from "@/lib/users/identity";
import { hashPassword } from "@/lib/users/passwordHash";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  if (!session.isAdmin) return null;
  return session;
}

// GET /api/admin/users — list all users (primary items only, not username pointers)
export async function GET() {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await docClient.send(new ScanCommand({ TableName: TableNames.Users }));
  // Filter to primary user items only (exclude username pointer items)
  const users = (result.Items || [])
    .filter(u => u.PK.startsWith("USER#") && !u.PK.startsWith("USER#USERNAME#"))
    .map(({ PK, userId, email, username, firstName, lastName, isAdmin, isVerified, createdAt }) => ({
      PK, userId, email, username, firstName: firstName || null, lastName: lastName || null, isAdmin: !!isAdmin, isVerified: !!isVerified, createdAt
    }));

  return NextResponse.json(users);
}

// POST /api/admin/users — create a user directly (pre-verified, no email sent)
export async function POST(req) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, username, password, firstName, lastName, isAdmin = false } = await req.json();

  if (!email || !username || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (firstName && (typeof firstName !== "string" || firstName.trim().length > 50)) {
    return NextResponse.json({ error: "First name must be at most 50 characters" }, { status: 400 });
  }
  if (lastName && (typeof lastName !== "string" || lastName.trim().length > 50)) {
    return NextResponse.json({ error: "Last name must be at most 50 characters" }, { status: 400 });
  }

  if (typeof email !== "string" || !EMAIL_RE.test(normalizeEmail(email))) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const badUsername = usernameError(username);
  if (badUsername) {
    return NextResponse.json({ error: badUsername }, { status: 400 });
  }

  // L5: Validate password strength (same rules as regular signup)
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

  if (await isKeyTaken(normalizeEmail(email))) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }
  if (await isKeyTaken(normalizeUsername(username))) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const hashedPassword = await hashPassword(password);
  const userId = crypto.randomUUID();

  const userItem = {
    PK: `USER#${userId}`,
    userId,
    email: normalizeEmail(email),
    username: normalizeUsername(username),
    firstName: firstName ? firstName.trim() : null,
    lastName: lastName ? lastName.trim() : null,
    EmailOrUsername: normalizeEmail(email),
    password: hashedPassword,
    isVerified: true, // admin-created users are pre-verified
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TableNames.Users, Item: userItem }));
  await docClient.send(new PutCommand({
    TableName: TableNames.Users,
    Item: { ...userItem, PK: `USER#USERNAME#${normalizeUsername(username)}`, EmailOrUsername: normalizeUsername(username) },
  }));

  await recordAudit(req, { action: "admin.user_created", actorUserId: admin.userId, actorType: "admin", targetUserId: userId });
  if (userItem.isAdmin) {
    await recordAudit(req, { action: "admin.role_granted", actorUserId: admin.userId, actorType: "admin", targetUserId: userId });
    logSecurityEvent("admin_role_changed", { granted: true });
  }

  const { password: _, ...safeUser } = userItem;
  return NextResponse.json(safeUser);
}
