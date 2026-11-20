/**
 * Token storage regressions (security plan finding H11).
 *
 * After each flow that emails a link, nothing in the Users table may
 * contain the emailed token: only its SHA-256 hash is stored.
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/session", () => ({ getSession: jest.fn(async () => ({ userId: "admin", username: "admin", isAdmin: true })) }));
jest.mock("@/lib/users/passwordHash", () => ({ hashPassword: async (pw) => `h:${pw}` }));

const { docClient } = require("@/lib/dynamodb");
const { sendEmail } = require("@/lib/email");
const { hashToken } = require("@/lib/tokens");
const { seedUser, USERS_TABLE } = require("@/__tests__/helpers/users");

const post = (handler, body) =>
  handler(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const emailedToken = () => sendEmail.mock.calls.at(-1)[0].text.match(/token=([0-9a-f]{64})/)[1];
const tableDump = () => JSON.stringify(docClient.items(USERS_TABLE));

beforeEach(() => {
  jest.clearAllMocks();
  docClient.reset();
});

it.each([
  ["signup verification", async () => post(require("@/app/api/auth/signup/route").POST, { email: "n@example.com", username: "newbie", password: "Str0ng!Passw0rd#", firstName: "N", lastName: "B" })],
  ["resend verification", async () => {
    seedUser(docClient, { userId: "p", username: "pending", isVerified: false });
    return post(require("@/app/api/auth/resend-verification/route").POST, { email: "pending@example.com" });
  }],
  ["password reset", async () => {
    seedUser(docClient, { userId: "k", username: "known" });
    return post(require("@/app/api/auth/forgot-password/route").POST, { email: "known@example.com" });
  }],
  ["admin invite", async () => post(require("@/app/api/admin/invite/route").POST, { email: "invitee@example.com" })],
])("%s stores only the token hash", async (_label, run) => {
  await run();
  const token = emailedToken();
  expect(tableDump()).not.toContain(token);
  expect(tableDump()).toContain(hashToken(token));
});

it("a reset link stops working after one use", async () => {
  seedUser(docClient, { userId: "k", username: "known" });
  await post(require("@/app/api/auth/forgot-password/route").POST, { email: "known@example.com" });
  const token = emailedToken();
  const reset = require("@/app/api/auth/reset-password/route").POST;
  expect((await post(reset, { userId: "k", token, newPassword: "N3w!Password#2025" })).status).toBe(200);
  expect((await post(reset, { userId: "k", token, newPassword: "An0ther!Password#" })).status).toBe(400);
});

it("the stored hash itself is not accepted as a reset token", async () => {
  seedUser(docClient, { userId: "k", username: "known" });
  await post(require("@/app/api/auth/forgot-password/route").POST, { email: "known@example.com" });
  const stored = docClient.get(USERS_TABLE, "USER#k").passwordResetTokenHash;
  const res = await post(require("@/app/api/auth/reset-password/route").POST, { userId: "k", token: stored, newPassword: "N3w!Password#2025" });
  expect(res.status).toBe(400);
});
