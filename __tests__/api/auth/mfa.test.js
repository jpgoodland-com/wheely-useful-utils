/**
 * MFA routes over the real session and MFA stores (fakeDynamo).
 * Only the WebAuthn signature checks are stubbed; e2e/mfa.spec.js runs
 * passkeys against a virtual authenticator.
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
jest.mock("@simplewebauthn/server", () => ({
  ...jest.requireActual("@simplewebauthn/server"),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const bcrypt = require("bcrypt");
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require("@simplewebauthn/server");
const { docClient } = require("@/lib/dynamodb");
const { createSession, readSession } = require("@/lib/sessions/store");
const { currentStep, totpForStep } = require("@/lib/mfa/totp");
const { seedUser, USERS_TABLE } = require("@/__tests__/helpers/users");
const login = require("@/app/api/auth/login/route");
const verify = require("@/app/api/auth/mfa/verify/route");
const challengeRoute = require("@/app/api/auth/mfa/challenge/route");
const passkeyOptions = require("@/app/api/auth/mfa/passkey-options/route");
const status = require("@/app/api/auth/mfa/route");
const totp = require("@/app/api/auth/mfa/totp/route");
const passkeys = require("@/app/api/auth/mfa/passkeys/route");
const passkeyOne = require("@/app/api/auth/mfa/passkeys/[credentialId]/route");
const recovery = require("@/app/api/auth/mfa/recovery-codes/route");
const reauth = require("@/app/api/auth/reauth/route");

const PASSWORD = "Right!Pass1234";
const json = (body, headers = {}, method = "POST") =>
  new Request("http://localhost:3000/x", { method, headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: JSON.stringify(body) });
const user = () => docClient.get(USERS_TABLE, "USER#u1");
const cookieValue = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

let now;
async function signIn({ mfa = false, stale = false } = {}) {
  const created = await createSession({ userId: "u1" }, { mfa });
  jar = { session: created.token };
  if (stale) now += 11 * 60 * 1000;
  return created;
}

/** Turns on TOTP through the real routes and returns the secret. */
async function enableTotp() {
  await signIn();
  const setup = await (await totp.POST()).json();
  const res = await totp.PUT(json({ code: totpForStep(setup.secret, currentStep(now)) }));
  expect(res.status).toBe(200);
  return { secret: setup.secret, recoveryCodes: (await res.json()).recoveryCodes };
}

async function passwordLogin() {
  const res = await login.POST(json({ identifier: "alice", password: PASSWORD }));
  return { res, body: await res.json(), challenge: cookieValue(res, "mfa_challenge"), session: cookieValue(res, "session") };
}

const verifyWith = (challenge, body) => verify.POST(json(body, { cookie: `mfa_challenge=${challenge}` }));
// A code for a fresh step, so replay protection doesn't reject it.
const nextCode = (secret) => {
  now += 30 * 1000;
  return totpForStep(secret, currentStep(now));
};

beforeEach(() => {
  docClient.reset();
  jar = {};
  now = Date.parse("2026-11-17T10:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => now);
  seedUser(docClient, { userId: "u1", username: "alice", email: "alice@example.com", password: bcrypt.hashSync(PASSWORD, 4) });
  verifyRegistrationResponse.mockReset();
  verifyAuthenticationResponse.mockReset();
});
afterEach(() => jest.restoreAllMocks());

describe("TOTP setup", () => {
  it("needs a recent re-auth to start", async () => {
    await signIn({ stale: true });
    const res = await totp.POST();
    expect(res.status).toBe(401);
    expect((await res.json()).reauthRequired).toBe(true);
    expect(user().mfaTotpPending).toBeUndefined();
  });

  it("returns a QR code and secret, uncached, and stores only the encrypted seed", async () => {
    await signIn();
    const res = await totp.POST();
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.otpauthUrl).toContain(`secret=${body.secret}`);
    expect(JSON.stringify(user())).not.toContain(body.secret);
    expect(user().mfaTotpPending.secretEnc).toMatch(/^local:/);
  });

  it("turns on with a correct code, gives recovery codes once and signs out other sessions", async () => {
    const other = await createSession({ userId: "u1" });
    const current = await signIn();
    const setup = await (await totp.POST()).json();
    const res = await totp.PUT(json({ code: totpForStep(setup.secret, currentStep(now)) }));
    const body = await res.json();

    expect(body).toMatchObject({ enabled: true, totp: true, recoveryCodesRemaining: 10 });
    expect(body.recoveryCodes).toHaveLength(10);
    expect(user().mfaTotpPending).toBeUndefined();
    expect(await readSession(other.token)).toBeNull();
    expect((await readSession(current.token)).session.mfa).toBe(true);
    expect((await (await status.GET()).json()).recoveryCodes).toBeUndefined();
  });

  it("rejects a wrong code", async () => {
    await signIn();
    await totp.POST();
    expect((await totp.PUT(json({ code: "000000" }))).status).toBe(400);
    expect(user().mfaTotp).toBeUndefined();
  });

  it("rejects even a correct code once setup has expired (10 minutes)", async () => {
    await signIn();
    const { secret } = await (await totp.POST()).json();
    now += 10 * 60 * 1000 + 1;
    jar = { session: (await createSession({ userId: "u1" })).token };
    expect((await totp.PUT(json({ code: totpForStep(secret, currentStep(now)) }))).status).toBe(400);
    expect(user().mfaTotp).toBeUndefined();
  });

  it("refuses a second setup while TOTP is on", async () => {
    await enableTotp();
    expect((await totp.POST()).status).toBe(409);
  });

  it("removing it needs re-auth", async () => {
    await enableTotp();
    now += 11 * 60 * 1000;
    expect((await totp.DELETE()).status).toBe(401);
    expect(user().mfaTotp).toBeDefined();
    await signIn();
    const body = await (await totp.DELETE()).json();
    expect(body).toMatchObject({ enabled: false, totp: false, recoveryCodesRemaining: 0 });
  });
});

