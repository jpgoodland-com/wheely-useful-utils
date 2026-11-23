import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TableNames } from "@/lib/dynamodb";
import { hashToken } from "@/lib/tokens";

/**
 * Rate limits shared by every task (security plan H2).
 *
 * lib/rateLimit.js counts per process, so with two Fargate tasks a client
 * gets twice each limit, and a limit keyed on an account (not an IP) could
 * be dodged by alternating tasks. These counters live in the Users table as
 * `RATE#<sha256(key)>#<windowStart>` items (fixed windows, removed by TTL),
 * so emails and usernames used as keys are never stored.
 *
 * If DynamoDB is unavailable the check fails open and logs: the per-task
 * limiter still applies, and an outage shouldn't lock everyone out.
 */
export async function consumeSharedLimit(key, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetMs = windowStart + windowMs;
  try {
    const { Attributes } = await docClient.send(new UpdateCommand({
      TableName: TableNames.Users,
      Key: { PK: `RATE#${hashToken(key)}#${windowStart}` },
      UpdateExpression: "ADD hits :one SET expiresAt = :exp",
      ExpressionAttributeValues: { ":one": 1, ":exp": Math.ceil(resetMs / 1000) + 60 },
      ReturnValues: "UPDATED_NEW",
    }));
    const hits = Attributes?.hits ?? 1;
    return { allowed: hits <= limit, remaining: Math.max(0, limit - hits), resetMs, hits };
  } catch (e) {
    console.error("Shared rate limit unavailable:", e?.message);
    return { allowed: true, remaining: limit, resetMs, hits: 0 };
  }
}

export function retryAfterSeconds(resetMs) {
  return String(Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)));
}
