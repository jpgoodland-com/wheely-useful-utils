jest.mock("@/lib/dynamodb", () => {
  const { createFakeDynamo } = require("@/__tests__/helpers/fakeDynamo");
  return { docClient: createFakeDynamo(), TableNames: { Users: "WheelApp_Users" } };
});

import crypto from "crypto";
import { docClient } from "@/lib/dynamodb";
import { csrfViolation } from "@/lib/csrf";
import { API_CSP, newNonce, pageCsp } from "@/lib/csp";
import { consumeSharedLimit } from "@/lib/sharedRateLimit";
import { BREACHED_MESSAGE, isBreachedPassword } from "@/lib/users/breachedPassword";

const ORIGIN = "https://wheel.example.com";
const req = (method, headers = {}) => ({ method, headers: new Headers(headers) });

describe("csrfViolation", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("ignores safe method %s even cross-site", (m) => {
    expect(csrfViolation(req(m, { origin: "https://evil.example" }), ORIGIN)).toBeNull();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses %s from another origin", (m) => {
    expect(csrfViolation(req(m, { origin: "https://evil.example" }), ORIGIN)).toBe("origin");
  });

  it.each([
    ["a look-alike host", "https://wheel.example.com.evil.example"],
    ["a different scheme", "http://wheel.example.com"],
    ["a different port", "https://wheel.example.com:8443"],
    ["a sibling subdomain", "https://evil.wheel.example.com"],
    ["an opaque origin", "null"],
  ])("refuses %s", (_label, origin) => {
    expect(csrfViolation(req("POST", { origin }), ORIGIN)).toBe("origin");
  });

  it("allows the app's own origin", () => {
    expect(csrfViolation(req("POST", { origin: ORIGIN, "sec-fetch-site": "same-origin" }), ORIGIN)).toBeNull();
  });

  it("uses Sec-Fetch-Site when Origin is missing", () => {
    expect(csrfViolation(req("POST", { "sec-fetch-site": "cross-site" }), ORIGIN)).toBe("fetch-site");
    expect(csrfViolation(req("POST", { "sec-fetch-site": "same-site" }), ORIGIN)).toBe("fetch-site");
    expect(csrfViolation(req("POST", { "sec-fetch-site": "same-origin" }), ORIGIN)).toBeNull();
    expect(csrfViolation(req("POST", { "sec-fetch-site": "none" }), ORIGIN)).toBeNull();
  });

  it("allows non-browser clients that send neither header", () => {
    expect(csrfViolation(req("POST"), ORIGIN)).toBeNull();
  });
});

describe("CSP", () => {
  const directive = (csp, name) => csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("only lets scripts with this request's nonce run, with no unsafe-inline or eval in production", () => {
    const csp = pageCsp("abc123", { https: true });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds unsafe-eval only in development", () => {
    expect(directive(pageCsp("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(pageCsp("n")).not.toContain("upgrade-insecure-requests");
  });

  it("gives API responses a deny-all policy", () => {
    expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("makes a fresh, unguessable nonce each time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    expect(Buffer.from([...nonces][0], "base64").length).toBeGreaterThanOrEqual(16);
  });
});

describe("consumeSharedLimit", () => {
  let now;
  beforeEach(() => {
    docClient.reset();
    now = Date.parse("2026-11-17T10:00:00Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it("counts hits in a fixed window and resets in the next one", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeSharedLimit("login-id:alice", 3, 60_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].remaining).toBe(0);
    now += 60_000;
    expect((await consumeSharedLimit("login-id:alice", 3, 60_000)).allowed).toBe(true);
  });

  it("keeps separate keys apart and never stores the key itself", async () => {
    await consumeSharedLimit("forgot:alice@example.com", 1, 60_000);
    expect((await consumeSharedLimit("forgot:bob@example.com", 1, 60_000)).allowed).toBe(true);
    const dump = JSON.stringify(docClient.items("WheelApp_Users"));
    expect(dump).not.toContain("alice@example.com");
    expect(docClient.items("WheelApp_Users").every((i) => /^RATE#[0-9a-f]{64}#\d+$/.test(i.PK) && i.expiresAt > now / 1000)).toBe(true);
  });

  it("fails open when DynamoDB is unavailable", async () => {
    docClient.beforeSend = () => { throw new Error("down"); };
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect((await consumeSharedLimit("k", 1, 60_000)).allowed).toBe(true);
  });
});

describe("isBreachedPassword", () => {
  const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").toUpperCase();
  beforeEach(() => {
    process.env.BREACHED_PASSWORD_CHECK = "on";
    global.fetch = jest.fn();
  });
  afterEach(() => {
    process.env.BREACHED_PASSWORD_CHECK = "off";
  });

  it("sends only the 5-character hash prefix, with padding", async () => {
    global.fetch.mockResolvedValueOnce(new Response("0000000000000000000000000000000000A:0\n"));
    await isBreachedPassword("Correct-horse-9!");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1("Correct-horse-9!").slice(0, 5)}`);
    expect(url).not.toContain(sha1("Correct-horse-9!").slice(5));
    expect(opts.headers["Add-Padding"]).toBe("true");
    expect(opts.redirect).toBe("error");
  });

  it("matches the suffix locally, ignoring padding entries with count 0", async () => {
    const suffix = sha1("P@ssw0rd123456").slice(5);
    global.fetch.mockResolvedValueOnce(new Response(`AAAA:3\r\n${suffix}:52\r\n`));
    expect(await isBreachedPassword("P@ssw0rd123456")).toBe(true);
    global.fetch.mockResolvedValueOnce(new Response(`${suffix}:0\r\n`));
    expect(await isBreachedPassword("P@ssw0rd123456")).toBe(false);
  });

  it("fails open on errors, timeouts and non-200 replies", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await isBreachedPassword("x")).toBe(false);
    global.fetch.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await isBreachedPassword("x")).toBe(false);
  });

  it("can be switched off", async () => {
    process.env.BREACHED_PASSWORD_CHECK = "off";
    expect(await isBreachedPassword("x")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("has a user-facing message", () => {
    expect(BREACHED_MESSAGE).toMatch(/data breach/);
  });
});
