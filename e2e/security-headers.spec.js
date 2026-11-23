// Security plan M1/M2: per-request CSP nonce and cross-site request refusal,
// checked in real browsers.
const { test, expect } = require("./fixtures");

test.describe("security headers", () => {
  test("pages get a nonce CSP and still hydrate", async ({ page }) => {
    const violations = [];
    page.on("console", (msg) => {
      if (/Content Security Policy|Refused to (execute|load)/i.test(msg.text())) violations.push(msg.text());
    });
    const first = await page.goto("/login");
    const csp = first.headers()["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);

    const second = await page.goto("/login");
    expect(second.headers()["content-security-policy"]).not.toBe(csp);

    // Hydrated: client-side validation runs without a server round trip.
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(violations).toEqual([]);
  });

  test("API responses carry a deny-all CSP and the static headers", async ({ request }) => {
    const res = await request.get("/api/auth/me");
    expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("a signed-in user's browser refuses a forged cross-site request", async ({ page, user }) => {
    expect(user.email).toBeTruthy();
    // The attacker's page can't read the reply, but the server must not act
    // on it either. Origin is forged here to model a cross-site form post.
    const res = await page.request.post("/api/auth/sessions", {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status()).toBe(403);
    const forged = await page.request.delete("/api/auth/sessions", { headers: { origin: "https://evil.example" } });
    expect(forged.status()).toBe(403);
    // Still signed in, and a same-origin request works.
    const me = await (await page.request.get("/api/auth/me")).json();
    expect(me.user).not.toBeNull();
  });

  test("the app's own pages can still make changes", async ({ page, user }) => {
    expect(user.email).toBeTruthy();
    await page.goto("/settings/security");
    const status = await page.evaluate(async () => (await fetch("/api/auth/sessions", { method: "DELETE" })).status);
    expect(status).toBe(200);
  });
});
