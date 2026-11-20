// Security plan H1: two-step verification with an authenticator app,
// recovery codes and passkeys.
const { test, expect, signIn, startMfaSignIn, totpCode } = require("./fixtures");

async function enableTotp(page) {
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent()).trim();
  await page.getByLabel("Enter the 6-digit code it shows").fill(totpCode(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  const region = page.getByRole("region", { name: "Your recovery codes" });
  await expect(region).toBeVisible();
  // One at a time: locator.allTextContents() crashes Firefox's page here
  // (Playwright's Firefox 159 driver); reading each item works.
  const items = region.locator("li");
  const codes = [];
  for (let i = 0; i < (await items.count()); i++) codes.push((await items.nth(i).textContent()).trim());
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: "I've saved them" }).click();
  return { secret, codes };
}

async function signOut(page) {
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();
}

test.describe("two-step verification", () => {
  test("authenticator app: set up, then sign-in asks for a code", async ({ page, user, clientHeaders }) => {
    const { secret } = await enableTotp(page);
    await expect(page.getByText("On: signing in asks for a second step")).toBeVisible();

    await signOut(page);
    await startMfaSignIn(page, user.email, clientHeaders);
    // Not signed in yet: protected API calls still fail.
    expect((await (await page.request.get("/api/auth/me")).json()).user).toBeNull();

    await page.goto("/login/mfa");
    await page.getByLabel("Code from your authenticator app").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();

    // The code used during setup is spent; the next step's code works.
    await page.getByLabel("Code from your authenticator app").fill(totpCode(secret, 1));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await (await page.request.get("/api/auth/me")).json()).user.mfa).toBe(true);
  });

  test("a recovery code works once", async ({ page, user, clientHeaders }) => {
    const { codes } = await enableTotp(page);
    for (const expectSuccess of [true, false]) {
      await signOut(page);
      await startMfaSignIn(page, user.email, clientHeaders);
      await page.goto("/login/mfa");
      await page.getByRole("button", { name: "Use a recovery code" }).click();
      await page.getByLabel("Recovery code").fill(codes[0]);
      await page.getByRole("button", { name: "Verify" }).click();
      if (expectSuccess) await expect(page).toHaveURL(/\/dashboard$/);
      else await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();
    }
  });

  test("without the second step the challenge alone opens nothing", async ({ page, user, clientHeaders }) => {
    await enableTotp(page);
    await signOut(page);
    await startMfaSignIn(page, user.email, clientHeaders);
    for (const path of ["/api/auth/sessions", "/api/wheels", "/api/auth/mfa"]) {
      expect((await page.request.get(path)).status(), path).toBe(401);
    }
    await page.goto("/dashboard", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
});

test.describe("passkeys", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "virtual authenticators need Chromium's DevTools protocol");

  test("add a passkey, then sign in with it", async ({ page, user, clientHeaders }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });

    await page.goto("/settings/security");
    await page.getByLabel("Passkey name").fill("Test key");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByRole("button", { name: "Remove passkey Test key" })).toBeVisible();
    await page.getByRole("button", { name: "I've saved them" }).click();

    await signOut(page);
    await startMfaSignIn(page, user.email, clientHeaders);
    await page.goto("/login/mfa");
    await page.getByRole("button", { name: "Use a passkey" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await (await page.request.get("/api/auth/me")).json()).user.mfa).toBe(true);
  });
});

test.describe("admin rights", () => {
  test("an admin without two-step verification gets no admin access", async ({ page, clientHeaders }) => {
    await signIn(page, "e2e-admin@example.com", clientHeaders);
    expect((await page.request.get("/api/admin/users")).status()).toBe(403);
    await page.goto("/settings");
    // Wait for the cards: the Administration link is also absent while the
    // page is still loading the user, which made this check meaningless and
    // let the next navigation abort that request (a WebKit race in CI).
    await expect(page.getByRole("link", { name: /Security/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Administration/ })).toHaveCount(0);
    await page.goto("/settings/security");
    await expect(page.getByRole("alert").filter({ hasText: "administrator rights" })).toBeVisible();
  });
});
