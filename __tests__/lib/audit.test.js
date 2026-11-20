jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Audit: "WheelApp_Audit" } };
});
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));

import { docClient } from "@/lib/dynamodb";
import { logSecurityEvent } from "@/lib/securityLog";
import { cleanDetails, decodeCursor, encodeCursor, listAudit, recordAudit } from "@/lib/audit";

const req = new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7", "user-agent": "UA/1" } });

beforeEach(() => {
  docClient.reset();
  jest.clearAllMocks();
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("writes an append-only record with the actor, scope, IP and a 400-day TTL", async () => {
  const record = await recordAudit(req, { action: "mfa.totp_enabled", actorUserId: "u1" });
  const [stored] = docClient.items("WheelApp_Audit");
  expect(stored).toMatchObject({ action: "mfa.totp_enabled", actorUserId: "u1", actorType: "user", scope: "user#u1", ip: "203.0.113.7", ua: "UA/1", result: "success" });
  expect(stored.PK).toBe(record.PK);
  expect(stored.expiresAt - Date.now() / 1000).toBeGreaterThan(399 * 24 * 3600);
  const put = docClient.calls.find((c) => c.name === "PutCommand").input;
  expect(put.ConditionExpression).toBe("attribute_not_exists(PK)");
});

it("files admin actions under the platform scope with the target user", async () => {
  await recordAudit(req, { action: "admin.role_granted", actorUserId: "admin", actorType: "admin", targetUserId: "u2" });
  expect(docClient.items("WheelApp_Audit")[0]).toMatchObject({ scope: "platform", targetUserId: "u2" });
});

it("rejects unknown actions so typos can't create untracked event types", async () => {
  await expect(recordAudit(req, { action: "mfa.whatever", actorUserId: "u1" })).rejects.toThrow(/Unknown audit action/);
});

it("keeps only short, non-free-text details", () => {
  expect(cleanDetails({
    method: "oauth:google", count: 3, mfa: true,
    email: "alice@example.com", note: "has spaces", long: "x".repeat(65), "bad key": "v", nested: { a: 1 }, nan: NaN,
  })).toEqual({ method: "oauth:google", count: 3, mfa: true });
});

it("never throws when the table write fails, and raises audit_write_failed", async () => {
  docClient.beforeSend = () => { throw Object.assign(new Error("denied"), { name: "AccessDeniedException" }); };
  await expect(recordAudit(req, { action: "auth.logout", actorUserId: "u1" })).resolves.toBeDefined();
  expect(logSecurityEvent).toHaveBeenCalledWith("audit_write_failed", { action: "auth.logout", reason: "AccessDeniedException" });
  // The record still reaches CloudWatch Logs.
  expect(console.info.mock.calls.some(([line]) => JSON.parse(line).audit?.action === "auth.logout")).toBe(true);
});

it("lists a scope newest first without PK or TTL", async () => {
  for (const action of ["auth.session_started", "auth.logout", "auth.session_started"]) {
    await recordAudit(req, { action, actorUserId: "u1" });
  }
  await recordAudit(req, { action: "auth.logout", actorUserId: "u2" });
  const { records } = await listAudit("user#u1");
  expect(records).toHaveLength(3);
  expect(records.map((r) => r.ts)).toEqual([...records.map((r) => r.ts)].sort().reverse());
  expect(records[0].PK).toBeUndefined();
  expect(records[0].expiresAt).toBeUndefined();
});

describe("paging cursor", () => {
  const key = { PK: "AUDIT#a", scope: "platform", ts: "t" };

  it("round-trips a key for the same scope", () => {
    expect(decodeCursor(encodeCursor(key), "platform")).toEqual(key);
  });

  it("refuses a cursor for another scope or with extra keys", () => {
    expect(decodeCursor(encodeCursor(key), "user#u1")).toBeUndefined();
    expect(decodeCursor(encodeCursor({ ...key, evil: 1 }), "platform")).toBeUndefined();
    expect(decodeCursor("not-base64-json", "platform")).toBeUndefined();
    expect(decodeCursor("x".repeat(600), "platform")).toBeUndefined();
  });
});
