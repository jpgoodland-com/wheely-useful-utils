import crypto from "crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TableNames } from "@/lib/dynamodb";
import { hashToken } from "@/lib/tokens";
import { getClientIp } from "@/lib/clientIp";
import { isPrimaryUser } from "@/lib/users/identity";
import { recordAudit } from "@/lib/audit";

/**
 * Server-side sessions (security plan H3).
 *
 * The browser holds an opaque 256-bit token; the Users table holds
 * `SESSION#<sha256(token)>`. Because every request reads the session and
 * the user, a session can be revoked at once (logout, password change,
 * account deletion, admin action) and admin rights are always current.
 *
 *   PK                  SESSION#<sid>, where sid = sha256(token)
 *   EmailOrUsername     session#<userId>: lets the existing GSI list a
 *                       user's sessions. Can't collide with emails or
 *                       usernames, which never contain "#" before an "@".
 *   createdAt, authAt   epoch ms; authAt moves on re-authentication
 *   lastSeenAt          epoch ms, written at most once a minute
 *   idleExpiresAt       epoch ms, slides with activity
 *   absoluteExpiresAt   epoch ms, fixed at creation
 *   expiresAt           epoch seconds (DynamoDB TTL cleanup)
 *   amr                 how the user signed in: "pwd" | "oauth:<provider>"
 *   mfa                 true when a second factor was checked at sign-in
 *   ip, ua              for the "where you're signed in" list
 */

const minutes = (n) => n * 60 * 1000;
const envNumber = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const idleTimeoutMs = () => minutes(envNumber("SESSION_IDLE_MINUTES", 30));
export const absoluteTimeoutMs = () => minutes(envNumber("SESSION_MAX_HOURS", 12) * 60);
const TOUCH_INTERVAL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = minutes(10);

/**
 * `__Host-` cookies must be Secure, which browsers only honour over HTTPS,
 * so local development (plain http) uses an unprefixed name.
 */
export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-session" : "session";
}

const sessionKey = (sid) => ({ PK: `SESSION#${sid}` });

