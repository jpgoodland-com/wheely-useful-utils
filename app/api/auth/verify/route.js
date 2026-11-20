import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { tokenMatchesHash } from "@/lib/tokens";
import { isPrimaryUser } from "@/lib/users/identity";

// One reply for unknown users, wrong tokens and already-used links, so the
// endpoint can't be used to probe user ids.
const invalid = () =>
  NextResponse.json({ error: "Invalid or expired verification link. Please request a new one." }, { status: 400 });

export async function POST(req) {
  try {
    const { userId, token } = await req.json();

    if (!userId || !token || typeof userId !== "string" || typeof token !== "string") {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const { Item: user } = await docClient.send(new GetCommand({
      TableName: TableNames.Users,
      Key: { PK: `USER#${userId}` }
    }));

    if (!isPrimaryUser(user) || user.isVerified) return invalid();

    // M1: Check verification token expiry (24 hours)
    if (!user.verificationTokenExpiry || new Date(user.verificationTokenExpiry) < new Date()) return invalid();

    // Hashed at rest; compared in constant time.
    if (!tokenMatchesHash(token, user.verificationTokenHash)) return invalid();

    // Verified accounts must not be deleted by the unverified-account TTL.
    const update = {
      TableName: TableNames.Users,
      UpdateExpression: "SET isVerified = :v, emailVerifiedAt = :t REMOVE verificationTokenHash, verificationTokenExpiry, expiresAt",
      ExpressionAttributeValues: { ":v": true, ":t": new Date().toISOString() },
    };
    await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#${userId}` } }));
    // The username pointer is a full copy, so login-by-username sees the change.
    if (user.username) {
      await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#USERNAME#${user.username}` } }));
    }

    return NextResponse.json({ success: true, message: "Email verified. You can now sign in." });
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
