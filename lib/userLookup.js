import { docClient, TableNames } from "@/lib/dynamodb";
import { BatchGetCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { findUserByIdentifier, isPrimaryUser } from "@/lib/users/identity";

export function userSummary(u) {
  return {
    userId: u.userId,
    username: u.username,
    email: u.email,
    fullName: u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : u.username,
  };
}

/** Resolve { userId } or { identifier: email | username } to an active user summary, or null. */
export async function resolveUserRef(ref) {
  if (ref.userId) {
    const { Item } = await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: { PK: `USER#${ref.userId}` } }));
    return isPrimaryUser(Item) ? userSummary(Item) : null;
  }
  const found = await findUserByIdentifier(ref.identifier);
  return found?.userId ? userSummary(found) : null;
}

/** Batch fetch user summaries. Returns { [userId]: summary }; deleted users are omitted. */
export async function getUserSummaries(ids) {
  const unique = [...new Set(ids)];
  const out = {};
  for (let i = 0; i < unique.length; i += 100) {
    let keys = unique.slice(i, i + 100).map((id) => ({ PK: `USER#${id}` }));
    for (let attempt = 0; keys.length && attempt < 5; attempt++) {
      const res = await docClient.send(new BatchGetCommand({ RequestItems: { [TableNames.Users]: { Keys: keys } } }));
      for (const u of res.Responses?.[TableNames.Users] || []) {
        if (isPrimaryUser(u)) out[u.userId] = userSummary(u);
      }
      keys = res.UnprocessedKeys?.[TableNames.Users]?.Keys || [];
    }
  }
  return out;
}
