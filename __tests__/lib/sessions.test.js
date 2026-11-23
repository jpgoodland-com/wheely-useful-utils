jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});

import { docClient } from "@/lib/dynamodb";
import { hashToken } from "@/lib/tokens";
import {
  absoluteTimeoutMs,
  createSession,
  hasRecentAuth,
  idleTimeoutMs,
  listSessions,
  markReauthenticated,
  readSession,
  revokeAllSessions,
  sessionCookieName,
  sessionTokenFrom,
  setSessionCookie,
  startSession,
} from "@/lib/sessions/store";
import { seedUser, USERS_TABLE } from "@/__tests__/helpers/users";

const MIN = 60 * 1000;
const req = (headers = {}) => new Request("http://localhost/x", { headers });

let now;
beforeEach(() => {
  docClient.reset();
  now = Date.parse("2026-11-17T10:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => now);
  delete process.env.SESSION_IDLE_MINUTES;
  delete process.env.SESSION_MAX_HOURS;
  seedUser(docClient, { userId: "u1", username: "alice" });
});
afterEach(() => jest.restoreAllMocks());

describe("createSession / readSession", () => {
  it("stores only the hash of a 256-bit token", async () => {
    const { token, sid } = await createSession({ userId: "u1" }, { amr: "pwd", req: req({ "x-forwarded-for": "1.1.1.1, 203.0.113.4", "user-agent": "UA" }) });
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(sid).toBe(hashToken(token));
    const item = docClient.get(USERS_TABLE, `SESSION#${sid}`);
    expect(JSON.stringify(item)).not.toContain(token);
    expect(item).toMatchObject({ userId: "u1", amr: "pwd", ip: "203.0.113.4", ua: "UA", EmailOrUsername: "session#u1" });
    expect(item.expiresAt).toBe(Math.ceil((now + absoluteTimeoutMs()) / 1000));
  });

  it("returns the session and live user for a valid token", async () => {
    const { token } = await createSession({ userId: "u1" });
    const found = await readSession(token);
    expect(found.user.userId).toBe("u1");
    expect(found.session.userId).toBe("u1");
  });

  it.each([undefined, "", "short", "x".repeat(200), 42])("rejects malformed token %p without reading", async (t) => {
    docClient.calls = [];
    expect(await readSession(t)).toBeNull();
    expect(docClient.calls).toHaveLength(0);
  });

  it("rejects an unknown token", async () => {
    expect(await readSession("a".repeat(43))).toBeNull();
  });

  it("expires after the idle timeout and deletes the session", async () => {
    const { token, sid } = await createSession({ userId: "u1" });
    now += idleTimeoutMs();
    expect(await readSession(token)).toBeNull();
    expect(docClient.get(USERS_TABLE, `SESSION#${sid}`)).toBeUndefined();
  });

  it("slides the idle timeout with activity, at most once a minute", async () => {
    const { token, sid } = await createSession({ userId: "u1" });
    now += 20 * MIN;
    await readSession(token);
    now += 20 * MIN; // 40 minutes in, but only 20 since last seen
    expect(await readSession(token)).not.toBeNull();

    docClient.calls = [];
    now += 30 * 1000;
    await readSession(token);
    expect(docClient.calls.filter((c) => c.name === "UpdateCommand")).toHaveLength(0);
    expect(docClient.get(USERS_TABLE, `SESSION#${sid}`).lastSeenAt).toBe(now - 30 * 1000);
  });

  it("never slides past the absolute timeout", async () => {
    const { token } = await createSession({ userId: "u1" });
    const end = now + absoluteTimeoutMs();
    while (now + 20 * MIN < end) {
      now += 20 * MIN;
      expect(await readSession(token)).not.toBeNull();
    }
    now = end;
    expect(await readSession(token)).toBeNull();
  });

  it("honours SESSION_IDLE_MINUTES and SESSION_MAX_HOURS", () => {
    process.env.SESSION_IDLE_MINUTES = "5";
    process.env.SESSION_MAX_HOURS = "1";
    expect(idleTimeoutMs()).toBe(5 * MIN);
    expect(absoluteTimeoutMs()).toBe(60 * MIN);
    process.env.SESSION_IDLE_MINUTES = "nonsense";
    expect(idleTimeoutMs()).toBe(30 * MIN);
  });

  it("rejects sessions of deleted or disabled users", async () => {
    const { token } = await createSession({ userId: "u1" });
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "USER#u1"), disabled: true });
    expect(await readSession(token)).toBeNull();

    seedUser(docClient, { userId: "u2", username: "bob" });
    const second = await createSession({ userId: "u2" });
    const { DeleteCommand } = require("@aws-sdk/lib-dynamodb");
    await docClient.send(new DeleteCommand({ TableName: USERS_TABLE, Key: { PK: "USER#u2" } }));
    expect(await readSession(second.token)).toBeNull();
  });

  it("rejects sessions created before the last password change", async () => {
    const { token } = await createSession({ userId: "u1" });
    now += MIN;
    docClient.put(USERS_TABLE, { ...docClient.get(USERS_TABLE, "USER#u1"), passwordChangedAt: new Date(now).toISOString() });
    expect(await readSession(token)).toBeNull();
    const fresh = await createSession({ userId: "u1" });
    now += 1;
    expect(await readSession(fresh.token)).not.toBeNull();
  });
});