describe("sign-in with MFA", () => {
  it("withholds the session until the second factor passes", async () => {
    const { secret } = await enableTotp();
    jar = {};
    const first = await passwordLogin();
    expect(first.body).toEqual({ mfaRequired: true, methods: ["totp", "recovery"] });
    expect(first.session).toBeUndefined();
    expect(first.challenge).toBeDefined();
    expect(first.res.headers.getSetCookie().find((c) => c.startsWith("mfa_challenge="))).toMatch(/Path=\/api\/auth\/mfa/);

    const methods = await (await challengeRoute.GET(new Request("http://localhost/x", { headers: { cookie: `mfa_challenge=${first.challenge}` } }))).json();
    expect(methods.methods).toContain("totp");

    const res = await verifyWith(first.challenge, { method: "totp", code: nextCode(secret) });
    expect(res.status).toBe(200);
    const token = cookieValue(res, "session");
    expect((await readSession(token)).session).toMatchObject({ mfa: true, amr: "pwd" });
  });

  it("rejects the same TOTP code twice", async () => {
    const { secret } = await enableTotp();
    const code = nextCode(secret);
    expect((await verifyWith((await passwordLogin()).challenge, { method: "totp", code })).status).toBe(200);
    expect((await verifyWith((await passwordLogin()).challenge, { method: "totp", code })).status).toBe(401);
  });

  it("accepts each recovery code once", async () => {
    const { recoveryCodes } = await enableTotp();
    expect((await verifyWith((await passwordLogin()).challenge, { method: "recovery", code: recoveryCodes[0] })).status).toBe(200);
    expect((await verifyWith((await passwordLogin()).challenge, { method: "recovery", code: recoveryCodes[0] })).status).toBe(401);
    expect(user().mfaRecovery).toHaveLength(9);
  });

  it("ends the challenge after five wrong codes", async () => {
    const { secret } = await enableTotp();
    const { challenge } = await passwordLogin();
    for (let i = 1; i <= 4; i++) {
      const res = await verifyWith(challenge, { method: "totp", code: "000000" });
      expect(await res.json()).toMatchObject({ attemptsLeft: 5 - i });
    }
    const last = await verifyWith(challenge, { method: "totp", code: "000000" });
    expect(await last.json()).toMatchObject({ restart: true });
    expect((await verifyWith(challenge, { method: "totp", code: nextCode(secret) })).status).toBe(401);
  });

  it("expires the challenge after five minutes", async () => {
    const { secret } = await enableTotp();
    const { challenge } = await passwordLogin();
    now += 5 * 60 * 1000 + 1;
    const res = await verifyWith(challenge, { method: "totp", code: totpForStep(secret, currentStep(now)) });
    expect(await res.json()).toMatchObject({ restart: true });
  });

  it("validates the request body", async () => {
    await enableTotp();
    const { challenge } = await passwordLogin();
    expect((await verifyWith(challenge, { method: "sms", code: "1" })).status).toBe(400);
    expect((await verifyWith(challenge, { method: "totp" })).status).toBe(400);
    expect((await verifyWith(challenge, { method: "webauthn", response: "x" })).status).toBe(400);
  });

  it("does not change sign-in for users without MFA", async () => {
    const { body, session, challenge } = await passwordLogin();
    expect(body.success).toBe(true);
    expect(session).toBeDefined();
    expect(challenge).toBeUndefined();
    expect((await readSession(session)).session.mfa).toBe(false);
  });
});

