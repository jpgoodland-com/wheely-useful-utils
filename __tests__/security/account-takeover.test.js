/**
 * Account-takeover regressions (security plan findings C1, C2, C3, C5).
 *
 * Each test runs a full attack across the real route handlers over a shared
 * in-memory DynamoDB, so the routes are checked together rather than each
 * one alone.
 */
process.env.OAUTH_GOOGLE_CLIENT_ID = "google-cid";
process.env.OAUTH_GOOGLE_CLIENT_SECRET = "google-cs";

jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("@/lib/users/passwordHash", () => {
  const bcrypt = require("bcrypt");
  return { hashPassword: (pw) => bcrypt.hash(pw, 4) };
});
jest.mock("@/lib/oauth", () => ({
  ...jest.requireActual("@/lib/oauth"),
  exchangeCode: jest.fn(async () => ({ access_token: "a", id_token: "i" })),
  fetchUserProfile: jest.fn(),
}));
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: (n) => ({ oauth_state: { value: "s" }, oauth_nonce: { value: "n" }, oauth_verifier: { value: "v" } })[n] })),
}));

const { docClient } = require("@/lib/dynamodb");
const { fetchUserProfile } = require("@/lib/oauth");
const { readSession } = require("@/lib/sessions/store");
const signup = require("@/app/api/auth/signup/route");
const login = require("@/app/api/auth/login/route");
const callback = require("@/app/api/auth/callback/[provider]/route");
const { USERS_TABLE } = require("@/__tests__/helpers/users");

const json = (url, body) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const signupAs = (fields) =>
  signup.POST(json("/api/auth/signup", { password: "Attacker!Pass123", firstName: "A", lastName: "B", ...fields }));

const loginAs = (identifier, password) => login.POST(json("/api/auth/login", { identifier, password }));

async function oauthAs(email, emailVerified = true, provider = "google") {
  fetchUserProfile.mockResolvedValueOnce({ email, name: "Victim", emailVerified, subject: "sub" });
  const req = new Request(`http://localhost/api/auth/callback/${provider}?code=c&state=s`, { headers: { host: "localhost:3000" } });
  const res = await callback.GET(req, { params: Promise.resolve({ provider }) });
  const cookie = res.headers.getSetCookie().find((c) => /^session=[^;]+/.test(c));
  const found = cookie ? await readSession(cookie.split(";")[0].slice("session=".length)) : null;
  return { res, session: found && { userId: found.user.userId, email: found.user.email, isAdmin: found.user.isAdmin === true } };
}

const verifyAll = () => {
  for (const item of docClient.items(USERS_TABLE)) docClient.put(USERS_TABLE, { ...item, isVerified: true });
};

beforeEach(() => {
  docClient.reset();
  delete process.env.ADMIN_EMAILS;
});

describe("C1: username squatting an email address", () => {
  it("signup refuses a username that is an email address", async () => {
    const res = await signupAs({ email: "attacker@evil.com", username: "ceo@victim.com" });
    expect(res.status).toBe(400);
  });

  it("a legacy squatter username never captures the victim's OAuth sign-in", async () => {
    docClient.put(USERS_TABLE, {
      PK: "USER#USERNAME#ceo@victim.com", userId: "attacker", username: "ceo@victim.com",
      email: "attacker@evil.com", EmailOrUsername: "ceo@victim.com", isVerified: true,
    });
    const { session } = await oauthAs("ceo@victim.com");
    expect(session?.userId).not.toBe("attacker");
  });
});

describe("C2: unverified provider emails", () => {
  it("a forged Microsoft email cannot sign in to the victim's account", async () => {
    await signupAs({ email: "victim@corp.com", username: "victim", password: "Victim!Pass1234" });
    verifyAll();
    const { res, session } = await oauthAs("victim@corp.com", false, "microsoft");
    expect(session).toBeNull();
    expect(res.headers.get("location")).toContain("error=email_unverified");
  });

  it("a forged email cannot create an account that squats the address", async () => {
    await oauthAs("future-hire@corp.com", false, "microsoft");
    expect(docClient.items(USERS_TABLE)).toHaveLength(0);
  });
});

describe("C3: admin by email domain", () => {
  it("an @example.com identity is not an admin without ADMIN_EMAILS", async () => {
    const { session } = await oauthAs("anyone@example.com");
    expect(session.isAdmin).toBe(false);
  });

  it("C2 + C3 chain: a forged admin-domain email gets no session at all", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    const { session } = await oauthAs("owner@example.com", false, "microsoft");
    expect(session).toBeNull();
  });
});

describe("C5: pre-account hijacking", () => {
  it("the attacker's password stops working once the real owner signs in with Google", async () => {
    await signupAs({ email: "victim@corp.com", username: "squatter" }); // never verified
    const { session } = await oauthAs("victim@corp.com");
    expect(session?.email).toBe("victim@corp.com");

    const res = await loginAs("victim@corp.com", "Attacker!Pass123");
    expect(res.status).toBe(401);
    const byUsername = await loginAs("squatter", "Attacker!Pass123");
    expect(byUsername.status).toBe(401);
  });

  it("the real owner's own signup replaces the squatter's unverified account", async () => {
    await signupAs({ email: "victim@corp.com", username: "squatter" });
    await signupAs({ email: "victim@corp.com", username: "victim", password: "Victim!Pass1234" });
    verifyAll();

    expect((await loginAs("victim@corp.com", "Attacker!Pass123")).status).toBe(401);
    expect((await loginAs("squatter", "Attacker!Pass123")).status).toBe(401);
    expect((await loginAs("victim@corp.com", "Victim!Pass1234")).status).toBe(200);
  });

  it("unverified signups carry a TTL so a squat expires on its own", async () => {
    await signupAs({ email: "victim@corp.com", username: "squatter" });
    for (const item of docClient.items(USERS_TABLE)) expect(item.expiresAt).toEqual(expect.any(Number));
  });
});