/** Creates a session for `user` and returns the token for the cookie. */
export async function createSession(user, { amr, req, mfa = false } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const sid = hashToken(token);
  const now = Date.now();
  const absoluteExpiresAt = now + absoluteTimeoutMs();
  await docClient.send(new PutCommand({
    TableName: TableNames.Users,
    Item: {
      ...sessionKey(sid),
      sid,
      userId: user.userId,
      EmailOrUsername: `session#${user.userId}`,
      createdAt: now,
      authAt: now,
      lastSeenAt: now,
      idleExpiresAt: now + idleTimeoutMs(),
      absoluteExpiresAt,
      expiresAt: Math.ceil(absoluteExpiresAt / 1000),
      amr: amr || "pwd",
      mfa: mfa === true,
      ip: req ? getClientIp(req.headers) : "unknown",
      ua: (req?.headers.get("user-agent") || "").slice(0, 200),
    },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  return { token, sid };
}

/** Sets the session cookie on a response. */
export function setSessionCookie(response, token, { sameSite = "lax" } = {}) {
  response.cookies.set({
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite,
    maxAge: Math.floor(absoluteTimeoutMs() / 1000),
  });
  // Remove the pre-session JWT cookie if the browser still has one.
  response.cookies.set({ name: "auth_token", value: "", httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set({ name: sessionCookieName(), value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  response.cookies.set({ name: "auth_token", value: "", httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

/** The session token sent with a request (read from the Cookie header). */
export function sessionTokenFrom(req) {
  const header = req?.headers?.get("cookie") || "";
  const name = sessionCookieName();
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Signs `user` in: revokes whatever session the browser already had (so a
 * planted or stale session never survives a login), creates a new one and
 * sets its cookie.
 */
export async function startSession(response, user, { amr, req, sameSite, mfa } = {}) {
  const previous = sessionTokenFrom(req);
  if (previous) await revokeSession(hashToken(previous));
  const { token, sid } = await createSession(user, { amr, req, mfa });
  setSessionCookie(response, token, { sameSite });
  await recordAudit(req, { action: "auth.session_started", actorUserId: user.userId, details: { method: amr || "pwd", mfa: mfa === true } });
  return sid;
}

/**
 * Validates a session token. Returns { session, user } or null.
 * Expired sessions, sessions for deleted or disabled users, and sessions
 * created before the last password change are all rejected.
 */
export async function readSession(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const sid = hashToken(token);
  const { Item: session } = await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: sessionKey(sid) }));
  if (!session || session.sid !== sid) return null;

  const now = Date.now();
  if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
    await revokeSession(sid);
    return null;
  }

  const { Item: user } = await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: { PK: `USER#${session.userId}` } }));
  if (!isPrimaryUser(user) || user.userId !== session.userId || user.disabled === true) return null;
  if (user.passwordChangedAt && Date.parse(user.passwordChangedAt) > session.createdAt) {
    await revokeSession(sid);
    return null;
  }

  if (now - session.lastSeenAt > TOUCH_INTERVAL_MS) {
    const idleExpiresAt = Math.min(now + idleTimeoutMs(), session.absoluteExpiresAt);
    await docClient.send(new UpdateCommand({
      TableName: TableNames.Users,
      Key: sessionKey(sid),
      UpdateExpression: "SET lastSeenAt = :now, idleExpiresAt = :idle",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":now": now, ":idle": idleExpiresAt },
    })).catch((e) => {
      // Revoked between the read and this write: the request still sees the
      // session it already validated, the next one won't.
      if (e?.name !== "ConditionalCheckFailedException") throw e;
    });
    session.lastSeenAt = now;
    session.idleExpiresAt = idleExpiresAt;
  }

  return { session, user };
}

export async function revokeSession(sid) {
  await docClient.send(new DeleteCommand({ TableName: TableNames.Users, Key: sessionKey(sid) }));
}

/** All of a user's live sessions, newest first. */
export async function listSessions(userId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient.send(new QueryCommand({
      TableName: TableNames.Users,
      IndexName: "EmailOrUsernameIndex",
      KeyConditionExpression: "EmailOrUsername = :k",
      ExpressionAttributeValues: { ":k": `session#${userId}` },
      ExclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const now = Date.now();
  return items
    .filter((s) => s.userId === userId && s.PK?.startsWith("SESSION#") && now < s.idleExpiresAt && now < s.absoluteExpiresAt)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Revokes every session of a user, optionally keeping one. Returns the count revoked. */
export async function revokeAllSessions(userId, { exceptSid } = {}) {
  const sessions = await listSessions(userId);
  let revoked = 0;
  for (const s of sessions) {
    if (s.sid === exceptSid) continue;
    await revokeSession(s.sid);
    revoked++;
  }
  return revoked;
}

/** Records a fresh password/provider check on the current session. */
export async function markReauthenticated(sid) {
  await docClient.send(new UpdateCommand({
    TableName: TableNames.Users,
    Key: sessionKey(sid),
    UpdateExpression: "SET authAt = :now",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: { ":now": Date.now() },
  }));
}

/**
 * Marks the current session as having passed a second factor (used right
 * after the user proves they hold a new authenticator).
 */
export async function markSessionMfa(sid) {
  await docClient.send(new UpdateCommand({
    TableName: TableNames.Users,
    Key: sessionKey(sid),
    UpdateExpression: "SET mfa = :t, authAt = :now",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: { ":t": true, ":now": Date.now() },
  }));
}

/** True when the user proved who they are within the last `windowMs`. */
export function hasRecentAuth(session, windowMs = REAUTH_WINDOW_MS) {
  return typeof session?.authAt === "number" && Date.now() - session.authAt < windowMs;
}
