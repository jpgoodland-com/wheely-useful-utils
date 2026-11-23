import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { validatePassword } from "@/lib/password";
import { BREACHED_MESSAGE, isBreachedPassword } from "@/lib/users/breachedPassword";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { tokenMatchesHash } from "@/lib/tokens";
import { isPrimaryUser } from "@/lib/users/identity";
import { hashPassword } from "@/lib/users/passwordHash";
import { revokeAllSessions } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";

// Unknown user, no pending reset, wrong token and expired token all get
// the same reply, so the link can't be used to probe accounts.
const invalidLink = () =>
  NextResponse.json({ error: "Invalid or expired reset link. Please request a new one." }, { status: 400 });

export async function POST(req) {
  try {
    // Rate limit: 10 attempts per 15 minutes per IP
    const ip = getClientIp(req.headers);
    const { allowed, resetMs } = checkRateLimit(`reset-password:${ip}`, 10, 15 * 60 * 1000);
    if (!allowed) {
      const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSecs) } }
      );
    }

    const { userId, token, newPassword } = await req.json();

    if (!userId || !token || !newPassword || typeof userId !== "string" || typeof token !== "string" || typeof newPassword !== "string") {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    // Validate new password
    const { valid, errors } = validatePassword(newPassword);
    if (!valid) {
      return NextResponse.json(
        { error: "Password does not meet requirements.", details: errors },
        { status: 400 }
      );
    }

    if (await isBreachedPassword(newPassword)) {
      return NextResponse.json({ error: BREACHED_MESSAGE }, { status: 400 });
    }

    const { Item: user } = await docClient.send(
      new GetCommand({
        TableName: TableNames.Users,
        Key: { PK: `USER#${userId}` },
      })
    );

    if (!isPrimaryUser(user) || !user.passwordResetTokenHash || !user.passwordResetExpiry) return invalidLink();
    if (!tokenMatchesHash(token, user.passwordResetTokenHash)) return invalidLink();
    if (new Date(user.passwordResetExpiry) < new Date()) return invalidLink();

    const hashedPassword = await hashPassword(newPassword);

    // Single use: the hash is removed in the same write. passwordChangedAt
    // lets session checks reject sessions issued before the reset.
    const update = {
      TableName: TableNames.Users,
      UpdateExpression: "SET #pw = :p, passwordChangedAt = :now REMOVE passwordResetTokenHash, passwordResetExpiry",
      ConditionExpression: "passwordResetTokenHash = :h",
      ExpressionAttributeNames: { "#pw": "password" },
      ExpressionAttributeValues: { ":p": hashedPassword, ":now": new Date().toISOString(), ":h": user.passwordResetTokenHash },
    };
    try {
      await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#${userId}` } }));
    } catch (e) {
      // A concurrent request already used this token.
      if (e?.name === "ConditionalCheckFailedException") return invalidLink();
      throw e;
    }
    if (user.username) {
      const { ConditionExpression, ...pointerUpdate } = update;
      const { ":h": _h, ...values } = pointerUpdate.ExpressionAttributeValues;
      await docClient.send(new UpdateCommand({
        ...pointerUpdate,
        ExpressionAttributeValues: values,
        Key: { PK: `USER#USERNAME#${user.username}` },
      }));
    }

    // Whoever had the old password is signed out everywhere.
    await revokeAllSessions(userId);
    await recordAudit(req, { action: "auth.password_reset", actorUserId: userId });
    logSecurityEvent("password_changed", { reason: "reset" });

    return NextResponse.json({ success: true, message: "Password updated successfully. You can now log in." });
  } catch (error) {
    console.error("Reset-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
