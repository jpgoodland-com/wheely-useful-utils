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
    const { allowed, resetMs } = checkRateLimit(`forgot-password:${ip}`, 3, 15 * 60 * 1000);
    if (!allowed) {
      const retryAfterSecs = Math.ceil((resetMs - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSecs) } }
      );
    }

    const body = await req.json();
    const email = (body.email ?? "").toLowerCase().trim();

    // Always return success — never reveal whether an email is registered
    const getGenericOk = () => NextResponse.json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent.",
    });

    if (!email) return getGenericOk();

    // Per address across tasks, so rotating IPs can't flood someone's inbox.
    // Over the limit the reply stays the same and nothing is sent.
    if (!(await consumeSharedLimit(`forgot:${email}`, 3, 60 * 60 * 1000)).allowed) return getGenericOk();

    const user = await findUserByEmail(email);
    if (!user) return getGenericOk();

    // Stored hashed; the plaintext only ever exists in the email.
    const { token: resetToken, hash: resetTokenHash } = newToken();
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const update = {
      TableName: TableNames.Users,
      UpdateExpression: "SET passwordResetTokenHash = :t, passwordResetExpiry = :e",
      ExpressionAttributeValues: { ":t": resetTokenHash, ":e": resetExpiry },
    };
    await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#${user.userId}` } }));
    if (user.username) {
      await docClient.send(new UpdateCommand({ ...update, Key: { PK: `USER#USERNAME#${user.username}` } }));
    }

    const hostUrl = getTrustedBaseUrl(req);
    const resetLink = `${hostUrl}/reset-password?userId=${user.userId}&token=${resetToken}`;

    // A send failure must look like success: unknown addresses never reach
    // this point, so a 500 here would reveal that the account exists.
    try {
      await sendEmail({
        to: user.email,
        subject: "Reset Your Password",
        text: `You requested a password reset for your Spin the Wheel account.\n\nClick the link below to set a new password (valid for 1 hour):\n\n${resetLink}\n\nIf you did not request this, you can safely ignore this email.`,
        html: `
          <p>You requested a password reset for your <strong>Spin the Wheel</strong> account.</p>
          <p>Click the link below to set a new password (valid for 1 hour):</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p style="color:#888;">If you did not request this, you can safely ignore this email.</p>
        `,
      });
    } catch (sendError) {
      console.error("Forgot-password email send failed:", sendError?.message);
    }

    return getGenericOk();
  } catch (error) {
    console.error("Forgot-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
