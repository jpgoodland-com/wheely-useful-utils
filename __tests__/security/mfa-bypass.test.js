/**
 * MFA bypass regressions (security plan finding H1).
 *
 * The second factor must stand between a correct first factor (password or
 * provider) and a session, and admin rights must need it.
 */
process.env.OAUTH_GOOGLE_CLIENT_ID = "google-cid";
process.env.OAUTH_GOOGLE_CLIENT_SECRET = "google-cs";

jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users", Wheels: "WheelApp_Wheels" } };
});
let jar = {};
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get: (name) => (name in jar ? { value: jar[name] } : undefined) })),
}));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("@/lib/oauth", () => ({
  ...jest.requireActual("@/lib/oauth"),
  exchangeCode: jest.fn(async () => ({ access_token: "a", id_token: "i" })),
  fetchUserProfile: jest.fn(async () => ({ email: "alice@example.com", name: "Alice", emailVerified: true, subject: "s" })),
}));

const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { getSession } = require("@/lib/session");
const { createSession } = require("@/lib/sessions/store");
const { encryptSecret } = require("@/lib/crypto/secretBox");
const { generateTotpSecret } = require("@/lib/mfa/totp");
const { seedUser, USERS_TABLE } = require("@/__tests__/helpers/users");
const login = require("@/app/api/auth/login/route");
const verify = require("@/app/api/auth/mfa/verify/route");
const callback = require("@/app/api/auth/callback/[provider]/route");
const sessionsRoute = require("@/app/api/auth/sessions/route");
const adminUsers = require("@/app/api/admin/users/route");

const PASSWORD = "Right!Pass1234";
const cookieValue = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

beforeEach(async () => {
  docClient.reset();
  jar = {};
  const secret = generateTotpSecret();
  seedUser(docClient, { userId: "u1", username: "alice", email: "alice@example.com", password: bcrypt.hashSync(PASSWORD, 4) });
  docClient.put(USERS_TABLE, {
    ...docClient.get(USERS_TABLE, "USER#u1"),
    mfaTotp: { secretEnc: await encryptSecret(secret, { userId: "u1", purpose: "totp" }), enabledAt: "x" },
    mfaTotpLastStep: -1,
    mfaVersion: 1,
  });
});

async function passwordStep() {
  const res = await login.POST(new Request("http://localhost/x", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "alice@example.com", password: PASSWORD }),
  }));
  return { res, challenge: cookieValue(res, "mfa_challenge") };
}

it("a correct password alone sets no session cookie", async () => {
  const { res, challenge } = await passwordStep();
  expect(cookieValue(res, "session")).toBeUndefined();
  expect(challenge).toBeDefined();
  expect(docClient.items(USERS_TABLE).filter((i) => i.PK.startsWith("SESSION#"))).toHaveLength(0);
});

it("the challenge token can't be used as a session", async () => {
  const { challenge } = await passwordStep();
  jar = { session: challenge };
  expect(await getSession()).toBeNull();
  jar = { mfa_challenge: challenge };
  expect(await getSession()).toBeNull();
  expect((await sessionsRoute.GET()).status).toBe(401);
});

it("only the hash of the challenge token is stored", async () => {
  const { challenge } = await passwordStep();
  expect(JSON.stringify(docClient.items(USERS_TABLE))).not.toContain(challenge);
});

it("a provider sign-in for an MFA user goes to the second step, not a session", async () => {
  jar = { oauth_state: "s", oauth_nonce: "n", oauth_verifier: "v" };
  const req = new Request("http://localhost/api/auth/callback/google?code=c&state=s", { headers: { host: "localhost:3000" } });
  const res = await callback.GET(req, { params: Promise.resolve({ provider: "google" }) });
  expect(new URL(res.headers.get("location")).pathname).toBe("/login/mfa");
  expect(cookieValue(res, "session")).toBeUndefined();
  expect(cookieValue(res, "mfa_challenge")).toBeDefined();
});

it("guessing codes can't succeed: the challenge dies after five tries", async () => {
  const { challenge } = await passwordStep();
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const res = await verify.POST(new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `mfa_challenge=${challenge}` },
      body: JSON.stringify({ method: "totp", code: String(100000 + i) }),
    }));
    statuses.push((await res.json()).restart === true);
  }
  expect(statuses.slice(0, 4)).toEqual([false, false, false, false]);
  expect(statuses.slice(4).every(Boolean)).toBe(true);
});

it("the TOTP seed is never stored in plaintext", async () => {
  const dump = JSON.stringify(docClient.get(USERS_TABLE, "USER#u1"));
  expect(dump).toMatch(/"secretEnc":"local:/);
});

describe("admin rights need MFA", () => {
  beforeEach(() => {
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "USER#u1"), isAdmin: true });
  });

  it("a password-only admin session is refused by admin routes", async () => {
    jar = { session: (await createSession({ userId: "u1" }, { mfa: false })).token };
    expect((await adminUsers.GET()).status).toBe(403);
  });

  it("an MFA admin session is allowed", async () => {
    jar = { session: (await createSession({ userId: "u1" }, { mfa: true })).token };
    expect((await adminUsers.GET()).status).toBe(200);
  });
});
