import crypto from "crypto";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TableNames } from "@/lib/dynamodb";
import { getClientIp } from "@/lib/clientIp";
import { logSecurityEvent } from "@/lib/securityLog";

/**
 * Audit trail (security plan H12; SOC 2 CC7.2, ISO 27001 A.8.15).
 *
 * One append-only record per security or admin action, in WheelApp_Audit.
 * The task role can only Put and Query that table, so the app can't alter
 * history. Records are also written as a JSON log line, so they reach
 * CloudWatch (kept a year) even if the table write fails.
 *
 *   PK      AUDIT#<ts>#<random>
 *   scope   "platform" (admin actions) | "user#<userId>" (a user's own security events)
 *   ts      ISO time + "#" + random, the ScopeIndex range key (newest last)
 *   action  e.g. "auth.session_started", "mfa.totp_enabled", "admin.role_granted"
 *   actorUserId, actorType ("user" | "admin" | "system"), targetUserId?
 *   ip, ua, result ("success" | "failure"), details (small, allowlisted)
 *   expiresAt  TTL, 400 days
 *
 * Never put passwords, tokens, codes, emails or anything the user typed into
 * `details`: only ids, enums, counts and booleans are accepted.
 */

const TTL_SECONDS = 400 * 24 * 60 * 60;
const DETAIL_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const DETAIL_VALUE = /^[a-zA-Z0-9:._-]{0,64}$/;

export const ACTIONS = new Set([
  "account.created",
  "account.deleted",
  "auth.session_started",
  "auth.logout",
  "auth.reauthenticated",
  "auth.sessions_revoked",
  "auth.session_revoked",
  "auth.password_reset",
  "mfa.totp_enabled",
  "mfa.totp_removed",
  "mfa.passkey_added",
  "mfa.passkey_removed",
  "mfa.recovery_regenerated",
  "admin.user_created",
  "admin.user_deleted",
  "admin.role_granted",
  "admin.role_revoked",
  "admin.password_set",
  "admin.invite_sent",
]);

/** Keeps only safe, short, non-free-text detail values. */
export function cleanDetails(details) {
  const out = {};
  for (const [k, v] of Object.entries(details || {})) {
    if (!DETAIL_KEY.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && DETAIL_VALUE.test(v)) out[k] = v;
  }
  return out;
}

/**
 * Records an audit event. Never throws: a failed write is logged as the
 * `audit_write_failed` security event (alarmed in monitoring.tf), and the
 * JSON log line still carries the record.
 */
export async function recordAudit(req, { action, actorUserId, actorType = "user", scope, targetUserId, result = "success", details }) {
  if (!ACTIONS.has(action)) throw new Error(`Unknown audit action: ${action}`);
  const now = new Date();
  const suffix = crypto.randomBytes(6).toString("hex");
  const record = {
    PK: `AUDIT#${now.toISOString()}#${suffix}`,
    scope: scope || (actorType === "admin" ? "platform" : `user#${targetUserId || actorUserId}`),
    ts: `${now.toISOString()}#${suffix}`,
    action,
    actorUserId: actorUserId || null,
    actorType,
    targetUserId: targetUserId || null,
    ip: req ? getClientIp(req.headers) : "unknown",
    ua: (req?.headers?.get("user-agent") || "").slice(0, 200),
    result,
    details: cleanDetails(details),
    expiresAt: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
  };
  console.info(JSON.stringify({ audit: { ...record, PK: undefined, expiresAt: undefined } }));
  try {
    await docClient.send(new PutCommand({
      TableName: TableNames.Audit,
      Item: record,
      ConditionExpression: "attribute_not_exists(PK)",
    }));
  } catch (e) {
    logSecurityEvent("audit_write_failed", { action, reason: e?.name || "error" });
  }
  return record;
}

/** Newest-first audit records for a scope ("platform" or "user#<id>"). */
export async function listAudit(scope, { limit = 50, before } = {}) {
  const res = await docClient.send(new QueryCommand({
    TableName: TableNames.Audit,
    IndexName: "ScopeIndex",
    KeyConditionExpression: "#scope = :s",
    ExpressionAttributeNames: { "#scope": "scope" },
    ExpressionAttributeValues: { ":s": scope },
    ScanIndexForward: false,
    Limit: Math.min(Math.max(1, limit), 200),
    ...(before ? { ExclusiveStartKey: before } : {}),
  }));
  const items = (res.Items || []).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return {
    records: items.map(({ PK: _pk, expiresAt: _e, ...r }) => r),
    next: res.LastEvaluatedKey || null,
  };
}

/** Opaque paging cursor for listAudit; only accepts keys of the expected scope. */
export function encodeCursor(key) {
  return key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null;
}

export function decodeCursor(cursor, scope) {
  if (typeof cursor !== "string" || !cursor || cursor.length > 512) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const ok = key && typeof key === "object" && Object.keys(key).sort().join() === "PK,scope,ts" &&
      typeof key.PK === "string" && typeof key.ts === "string" && key.scope === scope;
    return ok ? key : undefined;
  } catch {
    return undefined;
  }
}
