/**
 * Audit trail coverage (security plan finding H12).
 *
 * Privileged and account-security actions must each leave an audit record,
 * the trail must be readable only by the right people, and it must never
 * contain secrets.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return {
    docClient: createFakeDynamo(),
    TableNames: { Users: "WheelApp_Users", Wheels: "WheelApp_Wheels", CoinFlip: "WheelApp_CoinFlip", CapacityPlans: "WheelApp_CapacityPlans", Audit: "WheelApp_Audit" },
  };
});
let jar = {};
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: (name) => (name in jar ? { value: jar[name] } : undefined) })),
}));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { createSession } = require("@/lib/sessions/store");
const { currentStep, totpForStep } = require("@/lib/mfa/totp");
const { seedUser } = require("@/__tests__/helpers/users");

const PASSWORD = "Right!Pass1234";
const audit = () => docClient.items("WheelApp_Audit");
const actions = () => audit().map((r) => r.action);
const json = (body, method = "POST") => new Request("http://localhost:3000/x", { method, headers: { "content-type": "application/json", host: "localhost:3000" }, body: JSON.stringify(body) });

beforeEach(() => {
  docClient.reset();
  jar = {};
  jest.spyOn(console, "info").mockImplementation(() => {});
  seedUser(docClient, { userId: "u1", username: "alice", password: bcrypt.hashSync(PASSWORD, 4) });
  seedUser(docClient, { userId: "admin", username: "root", password: bcrypt.hashSync(PASSWORD, 4), isAdmin: true });
});
afterEach(() => jest.restoreAllMocks());

async function as(userId, opts) {
  jar = { session: (await createSession({ userId }, opts)).token };
}

it("records sign-in, sign-out and other-session revocation", async () => {
  const login = require("@/app/api/auth/login/route");
  const res = await login.POST(json({ identifier: "alice", password: PASSWORD }));
  const token = res.headers.getSetCookie().find((c) => c.startsWith("session=")).split(";")[0].slice(8);
  jar = { session: token };
  await require("@/app/api/auth/sessions/route").DELETE(json({}, "DELETE"));
  await require("@/app/api/auth/logout/route").POST(new Request("http://x", { method: "POST", headers: { cookie: `session=${token}` } }));
  expect(actions()).toEqual(["auth.session_started", "auth.sessions_revoked", "auth.logout"]);
  expect(audit()[0]).toMatchObject({ scope: "user#u1", details: { method: "pwd", mfa: false } });
});

it("records MFA changes", async () => {
  await as("u1");
  const totp = require("@/app/api/auth/mfa/totp/route");
  const { secret } = await (await totp.POST()).json();
  await totp.PUT(json({ code: totpForStep(secret, currentStep()) }, "PUT"));
  await require("@/app/api/auth/mfa/recovery-codes/route").POST(json({}));
  await totp.DELETE(json({}, "DELETE"));
  expect(actions()).toEqual(["mfa.totp_enabled", "mfa.recovery_regenerated", "mfa.totp_removed"]);
});

it("records admin grants and password sets under the platform scope", async () => {
  await as("admin", { mfa: true });
  const route = require("@/app/api/admin/users/[userId]/route");
  const params = { params: Promise.resolve({ userId: "u1" }) };
  await route.PATCH(json({ isAdmin: true }, "PATCH"), params);
  await route.PATCH(json({ newPassword: "N3w!Password#2025" }, "PATCH"), params);
  expect(audit().map((r) => [r.action, r.scope, r.actorUserId, r.targetUserId])).toEqual([
    ["admin.role_granted", "platform", "admin", "u1"],
    ["admin.password_set", "platform", "admin", "u1"],
  ]);
});

it("never stores secrets in the trail", async () => {
  await as("u1");
  const totp = require("@/app/api/auth/mfa/totp/route");
  const { secret } = await (await totp.POST()).json();
  const code = totpForStep(secret, currentStep());
  const { recoveryCodes } = await (await totp.PUT(json({ code }, "PUT"))).json();
  const dump = JSON.stringify(audit());
  for (const value of [secret, code, recoveryCodes[0], PASSWORD, jar.session]) expect(dump).not.toContain(value);
});

describe("reading the trail", () => {
  it("the platform log is for MFA admins only", async () => {
    const route = require("@/app/api/admin/audit/route");
    const get = () => route.GET(new Request("http://localhost/api/admin/audit"));
    await as("u1");
    expect((await get()).status).toBe(403);
    await as("admin", { mfa: false });
    expect((await get()).status).toBe(403);
    await as("admin", { mfa: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("users see only their own activity", async () => {
    const { recordAudit } = require("@/lib/audit");
    await recordAudit(null, { action: "auth.session_started", actorUserId: "u1" });
    await recordAudit(null, { action: "mfa.totp_enabled", actorUserId: "u1" });
    await recordAudit(null, { action: "auth.logout", actorUserId: "admin" });
    await recordAudit(null, { action: "admin.role_granted", actorUserId: "admin", actorType: "admin", targetUserId: "someone" });
    await as("u1");
    const { records } = await (await require("@/app/api/auth/activity/route").GET(new Request("http://localhost/api/auth/activity"))).json();
    expect(records.map((r) => r.action).sort()).toEqual(["auth.session_started", "mfa.totp_enabled"]);
    // Only what a user needs about their own events; no internal ids.
    expect(Object.keys(records[0]).sort()).toEqual(["action", "at", "details", "ip", "result", "userAgent"]);
  });
});

it("every route that changes accounts, factors, sessions or admin rights writes an audit record", () => {
  const ROOT = path.join(__dirname, "../..");
  const mustAudit = {
    "app/api/auth/signup/route.js": ["account.created"],
    "app/api/auth/callback/[provider]/route.js": ["account.created"],
    "app/api/auth/delete-account/route.js": ["account.deleted"],
    "app/api/auth/logout/route.js": ["auth.logout"],
    "app/api/auth/reauth/route.js": ["auth.reauthenticated"],
    "app/api/auth/reset-password/route.js": ["auth.password_reset"],
    "app/api/auth/sessions/route.js": ["auth.sessions_revoked"],
    "app/api/auth/sessions/[sessionId]/route.js": ["auth.session_revoked"],
    "app/api/auth/mfa/totp/route.js": ["mfa.totp_enabled", "mfa.totp_removed"],
    "app/api/auth/mfa/passkeys/route.js": ["mfa.passkey_added"],
    "app/api/auth/mfa/passkeys/[credentialId]/route.js": ["mfa.passkey_removed"],
    "app/api/auth/mfa/recovery-codes/route.js": ["mfa.recovery_regenerated"],
    "app/api/admin/users/route.js": ["admin.user_created", "admin.role_granted"],
    "app/api/admin/users/[userId]/route.js": ["admin.user_deleted", "admin.password_set", "admin.role_granted", "admin.role_revoked"],
    "app/api/admin/invite/route.js": ["admin.invite_sent"],
    "lib/sessions/store.js": ["auth.session_started"],
  };
  for (const [file, expected] of Object.entries(mustAudit)) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const action of expected) expect({ file, action, found: src.includes(`"${action}"`) }).toEqual({ file, action, found: true });
  }
});
