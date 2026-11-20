// Security plan H12: the audit trail, as users and admins see it.
const { test, expect, signIn, totpCode } = require("./fixtures");

test.describe("audit trail", () => {
  test("a user's sign-in and security changes appear in their activity", async ({ page, user }) => {
    expect(user.email).toBeTruthy();
    await page.goto("/settings/security");
    const activity = page.getByRole("region", { name: "Recent security activity" });
    await expect(activity.getByText("Signed in")).toBeVisible();

    await page.getByRole("button", { name: "Set up authenticator app" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent()).trim();
    await page.getByLabel("Enter the 6-digit code it shows").fill(totpCode(secret));
    await page.getByRole("button", { name: "Turn on" }).click();
    await page.getByRole("button", { name: "I've saved them" }).click();

    await page.reload();
    await expect(page.getByRole("region", { name: "Recent security activity" }).getByText("Authenticator app turned on")).toBeVisible();
  });

  test("the platform audit log is closed to anyone without admin MFA", async ({ page, clientHeaders }) => {
    await signIn(page, "e2e-admin@example.com", clientHeaders);
    expect((await page.request.get("/api/admin/audit")).status()).toBe(403);
  });

  test("activity is private to its owner", async ({ request }) => {
    expect((await request.get("/api/auth/activity")).status()).toBe(401);
  });
});
