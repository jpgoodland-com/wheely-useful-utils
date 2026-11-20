const { test, expect, openNav, uniqueEmail, waitForHydration } = require("./fixtures");

test.describe("signed out", () => {
  test("home page offers login and sign up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Wheely Useful Utils!" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  });

  for (const path of ["/dashboard", "/features/coin-flip", "/features/wheel", "/features/capacity-planner", "/settings"]) {
    test(`${path} redirects to login`, async ({ page }) => {
      // The page redirects on the client, which can interrupt the load event.
      await page.goto(path, { waitUntil: "commit" });
      await expect(page).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("login form shows an error for unknown credentials", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page.getByRole("button", { name: "Login", exact: true }));
    // Unique per run: sign-in attempts are rate-limited per identifier.
    await page.getByLabel("Email or Username").fill(uniqueEmail("nobody"));
    await page.getByLabel("Password", { exact: true }).fill("not-the-password-123!");
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("sign up validates the form before submitting", async ({ page }) => {
    await page.goto("/signup");
    await waitForHydration(page.getByRole("button", { name: "Sign Up", exact: true }));
    await page.getByLabel("First Name").fill("Ada");
    await page.getByLabel("Last Name").fill("Lovelace");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Username").fill("ada");
    await page.getByLabel("Password", { exact: true }).fill("short");

    let posted = false;
    page.on("request", (req) => {
      if (req.url().endsWith("/api/auth/signup")) posted = true;
    });
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await expect(page.getByText(/At least 12 characters, .*uppercase/)).toBeVisible();
    expect(posted).toBe(false);
  });
});

test.describe("mock OAuth sign in", () => {
  test("signs in through the sandbox and out again", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/login");
    await page.getByRole("link", { name: /Google/ }).click();

    await waitForHydration(page.getByRole("button", { name: "Authorize & Continue" }));
    await page.getByText("Custom Email Profile").click();
    await page.getByPlaceholder("enter.any.email@domain.com").fill(email);
    await page.getByRole("button", { name: "Authorize & Continue" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    const name = email.split("@")[0];
    await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();

    // Logging out from a protected page sends you to the login page.
    await openNav(page);
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await openNav(page);
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();

    // The session cookie is gone, so protected pages bounce to login again.
    await page.goto("/dashboard", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
  });

  test("cancelling the sandbox explains why sign in failed", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /GitHub/ }).click();
    await waitForHydration(page.getByRole("button", { name: "Cancel" }));
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page).toHaveURL(/\/login\?error=access_denied/);
    await expect(page.getByText("Sign in was cancelled or access was denied by the provider.")).toBeVisible();
  });
});

// Security plan C1 / M3: account-identifier rules and no account enumeration.
test.describe("account security", () => {
  const strongPassword = "Str0ng!Passw0rd#e2e";

  async function submitSignup(page, { email, username }) {
    await page.goto("/signup");
    await waitForHydration(page.getByRole("button", { name: "Sign Up", exact: true }));
    await page.getByLabel("First Name").fill("Ada");
    await page.getByLabel("Last Name").fill("Lovelace");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(strongPassword);
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  }

  test("sign up rejects a username that is an email address", async ({ page }) => {
    await submitSignup(page, { email: uniqueEmail(), username: `ceo-${Date.now()}@corp.com` });
    await expect(page.getByText(/Username must be 3-32 characters/)).toBeVisible();
  });

  test("signing up twice with one email gives the same reply both times", async ({ page }) => {
    const email = uniqueEmail();
    const suffix = email.split("@")[0].slice(-12);
    await submitSignup(page, { email, username: `first-${suffix}` });
    const first = page.getByText(/check your email to verify your account/i);
    await expect(first).toBeVisible();

    await submitSignup(page, { email, username: `second-${suffix}` });
    await expect(page.getByText(/check your email to verify your account/i)).toBeVisible();
    await expect(page.getByText(/already (exists|registered|in use)|email is taken/i)).toHaveCount(0);
  });

  test("password login gives the same error for a social-only account and an unknown one", async ({ page, user }) => {
    await page.context().clearCookies();
    const attempt = async (identifier) => {
      await page.goto("/login");
      await waitForHydration(page.getByRole("button", { name: "Login", exact: true }));
      await page.getByLabel("Email or Username").fill(identifier);
      await page.getByLabel("Password", { exact: true }).fill(strongPassword);
      await page.getByRole("button", { name: "Login", exact: true }).click();
      const error = page.getByText(/invalid credentials/i);
      await expect(error).toBeVisible();
      return error.textContent();
    };
    const social = await attempt(user.email);
    const unknown = await attempt(uniqueEmail("nobody"));
    expect(social).toBe(unknown);
    await expect(page).toHaveURL(/\/login$/);
  });
});
