import { docClient, TableNames } from "@/lib/dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Email and username lookups on the Users table.
 *
 * Emails and usernames share the `EmailOrUsername` GSI key. Before these
 * helpers, a username such as `ceo@corp.com` could collide with a real
 * email, and lookups took `Items[0]`, so OAuth sign-in for that email
 * landed in the squatter's account. Two rules now prevent that:
 *   1. Usernames can never contain `@` (USERNAME_RE), so the two key spaces
 *      are disjoint for new data.
 *   2. Every lookup checks the item's role, not just its key: an email
 *      lookup only accepts a primary `USER#<id>` item whose `email` equals
 *      the address; a username lookup only accepts the
 *      `USER#USERNAME#<username>` pointer. Legacy `@` usernames can then
 *      never be mistaken for an email.
 */

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isPrimaryUser = (u) =>
  typeof u?.PK === "string" && u.PK.startsWith("USER#") && !u.PK.startsWith("USER#USERNAME#");

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function normalizeUsername(username) {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

/** Returns an error message, or null when the username is acceptable. */
export function usernameError(username) {
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) {
    return "Username must be 3-32 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number";
  }
  return null;
}

async function queryKey(value) {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TableNames.Users,
      IndexName: "EmailOrUsernameIndex",
      KeyConditionExpression: "EmailOrUsername = :v",
      ExpressionAttributeValues: { ":v": value },
    })
  );
  return res.Items || [];
}

/** The primary user item for an email address, or null. */
export async function findUserByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const items = await queryKey(e);
  return items.find((u) => isPrimaryUser(u) && u.email === e && u.EmailOrUsername === e) || null;
}

/** The username pointer item (a full copy of the user), or null. */
export async function findUserByUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  const items = await queryKey(u);
  return items.find((i) => i.PK === `USER#USERNAME#${u}` && i.username === u) || null;
}

/** Login identifiers: anything containing `@` is an email, otherwise a username. */
export async function findUserByIdentifier(identifier) {
  const id = typeof identifier === "string" ? identifier.trim().toLowerCase() : "";
  if (!id) return null;
  return id.includes("@") ? findUserByEmail(id) : findUserByUsername(id);
}

/**
 * True if any non-invite item already claims this key. Stricter than
 * findUserBy*, so a legacy `@` username still blocks reuse of that value
 * as an email.
 */
export async function isKeyTaken(value) {
  const items = await queryKey(value);
  return items.some((i) => typeof i.PK === "string" && !i.PK.startsWith("INVITE#"));
}
