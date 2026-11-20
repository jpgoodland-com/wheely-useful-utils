const { test, expect, openNav } = require("./fixtures");

test.describe("dashboard", () => {
  test("lists the live tools as links and dev tools as Coming Soon", async ({ page, user }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();

    for (const [name, href] of [
      ["Spin the Wheel", "/features/wheel"],
      ["Coin Flip", "/features/coin-flip"],
      ["Team Capacity Planner", "/features/capacity-planner"],
      ["Buy a Dev a Coffee", "/features/donate"],
    ]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }

    // next dev shows "dev" features as non-clickable cards.
    await expect(page.getByText("Random List Picker")).toBeVisible();
    await expect(page.getByRole("link", { name: /Random List Picker/ })).toHaveCount(0);
    await expect(page.getByText("Coming Soon").first()).toBeVisible();
  });

  test("feature cards open their tool", async ({ page, user }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Coin Flip/ }).click();
    await expect(page.getByRole("heading", { name: /Coin Flip/ })).toBeVisible();

    await page.locator(".breadcrumb").getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("header navigation reaches settings and the dashboard", async ({ page, user }) => {
    await page.goto("/dashboard");
    await openNav(page);
    await page.getByRole("banner").getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await openNav(page);
    await page.getByRole("banner").getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();
  });
});

test.describe("settings", () => {
  test("account settings show the signed-in user's profile", async ({ page, user }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
    await page.getByRole("link", { name: /Account/ }).first().click();

    await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
    await expect(page.getByText("User", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Account" })).toBeVisible();
  });
});
