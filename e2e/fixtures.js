// Shared Playwright fixtures for the e2e suite.
const { test: base, expect } = require("@playwright/test");
const crypto = require("node:crypto");

/** A fresh, unique mock-OAuth email, so every test gets its own account and data. */
function uniqueEmail(prefix = "e2e") {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}@example.com`;
}

/**
 * Signs in through the mock OAuth flow without rendering the sandbox page:
 * start the flow (sets the oauth_state cookie), then call the callback with the
 * code the sandbox would have produced. The sandbox UI itself is covered in
 * auth.spec.js. `page.request` shares the page's cookies, so the page is signed in.
 */
async function signIn(page, email, headers = {}) {
  const start = await page.request.get("/api/auth/oauth/google", { maxRedirects: 0, headers });
  expect(start.status(), "OAuth start should redirect to the mock sandbox").toBe(307);
  const sandbox = new URL(start.headers()["location"]);
  expect(sandbox.pathname).toBe("/auth/mock");

  const callback = new URL(sandbox.searchParams.get("redirect_uri"));
  callback.searchParams.set("code", `mock-code-google-${Buffer.from(email).toString("base64")}`);
  callback.searchParams.set("state", sandbox.searchParams.get("state"));
  const done = await page.request.get(callback.toString(), { maxRedirects: 0, headers });
  expect(new URL(done.headers()["location"]).pathname, "callback should land on the dashboard").toBe("/dashboard");
}

/**
 * Waits until React has attached its handlers to a server-rendered element.
 * Before hydration, clicks and typing on SSR'd pages (sign in, sandbox) are
 * silently lost, which is slow enough under next dev to fail tests.
 */
async function waitForHydration(locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), {
      message: "waiting for React to hydrate",
    })
    .toBe(true);
}

/** The nav links sit behind the hamburger button on narrow screens. */
async function openNav(page) {
  const toggle = page.getByRole("button", { name: "Toggle menu" });
  if (await toggle.isVisible()) await toggle.click();
}

const test = base.extend({
  // The proxy rate-limits per client IP and treats every local request as the
  // same client, so a parallel run would trip the limits. Each test gets its
  // own X-Forwarded-For so tests stay independent of each other.
  clientHeaders: async ({}, use) => {
    await use({ "x-forwarded-for": `10.${Array.from(crypto.randomBytes(3)).join(".")}` });
  },

  // Routing every app request would disable the HTTP cache and slow next dev
  // down, so the header goes on every request and is stripped again from the
  // few third-party ones (Google Fonts), where it would fail the CORS preflight.
  context: async ({ context, baseURL, clientHeaders }, use) => {
    const origin = new URL(baseURL).origin;
    await context.setExtraHTTPHeaders(clientHeaders);
    await context.route(
      (url) => url.origin !== origin,
      (route) => {
        const headers = { ...route.request().headers() };
        for (const name of Object.keys(clientHeaders)) delete headers[name];
        return route.continue({ headers });
      }
    );
    await use(context);
  },

  // A signed-in user with a brand-new account.
  user: async ({ page, clientHeaders }, use) => {
    const email = uniqueEmail();
    await signIn(page, email, clientHeaders);
    await use({ email, name: email.split("@")[0] });
  },
});

module.exports = { test, expect, signIn, openNav, uniqueEmail, waitForHydration };
