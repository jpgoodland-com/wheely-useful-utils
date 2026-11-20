/**
 * Rate-limit bypass regressions (security plan finding H2).
 *
 * Real route handlers and the real shared limiter over fakeDynamo; the
 * per-task limiter is allowed through so only the shared limits are tested.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 9, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { sendEmail } = require("@/lib/email");
const { logSecurityEvent } = require("@/lib/securityLog");
const { seedUser } = require("@/__tests__/helpers/users");
const login = require("@/app/api/auth/login/route");
const forgot = require("@/app/api/auth/forgot-password/route");

const PASSWORD = "Right!Pass1234";
const post = (handler, body, ip) =>
  handler(new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `spoofed-${Math.random()}, ${ip}` },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  jest.clearAllMocks();
  docClient.reset();
  seedUser(docClient, { userId: "u1", username: "alice", email: "alice@example.com", password: bcrypt.hashSync(PASSWORD, 4) });
});

it("guessing one account's password from many IPs is stopped after 10 tries", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post(login.POST, { identifier: "alice@example.com", password: `guess-${i}` }, `198.51.100.${i}`)).status);
  expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);
  // Even the right password is refused until the window passes.
  expect((await post(login.POST, { identifier: "ALICE@example.com", password: PASSWORD }, "203.0.113.200")).status).toBe(429);
  expect(logSecurityEvent).toHaveBeenCalledWith("login_throttled", expect.objectContaining({ scope: "account" }));
});

it("throttles unknown identifiers the same way, so a 429 doesn't reveal an account", async () => {
  const known = [];
  const unknown = [];
  for (let i = 0; i < 11; i++) {
    known.push((await post(login.POST, { identifier: "alice@example.com", password: "x" }, `198.51.100.${i}`)).status);
    unknown.push((await post(login.POST, { identifier: "ghost@example.com", password: "x" }, `198.51.101.${i}`)).status);
  }
  expect(unknown).toEqual(known);
});

it("one IP spraying many accounts is stopped after 30 tries", async () => {
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await post(login.POST, { identifier: `user${i}@example.com`, password: "x" }, "203.0.113.9")).status);
  expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
  expect(statuses[30]).toBe(429);
});

it("rotating the spoofable X-Forwarded-For prefix doesn't reset the per-IP limit", async () => {
  for (let i = 0; i < 30; i++) await post(login.POST, { identifier: `user${i}@example.com`, password: "x" }, "203.0.113.50");
  expect((await post(login.POST, { identifier: "new@example.com", password: "x" }, "203.0.113.50")).status).toBe(429);
});

it("caps reset emails per address, whatever the IP, without changing the reply", async () => {
  const replies = [];
  for (let i = 0; i < 5; i++) replies.push(await (await post(forgot.POST, { email: "alice@example.com" }, `198.51.100.${i}`)).json());
  expect(new Set(replies.map(JSON.stringify)).size).toBe(1);
  expect(sendEmail).toHaveBeenCalledTimes(3);
});
