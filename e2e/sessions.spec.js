// Security plan H3: server-side sessions that can be listed and revoked.
const { test, expect, signIn, uniqueEmail } = require("./fixtures");

/** A second, independent browser signed in as the same user. */
async function secondBrowser(browser, baseURL, email) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  const page = await context.newPage();
  await signIn(page, email, { "x-forwarded-for": "10.201.0.1" });
  return { context, page };
}

test.describe("sessions", () => {
  test("lists both browsers and signs the other one out everywhere", async ({ page, user, browser, baseURL }) => {
    const other = await secondBrowser(browser, baseURL, user.email);

    await page.goto("/settings/security");
    const list = page.getByRole("region", { name: "Where you're signed in" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("(this browser)")).toHaveCount(1);

    await page.getByRole("button", { name: "Sign out everywhere else" }).click();
    await expect(page.getByRole("status")).toHaveText("Signed out of 1 other session.");
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // The other browser's cookie no longer works.
    const me = await other.page.request.get("/api/auth/me");
    expect((await me.json()).user).toBeNull();
    await other.page.goto("/dashboard", { waitUntil: "commit" });
    await expect(other.page).toHaveURL(/\/login(\?|$)/);

    // This browser is still signed in.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await other.context.close();
  });

  test("signing out this browser from the list ends the session", async ({ page, user }) => {
    expect(user.email).toBeTruthy();
    await page.goto("/settings/security");
    await page.getByRole("button", { name: /\(this browser\)/ }).click();
    await expect(page).toHaveURL(/\/login(\?|$)/);
    expect((await (await page.request.get("/api/auth/me")).json()).user).toBeNull();
  });

  test("logout deletes the session on the server, not just the cookie", async ({ page, user, baseURL }) => {
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "session");
    expect(session, "signed-in browser has a session cookie").toBeTruthy();
    expect(session.httpOnly).toBe(true);

    await page.request.post("/api/auth/logout");

    // Replaying the old cookie value from a fresh context gets nothing.
    const replay = await page.context().browser().newContext();
    await replay.addCookies([{ ...session }]);
    const res = await replay.request.get(`${baseURL}/api/auth/me`);
    expect((await res.json()).user).toBeNull();
    await replay.close();
    expect(user.email).toBeTruthy();
  });

  test("another user can't revoke your session by id", async ({ page, user, browser, baseURL }) => {
    expect(user.email).toBeTruthy();
    const victim = await secondBrowser(browser, baseURL, uniqueEmail("victim"));
    const { sessions } = await (await victim.page.request.get("/api/auth/sessions")).json();
    const res = await page.request.delete(`/api/auth/sessions/${sessions[0].id}`);
    expect(res.status()).toBe(404);
    expect((await (await victim.page.request.get("/api/auth/me")).json()).user).not.toBeNull();
    await victim.context.close();
  });
});
