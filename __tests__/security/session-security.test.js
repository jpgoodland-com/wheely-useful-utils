/**
 * Session security regressions (security plan findings H3 and H4).
 *
 * Runs the real login, reset-password and protected routes over fakeDynamo
 * with real sessions; only the cookie jar is simulated.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users", Wheels: "WheelApp_Wheels", CoinFlip: "WheelApp_CoinFlip", CapacityPlans: "WheelApp_CapacityPlans" } };
});
let jar = {};
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: (name) => (name in jar ? { value: jar[name] } : undefined) })),
}));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/users/passwordHash", () => {
  const bcrypt = require("bcrypt");
  return { hashPassword: (pw) => bcrypt.hash(pw, 4) };
});

const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { getSession } = require("@/lib/session");
const { newToken } = require("@/lib/tokens");
const { createSession } = require("@/lib/sessions/store");
const { seedUser, USERS_TABLE } = require("@/__tests__/helpers/users");
const login = require("@/app/api/auth/login/route");
const resetPassword = require("@/app/api/auth/reset-password/route");
const deleteAccount = require("@/app/api/auth/delete-account/route");
const adminUser = require("@/app/api/admin/users/[userId]/route");

const PASSWORD = "Right!Pass1234";
const json = (body, headers = {}) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Logs in through the real route and returns the Set-Cookie for the session. */
async function loginAs(identifier, headers) {
  const res = await login.POST(json({ identifier, password: PASSWORD }, headers));
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("session="));
  return { res, cookie, token: cookie?.split(";")[0].slice("session=".length) };
}

/** Admin rights need a session that passed MFA (security plan H1). */
async function adminWithMfa() {
  const created = await createSession({ userId: "admin" }, { mfa: true });
  return created;
}

let now;
beforeEach(() => {
  docClient.reset();
  jar = {};
  now = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => now);
  seedUser(docClient, { userId: "u1", username: "alice", password: bcrypt.hashSync(PASSWORD, 4) });
  seedUser(docClient, { userId: "admin", username: "root", password: bcrypt.hashSync(PASSWORD, 4), isAdmin: true });
});
afterEach(() => jest.restoreAllMocks());

describe("session cookie", () => {
  it("is HttpOnly, path-wide, SameSite=Strict for password login and holds an opaque token", async () => {
    const { cookie, token } = await loginAs("alice");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(token.split(".")).toHaveLength(1); // not a JWT
    expect(JSON.stringify(docClient.items(USERS_TABLE))).not.toContain(token);
  });

  it("rotates on every login and revokes the session the browser sent (no fixation)", async () => {
    const first = await loginAs("alice");
    const second = await loginAs("alice", { cookie: `session=${first.token}` });
    expect(second.token).not.toBe(first.token);
    jar = { session: first.token };
    expect(await getSession()).toBeNull();
    jar = { session: second.token };
    expect((await getSession()).userId).toBe("u1");
  });

  it("ignores a forged or legacy JWT cookie", async () => {
    jar = { auth_token: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJhZG1pbiIsImlzQWRtaW4iOnRydWV9.x" };
    expect(await getSession()).toBeNull();
  });
});

describe("revocation", () => {
  it("a password reset signs out every existing session", async () => {
    const { token } = await loginAs("alice");
    const t = newToken();
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "USER#u1"), passwordResetTokenHash: t.hash, passwordResetExpiry: new Date(now + 3600_000).toISOString() });
    now += 1000;
    const res = await resetPassword.POST(json({ userId: "u1", token: t.token, newPassword: "N3w!Password#2025" }));
    expect(res.status).toBe(200);
    jar = { session: token };
    expect(await getSession()).toBeNull();
    expect(docClient.items(USERS_TABLE).filter((i) => i.PK.startsWith("SESSION#"))).toHaveLength(0);
  });

  it("idle sessions expire after 30 minutes without activity", async () => {
    const { token } = await loginAs("alice");
    jar = { session: token };
    now += 29 * 60 * 1000;
    expect(await getSession()).not.toBeNull();
    now += 30 * 60 * 1000;
    expect(await getSession()).toBeNull();
  });

  it("an admin who signed in without MFA gets no admin rights", async () => {
    const { token } = await loginAs("root");
    jar = { session: token };
    const session = await getSession();
    expect(session.isAdmin).toBe(false);
    expect(session.adminMfaRequired).toBe(true);
  });

  it("revoking admin takes effect on the next request", async () => {
    const { token } = await adminWithMfa();
    jar = { session: token };
    expect((await getSession()).isAdmin).toBe(true);
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "USER#admin"), isAdmin: false });
    expect((await getSession()).isAdmin).toBe(false);
  });

  it("an admin-set password signs the target out everywhere", async () => {
    const victim = await loginAs("alice");
    const admin = await adminWithMfa();
    jar = { session: admin.token };
    const res = await adminUser.PATCH(
      new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword: "N3w!Password#2025" }) }),
      { params: Promise.resolve({ userId: "u1" }) }
    );
    expect(res.status).toBe(200);
    jar = { session: victim.token };
    expect(await getSession()).toBeNull();
  });
});

describe("step-up for sensitive actions (H4)", () => {
  const stale = async (username) => {
    const { token } = username === "root" ? await adminWithMfa() : await loginAs(username);
    jar = { session: token };
    now += 11 * 60 * 1000;
  };

  it.each([
    ["delete own account", () => deleteAccount.DELETE(new Request("http://localhost/x", { method: "DELETE", body: "{}" })), "alice"],
    ["admin grants admin", () => adminUser.PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isAdmin: true }) }), { params: Promise.resolve({ userId: "u1" }) }), "root"],
    ["admin sets a password", () => adminUser.PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword: "N3w!Password#2025" }) }), { params: Promise.resolve({ userId: "u1" }) }), "root"],
    ["admin deletes a user", () => adminUser.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ userId: "u1" }) }), "root"],
  ])("%s needs re-auth after 10 minutes and changes nothing", async (_label, run, username) => {
    await stale(username);
    const before = JSON.stringify(docClient.items(USERS_TABLE).filter((i) => !i.PK.startsWith("SESSION#")));
    const res = await run();
    expect(res.status).toBe(401);
    expect((await res.json()).reauthRequired).toBe(true);
    expect(JSON.stringify(docClient.items(USERS_TABLE).filter((i) => !i.PK.startsWith("SESSION#")))).toBe(before);
  });
});