describe("passkeys", () => {
  const credential = { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] };

  async function registerPasskey() {
    await signIn();
    const options = await (await passkeys.POST(json({}))).json();
    expect(options.challenge).toBeDefined();
    expect(options.rp.id).toBe("localhost");
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: true, registrationInfo: { credential } });
    const res = await passkeys.POST(json({ response: { id: "cred-1" }, name: "Laptop" }));
    expect(res.status).toBe(200);
    return res.json();
  }

  it("registers with the server's own challenge, origin and RP ID", async () => {
    const body = await registerPasskey();
    expect(body.passkeys).toEqual([expect.objectContaining({ id: "cred-1", name: "Laptop" })]);
    expect(body.recoveryCodes).toHaveLength(10);
    const args = verifyRegistrationResponse.mock.calls[0][0];
    expect(args).toMatchObject({ expectedOrigin: "http://localhost:3000", expectedRPID: "localhost", requireUserVerification: true });
    expect(args.expectedChallenge).toEqual(expect.any(String));
  });

  it("needs re-auth to get registration options", async () => {
    await signIn({ stale: true });
    expect((await passkeys.POST(json({}))).status).toBe(401);
  });

  it("can't finish registration without fresh options, and options are single use", async () => {
    await signIn();
    verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo: { credential } });
    expect((await passkeys.POST(json({ response: { id: "x" } }))).status).toBe(400);
    await passkeys.POST(json({}));
    expect((await passkeys.POST(json({ response: { id: "x" } }))).status).toBe(200);
    expect((await passkeys.POST(json({ response: { id: "x" } }))).status).toBe(400);
  });

  it("rejects a response the library doesn't verify", async () => {
    await signIn();
    await passkeys.POST(json({}));
    verifyRegistrationResponse.mockRejectedValueOnce(new Error("bad attestation"));
    expect((await passkeys.POST(json({ response: { id: "x" } }))).status).toBe(400);
    expect(user().webauthnCredentials).toBeUndefined();
  });

  it("signs in with a passkey and updates its counter", async () => {
    await registerPasskey();
    const { challenge, body } = await passwordLogin();
    expect(body.methods).toEqual(["webauthn", "recovery"]);
    const options = await (await passkeyOptions.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { cookie: `mfa_challenge=${challenge}`, host: "localhost:3000" } }))).json();
    expect(options.allowCredentials).toEqual([expect.objectContaining({ id: "cred-1" })]);

    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 5 } });
    const res = await verifyWith(challenge, { method: "webauthn", response: { id: "cred-1" } });
    expect(res.status).toBe(200);
    expect(verifyAuthenticationResponse.mock.calls[0][0].expectedChallenge).toBe(options.challenge);
    expect(user().webauthnCredentials[0].counter).toBe(5);
  });

  it("refuses an assertion for a credential the user doesn't own", async () => {
    await registerPasskey();
    const { challenge } = await passwordLogin();
    await passkeyOptions.POST(new Request("http://localhost:3000/x", { method: "POST", headers: { cookie: `mfa_challenge=${challenge}`, host: "localhost:3000" } }));
    verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    expect((await verifyWith(challenge, { method: "webauthn", response: { id: "someone-elses" } })).status).toBe(401);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("removing a passkey needs re-auth; removing the last factor clears recovery codes", async () => {
    await registerPasskey();
    now += 11 * 60 * 1000;
    expect((await passkeyOne.DELETE(new Request("http://x"), { params: Promise.resolve({ credentialId: "cred-1" }) })).status).toBe(401);
    await signIn();
    const body = await (await passkeyOne.DELETE(new Request("http://x"), { params: Promise.resolve({ credentialId: "cred-1" }) })).json();
    expect(body).toMatchObject({ enabled: false, passkeys: [], recoveryCodesRemaining: 0 });
    expect((await passkeyOne.DELETE(new Request("http://x"), { params: Promise.resolve({ credentialId: "cred-1" }) })).status).toBe(404);
  });
});

describe("recovery code regeneration", () => {
  it("needs re-auth and MFA, and invalidates the old codes", async () => {
    const { recoveryCodes } = await enableTotp();
    now += 11 * 60 * 1000;
    expect((await recovery.POST()).status).toBe(401);
    await signIn();
    const body = await (await recovery.POST()).json();
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.recoveryCodes).not.toContain(recoveryCodes[0]);
    expect((await verifyWith((await passwordLogin()).challenge, { method: "recovery", code: recoveryCodes[0] })).status).toBe(401);
  });

  it("refuses when MFA is off", async () => {
    await signIn();
    expect((await recovery.POST()).status).toBe(409);
  });
});

describe("step-up for MFA users", () => {
  it("needs the password and a second factor", async () => {
    const { secret } = await enableTotp();
    const { sid } = await signIn({ stale: true });
    expect((await reauth.POST(json({ password: PASSWORD }))).status).toBe(400);
    expect((await reauth.POST(json({ password: PASSWORD, method: "totp", code: "000000" }))).status).toBe(401);
    expect((await reauth.POST(json({ password: "wrong", method: "totp", code: nextCode(secret) }))).status).toBe(401);
    const res = await reauth.POST(json({ password: PASSWORD, method: "totp", code: nextCode(secret) }));
    expect(res.status).toBe(200);
    expect(docClient.get(USERS_TABLE, `SESSION#${sid}`).authAt).toBe(now);
  });

  it("doesn't use up a code when the password is wrong", async () => {
    const { recoveryCodes } = await enableTotp();
    await signIn({ stale: true });
    await reauth.POST(json({ password: "wrong", method: "recovery", code: recoveryCodes[0] }));
    expect(user().mfaRecovery).toHaveLength(10);
  });
});
