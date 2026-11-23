/**
 * Auth and security stores against real DynamoDB Local, so the update and
 * key expressions are checked by DynamoDB itself rather than fakeDynamo.
 *
 *   docker compose up -d dynamodb-local && node scripts/init-db.mjs
 *   DYNAMODB_INTEGRATION=1 npx jest __tests__/integration
 *
 * Only touches items it creates (random ids).
 */
const enabled = process.env.DYNAMODB_INTEGRATION === "1";
const run = enabled ? describe : describe.skip;

if (enabled) {
  process.env.DYNAMODB_ENDPOINT ||= "http://localhost:8000";
  process.env.AWS_ACCESS_KEY_ID ||= "fakeMyKeyId";
  process.env.AWS_SECRET_ACCESS_KEY ||= "fakeSecretAccessKey";
  process.env.AWS_REGION ||= "us-west-2";
}

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");

run("auth stores on DynamoDB Local", () => {
  let docClient, TableNames, PutCommand, GetCommand, DeleteCommand;
  let sessions, rate, audit, mfa, tokens;
  const created = [];
  const userId = `it-${crypto.randomBytes(6).toString("hex")}`;

  beforeAll(async () => {
    ({ docClient, TableNames } = require("@/lib/dynamodb"));
    ({ PutCommand, GetCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb"));
    sessions = require("@/lib/sessions/store");
    rate = require("@/lib/sharedRateLimit");
    audit = require("@/lib/audit");
    mfa = require("@/lib/mfa/store");
    tokens = require("@/lib/tokens");
    const user = { PK: `USER#${userId}`, userId, email: `${userId}@example.com`, EmailOrUsername: `${userId}@example.com`, username: userId, isVerified: true };
    await docClient.send(new PutCommand({ TableName: TableNames.Users, Item: user }));
    created.push(user.PK);
  });

  afterAll(async () => {
    for (const PK of created) await docClient.send(new DeleteCommand({ TableName: TableNames.Users, Key: { PK } }));
  });

  it("creates, reads, slides, lists and revokes sessions", async () => {
    const a = await sessions.createSession({ userId }, { amr: "pwd" });
    const b = await sessions.createSession({ userId }, { amr: "pwd", mfa: true });
    created.push(`SESSION#${a.sid}`, `SESSION#${b.sid}`);

    expect((await sessions.readSession(a.token)).user.userId).toBe(userId);
    const listed = await sessions.listSessions(userId);
    expect(listed.map((s) => s.sid).sort()).toEqual([a.sid, b.sid].sort());

    await sessions.markReauthenticated(a.sid);
    await sessions.markSessionMfa(a.sid);
    expect((await sessions.readSession(a.token)).session.mfa).toBe(true);

    expect(await sessions.revokeAllSessions(userId, { exceptSid: b.sid })).toBe(1);
    expect(await sessions.readSession(a.token)).toBeNull();
    expect(await sessions.readSession(b.token)).not.toBeNull();
    await sessions.revokeAllSessions(userId);
    expect(await sessions.listSessions(userId)).toEqual([]);
  });

  it("counts shared rate-limit hits atomically", async () => {
    const key = `it:${userId}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => rate.consumeSharedLimit(key, 3, 60_000)));
    expect(results.map((r) => r.hits).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
    created.push(`RATE#${tokens.hashToken(key)}#${windowStart}`);
  });

  it("guards TOTP replay and recovery codes with real condition expressions", async () => {
    const user = await mfa.getPrimaryUser(userId);
    const { secret } = await mfa.startTotpSetup(user);
    const { currentStep, totpForStep } = require("@/lib/mfa/totp");
    const { recoveryCodes } = await mfa.confirmTotpSetup(await mfa.getPrimaryUser(userId), totpForStep(secret, currentStep()));
    const fresh = await mfa.getPrimaryUser(userId);
    expect(await mfa.verifyCode(fresh, { method: "totp", code: totpForStep(secret, currentStep() + 1) })).toBe(true);
    expect(await mfa.verifyCode(fresh, { method: "totp", code: totpForStep(secret, currentStep() + 1) })).toBe(false);
    expect(await mfa.verifyCode(await mfa.getPrimaryUser(userId), { method: "recovery", code: recoveryCodes[0] })).toBe(true);
    expect(await mfa.verifyCode(await mfa.getPrimaryUser(userId), { method: "recovery", code: recoveryCodes[0] })).toBe(false);
  });

  it("writes audit records and lists them newest first through ScopeIndex", async () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => {});
    const scope = `user#${userId}`;
    for (const action of ["auth.session_started", "mfa.totp_enabled", "auth.logout"]) {
      await audit.recordAudit(null, { action, actorUserId: userId });
    }
    spy.mockRestore();
    const { records } = await audit.listAudit(scope, { limit: 10 });
    expect(records.map((r) => r.action)).toEqual(["auth.logout", "mfa.totp_enabled", "auth.session_started"]);
    // Audit records are append-only; they expire by TTL, so nothing to clean up.
  });

  it("renames usernames that break the rule with scripts/migrate-usernames.mjs", async () => {
    const bad = `${userId}@corp.com`;
    const pointer = { PK: `USER#USERNAME#${bad}`, userId, username: bad, EmailOrUsername: bad };
    await docClient.send(new PutCommand({ TableName: TableNames.Users, Item: pointer }));
    const script = path.join(__dirname, "../../scripts/migrate-usernames.mjs");
    const env = { ...process.env };

    const dry = JSON.parse(execFileSync("node", [script], { env }).toString());
    const mine = dry.users.find((u) => u.userId === userId);
    expect(mine).toMatchObject({ from: bad, to: userId });
    expect((await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: { PK: pointer.PK } }))).Item).toBeDefined();

    // Another test run may have left the target name taken; the script picks a free one.
    const applied = JSON.parse(execFileSync("node", [script, "--apply"], { env }).toString()).users.find((u) => u.userId === userId);
    created.push(`USER#USERNAME#${applied.to}`);
    expect((await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: { PK: pointer.PK } }))).Item).toBeUndefined();
    expect((await docClient.send(new GetCommand({ TableName: TableNames.Users, Key: { PK: `USER#${userId}` } }))).Item.username).toBe(applied.to);
  });
});
