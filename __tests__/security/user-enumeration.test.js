/**
 * User-enumeration regressions (security plan finding M3).
 *
 * For each public auth endpoint, a registered and an unregistered
 * identifier must produce byte-identical responses (status and body).
 */
jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));
jest.mock("@/lib/users/passwordHash", () => ({ hashPassword: async (pw) => `h:${pw}` }));

const bcrypt = require("bcrypt");
const { docClient } = require("@/lib/dynamodb");
const { sendEmail } = require("@/lib/email");
const { seedUser } = require("@/__tests__/helpers/users");

const routes = {
  login: require("@/app/api/auth/login/route").POST,
  signup: require("@/app/api/auth/signup/route").POST,
  forgot: require("@/app/api/auth/forgot-password/route").POST,
  resend: require("@/app/api/auth/resend-verification/route").POST,
  verify: require("@/app/api/auth/verify/route").POST,
  reset: require("@/app/api/auth/reset-password/route").POST,
};

const call = async (route, body) => {
  const res = await routes[route](new Request("http://localhost/x", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  docClient.reset();
  seedUser(docClient, { userId: "known", username: "known", email: "known@example.com", password: bcrypt.hashSync("Right!Pass1234", 4) });
  seedUser(docClient, { userId: "social", username: "social", email: "social@example.com", oauthProviders: ["google"] });
  seedUser(docClient, { userId: "pending", username: "pending", email: "pending@example.com", isVerified: false });
});

it.each([
  ["login: wrong password vs unknown user", "login", { identifier: "known@example.com", password: "Wrong!Pass1234" }, { identifier: "ghost@example.com", password: "Wrong!Pass1234" }],
  ["login: social-only account vs unknown user", "login", { identifier: "social@example.com", password: "Wrong!Pass1234" }, { identifier: "ghost@example.com", password: "Wrong!Pass1234" }],
  ["signup: registered vs new email", "signup", { email: "known@example.com", username: "fresh1", password: "Str0ng!Passw0rd#", firstName: "A", lastName: "B" }, { email: "brandnew@example.com", username: "fresh2", password: "Str0ng!Passw0rd#", firstName: "A", lastName: "B" }],
  ["forgot-password: registered vs unknown", "forgot", { email: "known@example.com" }, { email: "ghost@example.com" }],
  ["resend-verification: pending vs unknown", "resend", { email: "pending@example.com" }, { email: "ghost@example.com" }],
  ["resend-verification: verified vs unknown", "resend", { email: "known@example.com" }, { email: "ghost@example.com" }],
  ["verify: real user id vs unknown id", "verify", { userId: "pending", token: "x" }, { userId: "ghost", token: "x" }],
  ["reset-password: real user id vs unknown id", "reset", { userId: "known", token: "x", newPassword: "N3w!Password#2025" }, { userId: "ghost", token: "x", newPassword: "N3w!Password#2025" }],
])("%s gives identical responses", async (_label, route, known, unknown) => {
  expect(await call(route, known)).toEqual(await call(route, unknown));
});

it("forgot-password still answers generically when SES fails for a real account", async () => {
  sendEmail.mockRejectedValueOnce(new Error("SES"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await call("forgot", { email: "known@example.com" })).toEqual(await call("forgot", { email: "ghost@example.com" }));
});
