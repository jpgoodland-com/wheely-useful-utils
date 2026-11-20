// Runs once before the suite: make sure DynamoDB Local is up and has the
// app's tables. Tests never talk to real AWS.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function globalSetup(config) {
  // Same env the web server gets (playwright.config.js), so the two can't drift.
  const serverEnv = config.webServer.env;
  const ENDPOINT = serverEnv.DYNAMODB_ENDPOINT;

  if (!/^http:\/\/(localhost|127\.0\.0\.1|dynamodb-local)(:\d+)?\/?$/.test(ENDPOINT)) {
    throw new Error(`E2E tests only run against DynamoDB Local, not ${ENDPOINT}`);
  }

  // DynamoDB Local answers a bare GET with a 400; any answer means it's up.
  // A container started just before the run (as in CI) can take a few seconds.
  for (let attempt = 1; ; attempt++) {
    try {
      await fetch(ENDPOINT, { signal: AbortSignal.timeout(5_000) });
      break;
    } catch {
      if (attempt === 15) {
        throw new Error(
          `DynamoDB Local is not reachable at ${ENDPOINT}. Start it with:\n  docker compose up -d dynamodb-local`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  // init-db.mjs is idempotent and logs errors without failing, so check its output.
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "init-db.mjs")], {
    env: {
      ...process.env,
      AWS_REGION: serverEnv.AWS_REGION,
      AWS_ACCESS_KEY_ID: serverEnv.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: serverEnv.AWS_SECRET_ACCESS_KEY,
      DYNAMODB_ENDPOINT: ENDPOINT,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!out.includes("Database initialized.")) {
    throw new Error(`scripts/init-db.mjs did not finish:\n${out}`);
  }

  await warmUp(config.projects[0].use.baseURL);
};

// next dev compiles a route on its first request, and pages that are open
// while that happens can reload over and over, enough to trip the rate limiter.
// Compiling every page up front, one at a time, keeps the tests out of that.
const PAGES = [
  "/",
  "/login",
  "/signup",
  "/auth/mock",
  "/dashboard",
  "/settings",
  "/settings/account",
  "/features/coin-flip",
  "/features/wheel",
  "/features/wheel/warm-up",
  "/features/capacity-planner",
  "/features/capacity-planner/warm-up",
  "/features/capacity-planner/aggregate",
  "/wheel/warm-up",
  // API routes compile on first use too (these answer 401 when signed out).
  "/api/auth/me",
  "/api/coin-flip",
  "/api/wheels",
  "/api/capacity-plans",
];

async function warmUp(baseURL) {
  for (const path of PAGES) {
    await fetch(new URL(path, baseURL), {
      headers: { "x-forwarded-for": "10.0.0.1" },
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
  }
}
