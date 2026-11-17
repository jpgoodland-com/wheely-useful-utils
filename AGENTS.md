<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# Project notes

Everything above the `END:nextjs-agent-rules` marker is managed by `next dev`; add project notes below it only.

## Conventions

- Plain JavaScript (no TypeScript), `@/` import alias, Vanilla CSS (`app/globals.css` utilities plus CSS Modules). No CSS frameworks.
- Pages under `app/features/<id>/` are client components: they call `useAuth()` and redirect to `/login` when signed out. Wrap `useSearchParams()` in `<Suspense>`.
- Route params are a Promise in this Next.js version: `const { id } = await params`.
- `proxy.js` (Next 16's replacement for middleware) only does HTTPS, HSTS, rate-limit tiers and a 404 for any `Next-Action` header (the app has no Server Actions; remove that check if you add a `"use server"` function). Every API route must call `getSession()` itself, except `GET /api/health` (the ALB health check), which is public, touches no data, and skips the proxy's HTTPS redirect and rate limits.
- The service runs two Fargate Spot tasks (`desired_count = 2`). Keep per-request state out of process memory. The one exception today is `lib/rateLimit.js`, whose buckets are per task, so a client can get up to twice each limit.
- API routes: read bodies with `readJsonLimited` (`lib/requestBody.js`); validate by copying known fields into a fresh object and rejecting prototype keys (`lib/objectGuard.js`); map domain errors to 400/403/404/409 and hide anything else behind a 500 `"Internal Error"`.

## Feature registry

- `lib/featureRegistry.js` drives the dashboard cards. `status: "dev"` cards are hidden in production and show as non-clickable "Coming Soon" elsewhere.
- The donate entry has `pinnedLast: true`, so `getVisibleFeatures()` always lists it last. Add new features anywhere in the array.
- New icons must be added to `ICON_MAP` in `components/FeatureCard.js`, or the card falls back to the dice icon.

## Persistence checklist

A feature that stores data needs all of these:
1. Table name in `lib/dynamodb.js` and in the separate copy in `scripts/init-db.mjs` (with its `CreateTableCommand`).
2. Table in `terraform/dynamodb.tf` (PAY_PER_REQUEST, SSE, `terraform fmt` spacing) and its ARN (plus `/index/*` for GSIs) in `terraform/iam.tf`.
3. The table/GSI lists in `__tests__/infra/` (schema parity, cost, security tests).
4. Cleanup in both account-deletion routes: `app/api/auth/delete-account/route.js` and `app/api/admin/users/[userId]/route.js`.

## Team Capacity Planner

- `lib/capacity/` holds the pure, client-safe logic (dates, Sprints, working days, units, totals, ranges, aggregation, export tables, validation). Server-only modules are `store.js` (DynamoDB), `xlsx.js` (`write-excel-file`), `http.js`, `views.js` and `routeHelpers.js`.
- Calendar dates are `YYYY-MM-DD` strings handled as integer epoch days. Never build them from local-time `Date` objects or `toISOString()`; use `todayInZone(plan.timeZone)` for "today". Timestamps are UTC ISO strings.
- Table `WheelApp_CapacityPlans`, single `PK`:
  - `PLAN#<planId>` holds settings, `memberIds` (row order), `guests` (members without an account), `access` ({ userId: "edit" | "view" }) and `version`. It is the source of truth.
  - `PLANACCESS#<planId>#<userId>` items are a reverse index. They are the only items with a `userId` attribute, which keeps the `UserIdIndex` GSI sparse. A team member whose access is removed keeps an item with role `"member"`, so account deletion can find and remove their row and availability. Plan roles always come from the `PLAN#` item, never from these items.
  - `PLANAVAIL#<planId>#<memberId>` stores availability exceptions as `{ date: fractionOfDay }`; a missing date means a full day.
  - `PLANQUOTA#<userId>` enforces the 10-owned-plan limit inside transactions.
- Plan changes go through `mutatePlan()` in `store.js`, a version-checked transaction that retries on conflict. Keep access items in the same transaction as the plan change.

## Wheel show

- The server picks the winner (`/api/wheels/[id]/spin`); `components/WheelSpinner.js` only animates to it. Never let visuals decide the result.
- `lib/wheel/` holds pure, client-safe logic (`spinPhysics`, `wheelGeometry`, `showTimeline`, `hostQuotes`, `hostPoses`) plus the canvas renderers (`drawWheel`, `drawHost`). The component runs one `requestAnimationFrame` loop with per-frame state in refs, not React state.
- The page applies new category weights and the winner banner in `onSpinFinished`, after the wheel stops, so slices never change mid-spin.
- Hosts are data, not code: `public/hosts/index.json` (manifest) plus one `public/hosts/<id>.json` per host (`name`, `tagline`, `look`, `quotes`) and `shared-quotes.json`. `lib/wheel/hostConfig.js` loads and validates them (ids, hex colors, known head/outfit styles, same-site `.json` paths) and falls back to a built-in host, so bad data skips one host instead of breaking the page. Adding a host is a JSON change; only a new body shape needs a routine in `lib/wheel/drawHost.js` (`HEAD_STYLES`/`OUTFIT_STYLES`/`BASE_COLORS` are the contract).
- The chosen host id is saved in `localStorage` (`wheelHost`) and re-checked against the loaded list.
- Winner names are user data: render quotes as React text, never HTML.

## Monitoring

- `terraform/monitoring.tf` holds the CloudWatch alarms, SNS email topic and dashboard. New alarms must notify `local.alarm_actions` (alarm and OK) and be listed in the dashboard's alarm widget; `__tests__/infra/terraform-monitoring.test.js` checks both.
- Security events go through `logSecurityEvent(name, fields)` (`lib/securityLog.js`), which writes one JSON line. Every event name needs a log metric filter in `monitoring.tf`. Never log passwords, tokens or the identifiers people type in.

## Testing

- `npm test` runs Jest. Route tests import handlers directly and mock `@/lib/session`.
- `__tests__/helpers/fakeDynamo.js` is an in-memory DynamoDB that supports only the commands and condition expressions the app uses, and throws on anything else. Extend it when adding new expressions.
- Component tests need `/** @jest-environment jsdom */` and `import "@testing-library/jest-dom"` at the top.
- `DYNAMODB_INTEGRATION=1 npx jest __tests__/integration` runs the capacity store against DynamoDB Local (`docker compose up -d dynamodb-local && node scripts/init-db.mjs`). It only touches items it creates.
- `npm run test:e2e` runs the Playwright specs in `e2e/` (Chromium, Firefox, WebKit, phone Chrome/Safari) against `next dev` on port 3100 and DynamoDB Local; see `e2e/README.md`. Use the `user` fixture for a fresh signed-in account per test. Jest ignores `e2e/`. CI runs both suites.
