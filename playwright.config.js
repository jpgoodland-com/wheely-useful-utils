// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// End-to-end UX tests. Run with `npm run test:e2e`; see e2e/README.md.
// The app runs under `next dev` because the mock OAuth sandbox (/auth/mock),
// which every test signs in through, is blocked outside development.
const PORT = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://localhost:${PORT}`;
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || "http://localhost:8000";

// Playwright's Firefox build exits at launch on macOS 27 ("Could not find
// profile folder"), so it runs in CI (Linux) and only locally when asked for.
const firefox = process.platform !== "darwin" || process.env.E2E_FIREFOX === "1";

module.exports = defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  // next dev compiles each route on first request, so the first visit to a
  // page can take several seconds.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(firefox ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }] : []),
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${baseURL}/api/health`,
    // A server that's already running didn't get the env below (mock OAuth,
    // DynamoDB Local), so only reuse one when asked to.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "fakeMyKeyId",
      AWS_SECRET_ACCESS_KEY: "fakeSecretAccessKey",
      DYNAMODB_ENDPOINT,
      JWT_SECRET: "e2e_only_jwt_secret_not_used_anywhere_else",
      OAUTH_MOCK: "true",
      ADMIN_EMAILS: "e2e-admin@example.com",
      DONATION_URL: "https://example.com/donate",
    },
  },
});
