# End-to-end UX tests (Playwright)

Browser tests for the main user journeys, run in Chromium, Firefox and WebKit (Safari's engine), plus phone-sized Chrome and Safari. Jest (`npm test`) still covers logic, API routes and components; these specs cover what jsdom can't: real layout, navigation, hydration, 3D transforms and canvas drawing.

## Running

```bash
docker compose up -d dynamodb-local   # once; the suite never talks to real AWS
npx playwright install                # once per Playwright upgrade
npm run test:e2e                      # all projects
npm run test:e2e -- --project=webkit  # one browser
npm run test:e2e:ui                   # interactive runner
npx playwright show-report            # last HTML report (traces on failure)
```

Playwright starts `next dev` on port 3100 (`E2E_PORT` to change it) with `OAUTH_MOCK=true` and fake AWS keys, and stops it afterwards. Set `E2E_REUSE_SERVER=1` to reuse a server already on that port, but only one started with the same env, since its env is not checked. Global setup creates the DynamoDB tables and compiles every route once. Under `next dev`, a page that is open while another route compiles can reload repeatedly and trip the rate limiter.

**Firefox on macOS 27:** Playwright's Firefox build exits at launch ("Could not find profile folder"), so the `firefox` project is skipped on macOS unless `E2E_FIREFOX=1`. It runs in CI on Linux.

## Writing specs

- Import `test`/`expect` from `./fixtures`, not `@playwright/test`.
- Ask for the `user` fixture to get a brand-new signed-in account (mock OAuth, unique email), so tests never share data and can run in parallel.
- Each test sends its own `X-Forwarded-For`, so the proxy's per-IP rate limits apply per test.
- On server-rendered pages (login, sign up, the OAuth sandbox), call `waitForHydration(locator)` before the first click; earlier clicks are silently lost.
- Prefer roles, labels and visible text over CSS classes. CSS Module class names are only stable in `next dev`, which the coin face check relies on.

## Known failures

- `coin-flip.spec.js` › "the coin shows the face it announced": marked `test.fail` on WebKit. Safari never hides the back of the tails face, so a coin that lands on heads shows tails seen from behind (upside down, since the coin flips end over end). Remove the `test.fail` line once the CSS is fixed; Playwright will report it if the test starts passing.
