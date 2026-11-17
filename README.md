# Wheely Useful Utils! 🛠️

A modern, modular multi-tool web application built with **Next.js 16 (App Router)**, **React 19**, **Vanilla CSS (Glassmorphic dark design)**, and **AWS DynamoDB**.

Originally starting as a dynamic probability wheel spinner, the platform is architected to easily scale with new business and productivity tools through a central feature registry.

---

## Features & Capabilities

- 🎡 **Spin the Wheel**: Dynamic probability wheels with auto-adjusting odds for fair random selection, presented game-show style: a pixel-art host walks up and spins the wheel, marquee lights chase around the rim, and the wheel accelerates then slows to a stop. Pick the host (Ace, Fox or Chip) from a dropdown. See [Wheel Hosts](#wheel-hosts).
- 📋 **Random List Picker** *(Dev)*: Quick item picker for raffles, giveaways, and decision making.
- 👥 **Team Generator** *(Dev)*: Split rosters into balanced, randomized teams.
- 🪙 **Coin Flip**: 3D animated coin toss with customizable coins (presets, text, emoji, image faces), anti-alternation randomization, and persistent history.
- 📅 **Team Capacity Planner**: Sprint-by-Sprint team availability in days, hours or story points, with sharing, a combined multi-team view, and CSV/Excel export. See [Team Capacity Planner](#team-capacity-planner).
- ☕ **Buy a Dev a Coffee**: Optional PayPal donation page with suggested amounts ($3 / $5 / $10 / $25). See [Donation Link](#donation-link-optional).
- 👤 **Account & RBAC**: User authentication, profile management, and role-based access control with an administration panel (`/settings/admin`).
- 📱 **Mobile & Tablet Optimized**: Fully responsive glassmorphism interface with drawer navigation, adaptive grids, and touch-friendly controls.

---

## Architecture Overview

- **Feature Registry (`lib/featureRegistry.js`)**: Single source of truth defining available capabilities, routes, icons, and development statuses.
  - In development (`NODE_ENV !== "production"`), all features (including in-progress features with "Coming Soon" badges) are displayed on `/dashboard`.
  - In production, only completed `status: "live"` features are exposed.
  - Cards appear in registry order, except entries flagged `pinnedLast: true` (the donate card), which always appear last.
- **Routing**:
  - `/` — Public landing page
  - `/about`, `/privacy` — Public About page and Privacy Policy
  - `/dashboard` — Authenticated tool hub with dynamic feature cards
  - `/features/<id>` — Modular feature pages (e.g. `/features/wheel`, `/features/wheel/[id]`)
  - `/features/capacity-planner`, `/features/capacity-planner/[planId]`, `/features/capacity-planner/aggregate?ids=…` — Capacity planner list, plan grid, and combined view
  - `/settings` — User settings hub
  - `/settings/account` — Profile and account deletion (asks owners to transfer or delete capacity plans that others can edit)
  - `/settings/admin` — Admin panel for user management and email invites
- **Data**: DynamoDB tables `WheelApp_Users`, `WheelApp_Wheels`, `WheelApp_CoinFlip` and `WheelApp_CapacityPlans`, each keyed by a single `PK` string. Tables are defined in three places that must stay in sync: `lib/dynamodb.js`, `scripts/init-db.mjs` (local) and `terraform/dynamodb.tf` (AWS); `__tests__/infra/` checks they match.
- **Design System**: Strict Vanilla CSS with CSS custom properties (`app/globals.css`) and glassmorphic panels. No external CSS frameworks.

For detailed developer and agent instructions, see [AGENTS.md](AGENTS.md).

---

## Adding a New Feature

1. **Register the feature** in `lib/featureRegistry.js`:
   ```javascript
   {
     id: "my-feature",
     name: "My Feature",
     description: "Describe what the tool does.",
     icon: "Wrench", // Lucide icon name
     href: "/features/my-feature",
     color: "#3b82f6",
     status: "dev", // "dev" for WIP, "live" for production
     requiredRole: null,
   }
   ```
2. **Register the icon** in `components/FeatureCard.js` (import from `lucide-react` and add to `ICON_MAP`).
3. **Create the page** at `app/features/<id>/page.js`.
4. The feature card will automatically appear on the `/dashboard`. Add new entries anywhere in the array — the donate card stays last regardless.

If the feature stores data, also:
- add its table to `lib/dynamodb.js`, `scripts/init-db.mjs`, `terraform/dynamodb.tf` and `terraform/iam.tf`, plus the table lists in `__tests__/infra/`;
- delete the user's data from both account-deletion routes (`app/api/auth/delete-account` and `app/api/admin/users/[userId]`);
- consider a rate-limit tier in `proxy.js`.

---

## Wheel Hosts

A **Host** dropdown under the wheel picks who spins it: **Ace** (pit-lane racing pundit; the default), **Fox** (ultra-marathon fox) and **Chip** (classic game show host). The choice is remembered in the browser and is locked while the wheel is spinning.

Hosts are plain JSON in `public/hosts/`. Edit a file and reload; no rebuild is needed.

```
public/hosts/
  index.json          which hosts exist, which is the default, and the shared quotes file
  shared-quotes.json  engineering/SDLC lines every host says
  ace.json            one self-contained file per host
  fox.json
  chip.json
```

**Add a host**
1. Copy `public/hosts/ace.json` to `public/hosts/<id>.json` (lowercase letters, digits and dashes).
2. Edit its `name`, `tagline`, `look` and `quotes`.
3. Add the id to `hosts` in `public/hosts/index.json`. Put it first, or set `default`, to make it the default.

**A host file**
```json
{
  "version": 1,
  "name": "Ace",
  "tagline": "Pit-lane pundit, ready to race",
  "look": {
    "head": "bald",
    "outfit": "racing",
    "colors": { "skin": "#f6d2b8", "suit": "#166534", "stripe": "#facc15" }
  },
  "quotes": { "result": ["{winner} takes the chequered flag! Brilliant!"] }
}
```

- `look.head`: `hair`, `bald` or `fox`. `look.outfit`: `suit`, `racing` or `trail`. These are the drawing styles built into `lib/wheel/drawHost.js`; a new body shape needs a small drawing routine added there.
- `look.colors` is optional and overrides the default palette. Values are hex colors like `#1a2b3c`. The key names are the `BASE_COLORS` in `lib/wheel/drawHost.js`, plus `sleeve`, `hand` and `shoeTrim`.
- `quotes` is layered on top of `shared-quotes.json`, so a host file only needs the lines it adds. Categories: `spinStart`, `waiting`, `slowing`, `result`, `repeatWinner` (same winner twice in a row), `idle` and `error`. Optional `bubbleMs` sets how long a bubble stays up.
- Placeholders: `{winner}` (the result), `{random}` (a random other slice), `{wheel}` (wheel name) and `{wins}` (the winner's win count). Unknown placeholders are removed, and a line is skipped when it needs a value that isn't available.
- Lines are plain text (max 120 characters), shown in random order without back-to-back repeats.

**Mistakes don't break the page.** A host with a bad name or style is skipped, an invalid color or unknown key is ignored, and the browser console says what was dropped (`Wheel hosts: fox.json: look.head must be one of: ...`). If no host file loads at all, a built-in classic host is used and the dropdown is hidden.

The server still picks the winner (`POST /api/wheels/:id/spin`); the host and animation only play out the result.

## Team Capacity Planner

Plan how much each team member can work in each Sprint, see the team's total, and combine teams for a cross-team view (`/features/capacity-planner`).

**Setting up a plan**
- Team name and **team time zone** (decides what "today" and the current Sprint are).
- **Units**: days, hours (with hours per day), or story points (with points per day, e.g. 2 points = 1 day).
- **Working weekdays** (default Mon–Fri), **Sprint length** (1–8 weeks) and the **Sprint 1 start date** (date picker). Sprints are numbered from the start date and can be renamed inline.
- Each user can own up to **10 plans**.

**Using the grid**
- Rows are team members, columns are Sprints, with a team total row and a total column for the selected range.
- Select a cell to edit that person's working days in 0.25-day steps (shown in the plan's units); **Accept** saves, **Discard** cancels. Everyone defaults to full availability.
- Choose the range with From/To dates or presets (3 months, 6 months, 52 weeks — the maximum). The "N Sprints in view" summary and a brief highlight on the grid confirm each change; the grid scrolls sideways.

**Team members and sharing** (Configure)
- Team members can be app users (they get edit access automatically) or **people without an account**, added by name. Those rows are filled in by editors, can be renamed, and can later be **linked to an account** — the row and its availability move to that user.
- Share with other users as **Can edit** or **Read only**. Editors can change availability, rename Sprints, and manage team members and sharing. Only the owner changes core settings, transfers ownership or deletes the plan.

**Combined view** — tick several plans (up to 10) and choose *View combined*. Teams with the same Sprint cadence line up by Sprint; otherwise columns are calendar weeks. A toggle above the table shows capacity in **Source units** (each team's own units, with a separate total per unit), **Days**, or **Hours** (using each plan's hours per day, 8 by default); when values are converted, each team's original units are shown underneath. The choice is kept in the page URL.

**Export** — CSV (Sprint summary or daily detail) or Excel (Summary and Daily sheets; totals are `SUM` formulas that recalculate when edited offline). Anyone with access can export. Names that look like formulas are neutralized.

**Account deletion** — owned plans that nobody else can edit are deleted with the account. If others can edit a plan, the owner must choose to transfer it to one of them (it is kept) or delete it for everyone. When an admin deletes a user, that user's plans are deleted.

**How data is stored** — timestamps are UTC (ISO-8601). Availability is stored per calendar date in the team's time zone, and only days that differ from full availability are saved, as a fraction of a day, so changing units never alters data. Everything lives in the `WheelApp_CapacityPlans` table (sparse `UserIdIndex` GSI for "plans shared with me").

**Code map** — shared logic and data access in `lib/capacity/`, API routes in `app/api/capacity-plans/`, pages in `app/features/capacity-planner/`, UI components in `components/capacity/`.

---

## Local Development (Docker)

```bash
# Start Next.js (port 3000) & local DynamoDB (port 8000) + auto-init tables
docker compose up --build -d

# View local logs (including console-printed email invites)
docker compose logs web -f

# Shut down the stack
docker compose down
```

## Local Development (Host Machine)

Requires Node v20+ and local `.env.local` configuration:
```env
NODE_ENV=development
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=fakeMyKeyId
AWS_SECRET_ACCESS_KEY=fakeSecretAccessKey
DYNAMODB_ENDPOINT=http://localhost:8000
JWT_SECRET=super_secret_local_key_for_jwt
OAUTH_MOCK=true
DONATION_URL=https://paypal.me/your-name   # optional, see below
```

Commands:
```bash
npm install     # Install dependencies
npm run dev     # Start Next.js dev server (http://localhost:3000)
npm run build   # Build production application
npm test        # Run Jest test suite
npm run lint    # Run ESLint check

# Optional: run the capacity planner store against local DynamoDB (port 8000)
DYNAMODB_INTEGRATION=1 npx jest __tests__/integration
```

---

## AWS Deployment

Production deployment on ECS Fargate, ALB, and DynamoDB. Infrastructure configurations are maintained in [terraform/](terraform).

### Monitoring and alerts

[terraform/monitoring.tf](terraform/monitoring.tf) sets up CloudWatch alarms, email notifications and a `wheel-app-operations` dashboard (its link is the `dashboard_url` Terraform output).

| Area | Alarms |
|---|---|
| Availability | no healthy tasks, unhealthy task, load balancer 5xx, app 5xx rate, app error logs |
| Latency and scaling | p95 response time, request spike, task CPU, task memory |
| Security and abuse | rate-limited clients (DDoS, scraping), failed logins (credential stuffing), 4xx spike (scanning) |
| Email | send volume spike (signup/reset spam), SES bounce rate, SES complaint rate |
| Database | DynamoDB throttling across all tables |

It also emails when a task stops unexpectedly (including Fargate Spot interruptions) and when a deployment fails and is rolled back.

**Turning on email alerts:** add a repository secret `ALARM_EMAIL` (**Settings → Secrets and variables → Actions**). The Terraform workflow passes it as `TF_VAR_alarm_email`. After the next apply, AWS emails that address a confirmation link; alerts only arrive once it is confirmed. Without the secret, the alarms still exist and show on the dashboard, but nobody is emailed.

**Tuning:** `alarm_latency_p95_seconds`, `alarm_requests_per_5min` and `alarm_ses_sends_per_hour` are Terraform variables; other thresholds are in `locals.alarm` in `monitoring.tf`. The security alarms count JSON lines the app logs through `lib/securityLog.js`.

**Cost:** roughly $3.50/month (about $2.40 for the 16 alarms, since metric-math alarms are billed per metric they read, and $0.90 for 3 log-based metrics, plus small log and event charges). The dashboard is free within the first 3 per account.

---

## Donation Link (Optional)

The **Buy a Dev a Coffee** card (`/features/donate`) links to your own PayPal account. Forks should set their own link; if none is set, the page shows "Donations are not configured for this deployment".

**Accepted values** — `https` links on `paypal.me` or `paypal.com` only (anything else is rejected for safety):
- `https://paypal.me/your-name` — the chosen amount is appended automatically (e.g. `.../10USD`)
- `https://www.paypal.com/donate/?hosted_button_id=XXXX` — used as-is (amount chosen on PayPal)

**Local development:** add `DONATION_URL=https://paypal.me/your-name` to `.env.local` and restart the dev server.

**Docker Compose:** export it in your shell (or put it in a `.env` file next to `docker-compose.yml`) before starting the stack: `DONATION_URL=https://paypal.me/your-name docker compose up --build -d`.

**AWS deployment (GitHub Actions + Terraform):**
1. In your repo go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Create a secret named `DONATION_URL` with your PayPal link.
3. The [Terraform workflow](.github/workflows/terraform.yml) passes it as `TF_VAR_donation_url`, which sets the `donation_url` Terraform variable and the container's `DONATION_URL` environment variable.

Running Terraform manually: `export TF_VAR_donation_url="https://paypal.me/your-name"` (or set `donation_url` in a `.tfvars` file).

The link is read at runtime, so changing it only needs a redeploy, not a rebuild. To hide the card entirely, set the donate entry's `status` to `"dev"` in `lib/featureRegistry.js`.
