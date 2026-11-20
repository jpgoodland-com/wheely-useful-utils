/**
 * Content Security Policy regressions (security plan finding M1).
 */
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 9, resetMs: Date.now() + 1000 })) }));

const fs = require("fs");
const path = require("path");
const { NextRequest } = require("next/server");
const { proxy } = require("@/proxy");
const nextConfig = require("@/next.config.mjs").default;

const get = (url) => new NextRequest(`http://localhost:3000${url}`, { headers: { host: "localhost:3000" } });
const nonceOf = (csp) => /'nonce-([^']+)'/.exec(csp)?.[1];

it("gives every page a fresh nonce, in the response and the request Next.js renders", () => {
  const a = proxy(get("/dashboard"));
  const b = proxy(get("/dashboard"));
  const cspA = a.headers.get("content-security-policy");
  expect(nonceOf(cspA)).toBeTruthy();
  expect(nonceOf(cspA)).not.toBe(nonceOf(b.headers.get("content-security-policy")));
  // NextResponse.next({ request }) forwards overridden request headers this way.
  expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(cspA);
});

it("allows no inline or eval'd script in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const csp = proxy(get("/login")).headers.get("content-security-policy");
    const script = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(script).toContain("'strict-dynamic'");
  } finally {
    process.env.NODE_ENV = original;
  }
});

it("gives API responses a deny-all policy", () => {
  expect(proxy(get("/api/auth/me")).headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
});

it("keeps the static headers in next.config and no competing CSP there", async () => {
  const [rule] = await nextConfig.headers();
  const keys = rule.headers.map((h) => h.key.toLowerCase());
  expect(keys).toEqual(expect.arrayContaining(["x-frame-options", "x-content-type-options", "referrer-policy"]));
  expect(keys).not.toContain("content-security-policy");
});

it("renders pages per request so the nonce reaches them", () => {
  const layout = fs.readFileSync(path.join(__dirname, "../../app/layout.js"), "utf8");
  expect(layout).toMatch(/await connection\(\)/);
});
