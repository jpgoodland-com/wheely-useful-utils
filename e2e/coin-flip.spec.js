const { test, expect } = require("./fixtures");

const flipButton = (page) => page.getByRole("button", { name: "Flip Coin" });
// One coin announces "Landed on heads!"; several announce a count such as "3 heads, 2 tails".
const result = (page) => page.getByText(/^(Landed on (heads|tails)!|\d+ heads, \d+ tails)$/);

const sharp = require("sharp");

const coinLocator = (page) => page.locator('[class*="__heads"]').first().locator("..");

async function pixels(locator) {
  const png = await locator.screenshot({ animations: "disabled" });
  return sharp(png).resize(48, 48).greyscale().raw().toBuffer();
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Which face the first coin is showing, judged from what the browser actually
 * painted. The coin is compared with flat (2D) shots of each face on its own,
 * so the references don't depend on the engine getting 3D transforms and
 * backface-visibility right, which is what this checks and jsdom can't.
 */
async function visibleFace(page) {
  const coin = coinLocator(page);
  await coin.scrollIntoViewIfNeeded();
  const landed = await pixels(coin);

  const flat = (side) =>
    coin.evaluate((el, show) => {
      const saved = [el, ...el.children].map((c) => c.getAttribute("style"));
      el.style.transition = "none";
      el.style.transform = "none";
      // Show only the chosen face, flat; hide the other face and the rim layers.
      for (const layer of el.children) {
        const shown = layer.className.includes(`__${show}`);
        layer.style.transform = "none";
        layer.style.visibility = shown ? "visible" : "hidden";
      }
      return saved;
    }, side);
  const restore = (saved) =>
    coin.evaluate((el, styles) => {
      [el, ...el.children].forEach((c, i) => (styles[i] === null ? c.removeAttribute("style") : c.setAttribute("style", styles[i])));
    }, saved);

  const reference = {};
  for (const side of ["heads", "tails"]) {
    const saved = await flat(side);
    reference[side] = await pixels(coin);
    await restore(saved);
  }
  return distance(landed, reference.heads) < distance(landed, reference.tails) ? "heads" : "tails";
}

async function openCoinFlip(page) {
  await page.goto("/features/coin-flip");
  await expect(page.getByText("Click the coin or press Flip below")).toBeVisible();
  await expect(page.getByText("Total Flips: 0")).toBeVisible();
}

test.describe("coin flip", () => {
  test("a flip locks the controls, then shows a result that matches the tally", async ({ page, user }) => {
    await openCoinFlip(page);

    await flipButton(page).click();
    await expect(page.getByText("Flipping...")).toBeVisible();
    await expect(flipButton(page)).toBeDisabled();

    await expect(result(page)).toBeVisible();
    await expect(flipButton(page)).toBeEnabled();
    const side = (await result(page).textContent()).match(/heads|tails/)[0];

    await expect(page.getByText("Total Flips: 1")).toBeVisible();
    await expect(page.getByText(side === "heads" ? "Heads: 1 (100%)" : "Tails: 1 (100%)")).toBeVisible();
  });

  test("the coin shows the face it announced, for both heads and tails", async ({ page, user, browserName }) => {
    test.slow(); // keeps flipping until it has seen both sides
    // Known bug: WebKit (Safari) never hides the back of the tails face, so a
    // coin that lands on heads shows tails seen from behind. Remove once fixed.
    test.fail(browserName === "webkit", "Safari shows the back of the tails face when the coin lands on heads");
    await openCoinFlip(page);
    const seen = new Set();
    for (let flips = 1; flips <= 12 && seen.size < 2; flips++) {
      await flipButton(page).click();
      await expect(page.getByText(`Total Flips: ${flips}`)).toBeVisible();
      const side = (await result(page).textContent()).match(/heads|tails/)[0];
      await expect.poll(() => visibleFace(page), { message: `flip ${flips} announced ${side}` }).toBe(side);
      seen.add(side);
    }
    expect([...seen].sort()).toEqual(["heads", "tails"]);
  });

  test("the coin itself flips on click and from the keyboard", async ({ page, user }) => {
    await openCoinFlip(page);
    const coin = page.getByRole("button", { name: /^Coin flipper/ });

    await coin.click();
    await expect(result(page)).toBeVisible();
    await expect(page.getByText("Total Flips: 1")).toBeVisible();

    await coin.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Flipping...")).toBeVisible();
    await expect(result(page)).toBeVisible();
    await expect(page.getByText("Total Flips: 2")).toBeVisible();
  });

  test("5x flips five coins in one go and keeps them in history", async ({ page, user }) => {
    await openCoinFlip(page);
    await page.getByRole("button", { name: "5x" }).click();
    await flipButton(page).click();

    await expect(result(page)).toBeVisible();
    await expect(page.getByText("Total Flips: 5")).toBeVisible();
    const recent = page.getByText("Recent flips (last 20):").locator("xpath=following-sibling::div[1]").locator("span");
    await expect(recent).toHaveCount(5);

    // History is saved server-side, so it survives a reload.
    await page.reload();
    await expect(page.getByText("Total Flips: 5")).toBeVisible();
  });

  test("clear history asks first and resets the statistics", async ({ page, user }) => {
    await openCoinFlip(page);
    await flipButton(page).click();
    await expect(page.getByText("Total Flips: 1")).toBeVisible();

    const clear = page.getByRole("button", { name: "Clear History" });
    page.once("dialog", (d) => d.dismiss());
    await clear.click();
    await expect(page.getByText("Total Flips: 1")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await clear.click();
    await expect(page.getByText("Total Flips: 0")).toBeVisible();
    await expect(page.getByText("No flips yet. Spin above to start!")).toBeVisible();
  });
});
