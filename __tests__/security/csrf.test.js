/**
 * CSRF regressions (security plan finding M2).
 *
 * Every API route that exports a state-changing handler is found on disk,
 * and the proxy must refuse each one when the request comes from another
 * site, while still letting the app's own pages and non-browser clients
 * through.
 */
jest.mock("@/lib/rateLimit", () => ({ checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 9, resetMs: Date.now() + 1000 })) }));
jest.mock("@/lib/securityLog", () => ({ logSecurityEvent: jest.fn() }));

const fs = require("fs");
const path = require("path");
const { NextRequest } = require("next/server");
const { proxy } = require("@/proxy");
const { logSecurityEvent } = require("@/lib/securityLog");

const APP = path.join(__dirname, "../../app/api");
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name === "route.js" ? [full] : [];
  });
}

// "/api/wheels/[id]/spin" -> "/api/wheels/x/spin"
const urlFor = (file) => "/api/" + path.relative(APP, path.dirname(file)).split(path.sep).map((s) => (s.startsWith("[") ? "x" : s)).join("/");

const endpoints = routeFiles(APP).flatMap((file) => {
  const src = fs.readFileSync(file, "utf8");
  return MUTATING.filter((m) => new RegExp(`export async function ${m}\\b`).test(src)).map((m) => [m, urlFor(file)]);
});

const request = (method, url, headers) => new NextRequest(`http://localhost:3000${url}`, { method, headers: { host: "localhost:3000", ...headers } });

beforeEach(() => jest.clearAllMocks());

it("finds the app's state-changing endpoints", () => {
  expect(endpoints.length).toBeGreaterThan(30);
  expect(endpoints).toEqual(expect.arrayContaining([["POST", "/api/auth/login"], ["DELETE", "/api/auth/delete-account"], ["PUT", "/api/auth/mfa/totp"]]));
});

describe.each(endpoints)("%s %s", (method, url) => {
  it("is refused from another origin", () => {
    const res = proxy(request(method, url, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(logSecurityEvent).toHaveBeenCalledWith("csrf_blocked", expect.objectContaining({ reason: "origin" }));
  });

  it("is refused when only Sec-Fetch-Site shows another site", () => {
    expect(proxy(request(method, url, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("is allowed from the app's own origin", () => {
    expect(proxy(request(method, url, { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).not.toBe(403);
  });
});

it("never blocks a cross-site GET (links and top-level navigation)", () => {
  expect(proxy(request("GET", "/api/auth/oauth/google", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).not.toBe(403);
});

it("lets non-browser clients without Origin or Sec-Fetch-Site through", () => {
  expect(proxy(request("POST", "/api/auth/logout", {})).status).not.toBe(403);
});

it("trusts APP_DOMAIN, not the Host header, when it's set", () => {
  process.env.APP_DOMAIN = "wheel.example.com";
  process.env.FORCE_HTTPS = "false";
  try {
    const spoofed = request("POST", "/api/auth/logout", { host: "evil.example", origin: "http://evil.example" });
    expect(proxy(spoofed).status).toBe(403);
  } finally {
    delete process.env.APP_DOMAIN;
    delete process.env.FORCE_HTTPS;
  }
});