describe("listing and revoking", () => {
  it("lists only the user's live sessions, newest first", async () => {
    const a = await createSession({ userId: "u1" });
    now += 2 * MIN;
    const b = await createSession({ userId: "u1" });
    seedUser(docClient, { userId: "u2", username: "bob" });
    await createSession({ userId: "u2" });
    expect((await listSessions("u1")).map((s) => s.sid)).toEqual([b.sid, a.sid]);
  });

  it("revokes all sessions, optionally keeping one", async () => {
    const a = await createSession({ userId: "u1" });
    const b = await createSession({ userId: "u1" });
    expect(await revokeAllSessions("u1", { exceptSid: a.sid })).toBe(1);
    expect(await readSession(b.token)).toBeNull();
    expect(await readSession(a.token)).not.toBeNull();
    await revokeAllSessions("u1");
    expect(await readSession(a.token)).toBeNull();
  });

  it("startSession revokes the browser's previous session (no fixation)", async () => {
    const planted = await createSession({ userId: "u1" });
    const response = { cookies: { set: jest.fn() } };
    await startSession(response, { userId: "u1" }, { req: req({ cookie: `other=1; ${sessionCookieName()}=${planted.token}` }) });
    expect(await readSession(planted.token)).toBeNull();
    expect(response.cookies.set).toHaveBeenCalledWith(expect.objectContaining({ name: "session", httpOnly: true, path: "/", sameSite: "lax" }));
  });
});

describe("re-authentication", () => {
  it("is recent only inside the window", async () => {
    const { token, sid } = await createSession({ userId: "u1" });
    let { session } = await readSession(token);
    expect(hasRecentAuth(session)).toBe(true);
    now += 11 * MIN;
    ({ session } = await readSession(token));
    expect(hasRecentAuth(session)).toBe(false);
    await markReauthenticated(sid);
    ({ session } = await readSession(token));
    expect(hasRecentAuth(session)).toBe(true);
    expect(hasRecentAuth(undefined)).toBe(false);
  });
});

describe("cookies", () => {
  it("uses a __Host- prefixed, Secure cookie in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const response = { cookies: { set: jest.fn() } };
    setSessionCookie(response, "tok");
    expect(response.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: "__Host-session", secure: true, httpOnly: true, path: "/", maxAge: absoluteTimeoutMs() / 1000,
    }));
    process.env.NODE_ENV = original;
  });

  it("reads the token from the Cookie header", () => {
    expect(sessionTokenFrom(req({ cookie: "a=1; session=abc%3D; b=2" }))).toBe("abc=");
    expect(sessionTokenFrom(req({ cookie: "xsession=nope" }))).toBeNull();
    expect(sessionTokenFrom(req())).toBeNull();
  });
});
