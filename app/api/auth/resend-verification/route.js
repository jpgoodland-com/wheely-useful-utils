import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";
import { getTrustedBaseUrl } from "@/lib/url";
import { getClientIp } from "@/lib/clientIp";
import { newToken } from "@/lib/tokens";
import { consumeSharedLimit } from "@/lib/sharedRateLimit";
import { findUserByEmail } from "@/lib/users/identity";

export async function POST(req) {
  try {
    // Rate limit: 3 requests per 15 minutes per IP
    const ip = getClientIp(req.headers);
    const { allowed, resetMs } = checkRateLimit(`resend-verification:${ip}`, 3, 15 * 60 * 1000);
    if (!allowed) {
      const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many requests. Please wait before requesting another email." },
        { status: 429, headers: { "Retry-After": String(retryAfterSecs) } }
      );
    }

    const body = await req.json();
    const email = (body.email ?? "").toLowerCase().trim();

    // Always return success to prevent user enumeration
    const getGenericOk = () => NextResponse.json({
      success: true,
      message: "If an unverified account with that email exists, a new verification link has been sent.",
    });

    if (!email) return getGenericOk();

    // Per address across tasks, so rotating IPs can't flood someone's inbox.
    // Over the limit the reply stays the same and nothing is sent.
    if (!(await consumeSharedLimit(`resend:${email}`, 3, 60 * 60 * 1000)).allowed) return getGenericOk();

    const user = await findUserByEmail(email);
    if (!user) return getGenericOk();

    // If already verified, no need to resend
    if (user.isVerified) return getGenericOk();

    // Generate a fresh verification token with 24-hour expiry (M1), stored hashed
    const { token: verificationToken, hash: verificationTokenHash } = newToken();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const update = {
      TableName: TableNames.Users,
      UpdateExpression: "SET verificationTokenHash = :t, verificationTokenExpiry = :e",
      ExpressionAttributeValues: { ":t": verificationTokenHash, ":e": verificationTokenExpiry },
    };
    await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#${user.userId}` } }));
    if (user.username) {
      await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#USERNAME#${user.username}` } }));
    }

    const hostUrl = getTrustedBaseUrl(req);
    const verificationLink = `${hostUrl}/verify?userId=${user.userId}&token=${verificationToken}`;

    // A send failure must look like success: unknown addresses never reach
    // this point, so a 500 here would reveal that the account exists.
    try {
      await sendEmail({
        to: user.email,
        subject: "Verify Your Account – New Link",
        text: `Here is a new verification link for your Spin the Wheel account:\n\n${verificationLink}\n\nThis link is valid and will replace any previous links.`,
        html: `
          <p>Here is a new verification link for your <strong>Spin the Wheel</strong> account:</p>
          <p><a href="${verificationLink}">Verify my account</a></p>
          <p style="color:#888;">This link replaces any previous verification links.</p>
        `,
      });
    } catch (sendError) {
      console.error("Resend-verification email send failed:", sendError?.message);
    }

    return getGenericOk();
  } catch (error) {
    console.error("Resend-verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
