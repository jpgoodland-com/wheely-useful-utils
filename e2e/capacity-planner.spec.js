const { test, expect } = require("./fixtures");

async function createPlan(page, name) {
  await page.goto("/features/capacity-planner");
  await expect(page.getByRole("heading", { name: "My plans (0 of 10)" })).toBeVisible();
  await page.getByRole("button", { name: "New plan" }).click();

  const dialog = page.getByRole("dialog", { name: "New team plan" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Team name").fill(name);
  await expect(dialog.getByLabel("Include me as a team member")).toBeChecked();
  await dialog.getByRole("button", { name: "Create plan" }).click();

  await expect(page).toHaveURL(/\/features\/capacity-planner\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

test.describe("team capacity planner", () => {
  test("a new user sees an empty plan list and can't combine nothing", async ({ page, user }) => {
    await page.goto("/features/capacity-planner");
    await expect(page.getByText("You don't own any plans yet. Create one to get started.")).toBeVisible();

    const combined = page.getByRole("link", { name: /View combined \(0\)/ });
    await expect(combined).toHaveAttribute("aria-disabled", "true");
    // Playwright won't click an aria-disabled element unless forced. The URL
    // check alone would pass before a client-side navigation could start, so
    // wait briefly for one and expect none.
    const navigated = page
      .waitForURL(/\/aggregate/, { timeout: 2_000, waitUntil: "commit" })
      .then(() => true, () => false);
    await combined.click({ force: true });
    expect(await navigated).toBe(false);
    await expect(page).toHaveURL(/\/features\/capacity-planner$/);
  });

  test("creates a plan with the creator as a member and shows the capacity grid", async ({ page, user }) => {
    await createPlan(page, "Platform team");
    const grid = page.getByRole("region", { name: "Capacity by team member and Sprint" });
    await expect(grid).toBeVisible();
    await expect(grid.getByText(user.name).first()).toBeVisible();
    await expect(grid.getByRole("button", { name: /Edit availability/ }).first()).toBeVisible();
  });

  test("cancelling the new plan dialog creates nothing", async ({ page, user }) => {
    await page.goto("/features/capacity-planner");
    await page.getByRole("button", { name: "New plan" }).click();
    const dialog = page.getByRole("dialog", { name: "New team plan" });
    await dialog.getByLabel("Team name").fill("Never saved");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "My plans (0 of 10)" })).toBeVisible();
  });

  test("combines selected plans into one view", async ({ page, user }) => {
    await createPlan(page, "Team Alpha");
    await page.goto("/features/capacity-planner");
    await expect(page.getByRole("heading", { name: "My plans (1 of 10)" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Include Team Alpha in the combined view" }).check();
    await page.getByRole("link", { name: "View combined (1)" }).click();

    await expect(page.getByRole("heading", { name: "Combined capacity" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Combined capacity by team" }).getByText("Team Alpha")).toBeVisible();
  });
});
