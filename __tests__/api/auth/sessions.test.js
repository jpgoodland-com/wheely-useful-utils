/**
 * Session routes: logout, me, reauth, and listing/revoking sessions.
 * Uses the real session store and getSession() over fakeDynamo; only the
 * cookie jar (next/headers) is simulated.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
let jar = {};
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: (name) => (name in jar ? { value: jar[name] } : undefined) })),
}));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));

const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { checkRateLimit } = require("@/lib/rateLimit");
const { createSession, readSession } = require("@/lib/sessions/store");
const { seedUser } = require("@/__tests__/helpers/users");
const logout = require("@/app/api/auth/logout/route");
const me = require("@/app/api/auth/me/route");
const reauth = require("@/app/api/auth/reauth/route");
const sessions = require("@/app/api/auth/sessions/route");
const oneSession = require("@/app/api/auth/sessions/[sessionId]/route");

const PASSWORD = "Right!Pass1234";

async function signInAs(userId) {
  const created = await createSession({ userId });
  jar = { session: created.token };
  return created;
}

const post = (handler, body, headers = {}) =>
  handler(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => {
  docClient.reset();
  jar = {};
  checkRateLimit.mockImplementation(() => ({ allowed: true, resetMs: Date.now() + 1000 }));
  seedUser(docClient, { userId: "u1", username: "alice", password: bcrypt.hashSync(PASSWORD, 4), isAdmin: false });
  seedUser(docClient, { userId: "u2", username: "bob", oauthProviders: ["google"] });
});

describe("GET /api/auth/me", () => {
  it("returns the live user without the session id", async () => {
    await signInAs("u1");
    const { user } = await (await me.GET()).json();
    expect(user).toMatchObject({ userId: "u1", username: "alice", isAdmin: false, hasPassword: true, amr: "pwd" });
    expect(user.sessionId).toBeUndefined();
    expect(JSON.stringify(user)).not.toContain(jar.session);
  });

  it("withholds admin rights from a session without MFA", async () => {
    docClient.put("WheelApp_Users", { ...docClient.get("WheelApp_Users", "USER#u1"), isAdmin: true });
    await signInAs("u1");
    const { user } = await (await me.GET()).json();
    expect(user).toMatchObject({ isAdmin: false, adminMfaRequired: true, mfa: false });
  });

  it("reflects an admin change on the very next request (no stale claim)", async () => {
    const created = await createSession({ userId: "u1" }, { mfa: true });
    jar = { session: created.token };
    docClient.put("WheelApp_Users", { ...docClient.get("WheelApp_Users", "USER#u1"), isAdmin: true });
    expect((await (await me.GET()).json()).user.isAdmin).toBe(true);
  });

  it("returns null without a session cookie", async () => {
    expect((await (await me.GET()).json()).user).toBeNull();
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the session server-side, so a copied cookie stops working", async () => {
    const { token } = await signInAs("u1");
    const res = await logout.POST(new Request("http://localhost/x", { method: "POST", headers: { cookie: `session=${token}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/(^|, )session=;/);
    expect(await readSession(token)).toBeNull();
  });

  it("succeeds without a cookie", async () => {
    expect((await logout.POST(new Request("http://localhost/x", { method: "POST" }))).status).toBe(200);
  });
});

describe("POST /api/auth/reauth", () => {
  it("marks the session as recently authenticated with the right password", async () => {
    const { sid } = await signInAs("u1");
    docClient.put("WheelApp_Users", { ...docClient.get("WheelApp_Users", `SESSION#${sid}`), authAt: 0 });
    const res = await post(reauth.POST, { password: PASSWORD });
    expect(res.status).toBe(200);
    expect(docClient.get("WheelApp_Users", `SESSION#${sid}`).authAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("rejects a wrong password without refreshing the session", async () => {
    const { sid } = await signInAs("u1");
    docClient.put("WheelApp_Users", { ...docClient.get("WheelApp_Users", `SESSION#${sid}`), authAt: 0 });
    expect((await post(reauth.POST, { password: "wrong" })).status).toBe(401);
    expect(docClient.get("WheelApp_Users", `SESSION#${sid}`).authAt).toBe(0);
  });

  it("is rate-limited per user across tasks (5 per 15 minutes)", async () => {
    await signInAs("u1");
    for (let i = 0; i < 5; i++) expect((await post(reauth.POST, { password: "wrong" })).status).toBe(401);
    // Even the right password is refused once the budget is spent.
    expect((await post(reauth.POST, { password: PASSWORD })).status).toBe(429);
    expect(docClient.items("WheelApp_Users").some((i) => i.PK.startsWith("RATE#") && i.hits === 6)).toBe(true);
  });

  it("tells provider-only accounts to use their provider", async () => {
    await signInAs("u2");
    expect((await post(reauth.POST, { password: "anything" })).status).toBe(400);
  });

  it("requires a session and a password", async () => {
    expect((await post(reauth.POST, { password: PASSWORD })).status).toBe(401);
    await signInAs("u1");
    expect((await post(reauth.POST, {})).status).toBe(400);
  });
});

describe("/api/auth/sessions", () => {
  it("lists the user's sessions and marks the current one", async () => {
    const other = await createSession({ userId: "u1" });
    await createSession({ userId: "u2" });
    const current = await signInAs("u1");
    const { sessions: list } = await (await sessions.GET()).json();
    expect(list.map((s) => [s.id, s.current])).toEqual(expect.arrayContaining([[current.sid, true], [other.sid, false]]));
    expect(list).toHaveLength(2);
  });

  it("signs out everywhere else, keeping this browser", async () => {
    const other = await createSession({ userId: "u1" });
    const current = await signInAs("u1");
    const res = await sessions.DELETE();
    expect(await res.json()).toMatchObject({ success: true, revoked: 1 });
    expect(await readSession(other.token)).toBeNull();
    expect(await readSession(current.token)).not.toBeNull();
  });

  it("revokes one of your own sessions", async () => {
    const other = await createSession({ userId: "u1" });
    await signInAs("u1");
    const res = await oneSession.DELETE(new Request("http://localhost/x"), { params: Promise.resolve({ sessionId: other.sid }) });
    expect(res.status).toBe(200);
    expect(await readSession(other.token)).toBeNull();
  });

  it("cannot revoke another user's session (404, untouched)", async () => {
    const victim = await createSession({ userId: "u2" });
    await signInAs("u1");
    const res = await oneSession.DELETE(new Request("http://localhost/x"), { params: Promise.resolve({ sessionId: victim.sid }) });
    expect(res.status).toBe(404);
    expect(await readSession(victim.token)).not.toBeNull();
  });

  it("requires a session", async () => {
    expect((await sessions.GET()).status).toBe(401);
    expect((await sessions.DELETE()).status).toBe(401);
  });
});
