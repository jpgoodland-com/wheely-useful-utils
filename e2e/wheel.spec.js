const { test, expect } = require("./fixtures");

// New wheels start with these three categories (app/features/wheel/page.js).
const DEFAULT_CATEGORIES = ["Option A", "Option B", "Option C"];

async function createWheel(page, name) {
  await page.goto("/features/wheel");
  await page.getByPlaceholder("New wheel name...").fill(name);
  await page.getByRole("button", { name: "Create Wheel" }).click();
  const card = page.locator(".glass-panel").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toBeVisible();
  return card;
}

/** True once the wheel canvas has drawn something (it's blank before the first frame). */
function canvasHasPaint(page) {
  return page.locator("canvas").first().evaluate((c) => {
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] !== 0) return true;
    return false;
  });
}

async function spinAndGetWinner(page) {
  const spin = page.getByRole("button", { name: "SPIN IT" });
  await expect(spin).toBeEnabled();

  // A reduced-motion spin can finish in well under a second, so hold the spin
  // request until the locked button has been seen.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route(/\/api\/wheels\/[^/]+\/spin$/, async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });

  await spin.click();
  await expect(page.getByRole("button", { name: "Spinning..." })).toBeDisabled();
  release();

  const banner = page.locator("div").filter({ has: page.getByRole("heading", { name: /Winning Result/ }) }).last();
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "SPIN IT" })).toBeEnabled();
  return (await banner.locator("p").textContent()).trim();
}

test.describe("wheel management", () => {
  test("creates a wheel, edits its categories and deletes it", async ({ page, user }) => {
    const card = await createWheel(page, "Lunch");
    await expect(card.getByText("Role: Owner • 3 Categories")).toBeVisible();

    await card.getByRole("button", { name: "Config" }).click();
    for (const c of DEFAULT_CATEGORIES) await expect(card.locator(`input[value="${c}"]`).or(card.getByText(c, { exact: true })).first()).toBeVisible();
    await card.getByPlaceholder("Add category...").fill("Pizza");
    await card.getByPlaceholder("Add category...").press("Enter");
    await expect(card.getByText("Role: Owner • 4 Categories")).toBeVisible();
    await card.getByRole("button", { name: "Done" }).click();

    // Survives a reload, so it was saved.
    await page.reload();
    const reloaded = page.locator(".glass-panel").filter({ has: page.getByRole("heading", { name: "Lunch", exact: true }) });
    await expect(reloaded.getByText("Role: Owner • 4 Categories")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await reloaded.locator("button").first().click(); // the trash icon next to the name
    await expect(page.getByRole("heading", { name: "Lunch", exact: true })).toHaveCount(0);
  });

  test("old /wheel/:id links redirect to the feature page", async ({ page, user }) => {
    const card = await createWheel(page, "Legacy");
    const href = await card.getByRole("link", { name: "Spin Wheel" }).getAttribute("href");
    const id = href.split("/").pop();

    await page.goto(`/wheel/${id}`);
    await expect(page).toHaveURL(new RegExp(`/features/wheel/${id}$`));
    await expect(page.getByRole("heading", { level: 2, name: "Legacy" })).toBeVisible();
  });
});

test.describe("spinning", () => {
  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("lands on one of the wheel's categories and records the spin", async ({ page, user }) => {
      const card = await createWheel(page, "Quick spin");
      await card.getByRole("link", { name: "Spin Wheel" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Quick spin" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Probabilities" })).toBeVisible();

      const first = await spinAndGetWinner(page);
      expect(DEFAULT_CATEGORIES).toContain(first);
      const second = await spinAndGetWinner(page);
      expect(DEFAULT_CATEGORIES).toContain(second);
    });
  });

  test("full animation draws the wheel and finishes on the server's winner", async ({ page, user }) => {
    test.slow(); // the host walk-in plus a 6-9 turn spin takes ~10s
    const card = await createWheel(page, "Big spin");
    await card.getByRole("link", { name: "Spin Wheel" }).click();
    await expect.poll(() => canvasHasPaint(page)).toBe(true);

    const spinResponse = page.waitForResponse((r) => /\/api\/wheels\/[^/]+\/spin$/.test(r.url()) && r.request().method() === "POST");
    const winnerPromise = spinAndGetWinner(page);
    const { winners } = await (await spinResponse).json();
    // The banner shows exactly what the server picked; the animation never decides.
    expect(await winnerPromise).toBe(winners[0].name);
  });

  test("an unknown wheel shows an error instead of a spinner", async ({ page, user }) => {
    await page.goto("/features/wheel/does-not-exist");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/not found|error|denied/i);
    await expect(page.getByRole("button", { name: "SPIN IT" })).toHaveCount(0);
  });
});
