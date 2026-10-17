# service-finder-backend

Node.js + TypeScript backend for Service Finder — a pnpm workspace, built on
the same stack, packages and layout as `igroom-backend`.

## Layout

```
apps/
  api/          the HTTP API (Express 5) — its own package.json and .env
packages/
  db/           @service-finder/db — the schema, its migrations (drizzle/) and the connection pools
  valkey/       @service-finder/valkey — the Valkey client, with a deadline on every call
  auth/         @service-finder/auth — every access token's format (back office and business app)
deploy/         the container entrypoint, ECS task definitions, run-task.sh, changed-apps.mjs
Dockerfile      builds any app: `docker build --build-arg APP=api .` (api is the default)
```

Each app is a separate deployable with only its own dependencies — add a
dependency to an app with `pnpm --filter @service-finder/api add <pkg>`, never
to the root. Each also deploys on its own lane of
`.github/workflows/deploy.yml`, and only when something it is built from
changed — see [deploy/README.md](deploy/README.md#which-apps-a-run-deploys).
Every command below runs from the repo root and is forwarded to the right app.

Code goes in a package when more than one app needs it. A package never reads
the environment: each app validates its own env (`src/config/env.ts`) and
passes what a package needs in once, in one small file — for the API,
`src/db/index.ts`, `src/shared/redis.ts`, `src/modules/auth/jwt.ts` and
`src/modules/accounts/jwt.ts`. A
dependency more than one package uses gets its version from the `catalog:` in
`pnpm-workspace.yaml`, so the API and `@service-finder/db` can't end up on two
drizzle-orm versions.

In development, tests and `pnpm typecheck`, apps read the packages straight
from their TypeScript source (the `service-finder-source` export condition),
so a change to a package shows up at once with nothing to rebuild — which is
why every `tsx` script in an app's package.json passes
`--conditions=service-finder-source`, and a new one needs it too. `pnpm build`
compiles every package to its `dist/` and the apps against those, which is
what an image runs.

The schema and its migrations live in `packages/db`, but the API is the one
app that generates and applies migrations — `pnpm db:generate` and
`pnpm db:migrate` run there, against `apps/api/.env`.

## What's in the core

Everything an area of Service Finder will be built on, plus two areas brought
across from iGroom — subscription plans billed through Stripe, and the business
app's identity (businesses, their teams, custom roles & permissions):

| Concern             | Where                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Config, fail-fast   | `apps/api/src/config/env.ts` (zod)                                                  |
| Database            | `packages/db` — pools, read replicas, verified TLS, `timestamps` helper, migrations |
| Errors → HTTP       | `apps/api/src/shared/middlewares/error-handler.ts`                                  |
| API docs            | `/docs` and `/docs.json`, generated from each module's zod validators               |
| Rate limiting       | `apps/api/src/shared/rate-limit.ts` (Valkey, fail-open)                             |
| Email               | `apps/api/src/shared/email.ts` (Resend, console fallback in dev)                    |
| Back-office sign-in | `modules/auth` — Google ID token, mandatory TOTP MFA, rotating refresh tokens       |
| Back-office users   | `modules/users` — invite (pre-provision), change role, deactivate                   |
| Roles & permissions | `modules/roles` — RBAC, enforced per route by `requirePermission("key")`            |
| Plans & billing     | `modules/products`, `prices`, `payment-links` — Stripe-backed, under `/billing`     |
| Business sign-in    | `modules/accounts` — sign-up, password/Google, optional TOTP 2FA, sessions          |
| Business team       | `modules/staff-users` — invite by emailed link, change role, deactivate             |
| Business roles      | `modules/staff-roles` — custom roles, `requireAccountPermission("key")`             |
| Per-business cache  | `apps/api/src/shared/account-cache.ts` (Valkey, versioned, fail-open)               |

### Adding an area

One folder per area under `apps/api/src/modules/<name>/`, the same six files
every existing module has:

```
<name>.routes.ts       Router + requireAuth/requirePermission (back office) or
                       requireAccountAuth/requireAccountPermission (business app) per route
<name>.controller.ts   parse input with the validators, call the service, shape the response
<name>.service.ts      the logic, and this module's own error classes
<name>.validators.ts   zod schemas, registered with the OpenAPI registry
<name>.openapi.ts      registry.registerPath(...) for each route
index.ts               the module's public surface — other modules import only this
```

Then: its tables in `packages/db/src/schema/` (+ an export in `schema/index.ts`
and `pnpm db:generate`), its router in `app.ts`, its `*.openapi.ts` in
`shared/openapi/document.ts`, its paths in `app.routes.test.ts`, its error
classes in `error-handler.ts`, and its permission keys — in
`modules/roles/bo-permissions.seed.ts` for a back-office area (then
`pnpm db:seed:permissions`), or in `DEFAULT_PERMISSIONS` in
`modules/staff-roles/staff-roles.service.ts` for a business-app area (applied at
the next boot, and granted to every Owner role automatically).

### What was left out of iGroom, deliberately

Shops and locations, bookings, availability, POS, waitlist, marketplace,
support sessions, a business's own subscription (the plan/checkout step in
iGroom's sign-up, saved cards, invoices), uploads to S3 and the realtime
(Socket.IO) server are iGroom's business. The business app came across as
identity only — accounts, team, roles — with none of iGroom's salon logic. Each
is a module (or, for realtime, an app plus `packages/events`) that can be
brought across once Service Finder's own version of it is defined — the
workspace, Dockerfile, `changed-apps.mjs` and the workflow already handle a
second app under `apps/`.

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm (`corepack enable` — the version is pinned in `package.json`)
- Docker (for local Postgres and Valkey)

## Ports

Chosen so Service Finder runs alongside iGroom on one machine:

|             | Service Finder | iGroom |
| ----------- | -------------: | -----: |
| API         |           4000 |   3000 |
| Back office |           5273 |   5173 |
| Tenant app  |           5274 |   5174 |
| Postgres    |           5433 |   5432 |
| Valkey      |           6380 |   6379 |

Inside a deployed container the API still listens on 3000, like iGroom's, so
load balancer settings carry across unchanged.

## Getting started

```bash
docker compose up -d                          # Postgres (5433) + Valkey (6380)
cp apps/api/.env.example apps/api/.env        # then fill in the blanks below
pnpm install
pnpm db:migrate                               # apply the migrations in packages/db/drizzle
SEED_SUPERADMIN_EMAIL=you@gmail.com pnpm db:seed
pnpm db:seed:permissions
pnpm db:seed:billing                          # optional — placeholder plans, created in Stripe
pnpm dev                                      # http://localhost:4000, docs at /docs
```

In `apps/api/.env`, fill in:

- `GOOGLE_CLIENT_ID` — a Google OAuth **Web** client. Reusing iGroom's works;
  add `http://localhost:5273` (back office) and `http://localhost:5274`
  (business app) to its Authorised JavaScript origins.
- `JWT_SECRET` and `MFA_ENCRYPTION_KEY` — `openssl rand -hex 32` each. Use
  different values from iGroom's.
- `STRIPE_SECRET_KEY` — a test-mode key (`sk_test_...`) from Stripe Dashboard →
  Developers → API keys. Required: the server won't start without it. A
  separate Stripe account or sandbox from iGroom's keeps the two apps'
  products apart.

Then sign in to the back office with the seeded Google account; the first
sign-in walks you through authenticator (TOTP) setup. The business app needs no
seed — sign a business up from its own sign-up page.

Other commands:

```bash
pnpm db:generate  # SQL migration from schema changes — commit it with the change
pnpm build        # compile every package, then every app (apps/api → apps/api/dist/)
pnpm typecheck    # tsc --noEmit in every package and app — no build needed first
pnpm start        # run the compiled build
pnpm lint         # oxlint
pnpm fmt          # oxfmt — formats in place
pnpm test         # vitest in every package and app (the db and Stripe are mocked, no Postgres needed)
```

The rate-limit and account-cache tests also run against a real Valkey when one
is given:

```bash
TEST_REDIS_URL=redis://localhost:6380 pnpm --filter @service-finder/api exec vitest run src/shared/rate-limit.test.ts src/shared/account-cache.test.ts
```

## Seeds

Each is idempotent and safe to re-run on every deploy. Run them in this order
the first time — the permissions seed grants everything to the `superadmin`
role that `db:seed` creates, so it has nothing to grant if run first:

```bash
pnpm db:seed              # the initial super admin (bo_users) + superadmin role
pnpm db:seed:permissions  # the bo_permissions catalog + endpoint map, granted to superadmin
pnpm db:seed:billing      # placeholder plans (Starter, Pro, Business) — real Stripe Products/Prices
```

`db:seed:billing` is optional: it creates its plans in whichever Stripe account
`STRIPE_SECRET_KEY` belongs to, through the same services the Plans page uses.
Its `CATALOG` (in `modules/products/products.seed.ts`) is a placeholder, not a
pricing decision — edit it first, or skip it and create plans from the back
office.

**Re-run `pnpm db:seed:permissions` after pulling a change that adds a
permission** — a new key exists only in the seed file until it does, so a role
can't be granted it and `requirePermission` will 403 everyone.

## Back-office auth, in short

1. `POST /auth/google` verifies a Google ID token. It never creates a user —
   only a pre-provisioned `bo_users` row (from the seed, or an invite) can sign
   in; the first sign-in binds that Google account to the row.
2. It answers with a 10-minute flow token: `mfa_setup_required` the first time,
   `mfa_challenge_required` after that.
3. `POST /auth/mfa/setup` + `/auth/mfa/verify-setup`, or `/auth/mfa/challenge`,
   exchange the flow token and a TOTP code for a session: a 15-minute access
   token and a 30-day, single-use refresh token (`POST /auth/refresh` rotates
   it; a reused one is refused).
4. Wrong codes are limited to 5 per account per 15 minutes, across challenge
   tokens (429 `TOO_MANY_ATTEMPTS` with `Retry-After`).

Every `/users` and `/roles` route checks its permission key server-side; the
back office hiding a tab is a convenience, not the enforcement.

## Plans & billing, in short

The back office's Plans page manages three things, each mirrored in Stripe and
each created there first, so a row only exists for something Stripe has:

- **Products** (`billing_products`) — the tiers. `limits` holds app-enforced
  caps (`{"seats": 5}`; a missing key is unlimited), `trialDays` the default
  trial.
- **Prices** (`billing_prices`) — one active price per product and cadence
  (monthly, quarterly, bi-annual, annual), enforced by a partial unique index.
  Stripe Prices are immutable, so changing one means adding a new price: the
  old one is archived here and in Stripe, and existing subscribers keep it.
  `showOnSignup` hides a price from the public catalog without archiving it.
- **Links** (`billing_payment_links`) — a price row's "Copy" gives a reusable
  signup link, `TENANT_APP_URL/join/<token>`; "Create Payment Link" makes
  one-off Stripe Payment Links with trial, seat and discount overrides (a
  discount is a coupon plus a promotion code the buyer enters at checkout).

`plans.view` reads the catalog; `plans.manage` makes every change. Two routes
are public: `GET /billing/products` (the active, self-signup-visible catalog,
for a pricing page) and `GET /billing/signup-links/:token` (what a signup link
sells, for the tenant app's `/join` page).

A Stripe error comes back as a 400 with Stripe's own message when Stripe
judged the request invalid (an amount under its minimum, say), and as a 502
otherwise.

Not here yet: the tenant app's `/join` page and the Checkout Session it
starts, a business's subscription, saved cards and invoices, and the webhook
that keeps them in step with Stripe. Business accounts exist now, so these are
the next step whenever Service Finder decides what it charges businesses for.

## Business app identity, in short

The business app (`service-finder-frontend-tenant`) has an identity system of
its own, apart from the back office's: its own tables, its own refresh tokens,
and its own access tokens (`purpose: "tenant_access"` — a back-office token is
refused by every business route, and the other way round).

- **Sign-up** (`POST /accounts/signup`) creates a business (`accounts`), its
  default roles and its owner in one transaction. By password, by Google (the
  token's verified email must be the work email), or both. 10 an hour per
  device.
- **Sign-in** is by password (`/accounts/login`, rate-limited like iGroom's) or
  Google (`/accounts/google` — an unknown Google identity comes back as
  `no_account`, and the app carries on into sign-up). Two-factor is optional
  here: with it on, both answer `mfa_challenge_required` and
  `/accounts/mfa/challenge` finishes the sign-in.
- **Sessions** are a 15-minute access token and a 30-day, single-use refresh
  token. `POST /accounts/refresh` rotates it with one conditional UPDATE, so
  two racing refreshes can't both win. Changing a password signs out every
  other session.
- **Every 401 the app should refresh on carries `code: "TOKEN_INVALID"`** —
  and only those. A wrong password or 2FA code is a plain 401, so a typo never
  turns into a refresh-and-logout.
- **Team** (`/staff`): invite someone and they get a single-use, 7-day link
  (`TENANT_APP_URL/invite#<token>` — a fragment, so it never reaches a server
  log). Resending or copying a fresh link retires the last one. Deactivating
  someone ends their sessions at once.
- **Roles** (`/staff/roles`): every business starts with Owner (system — every
  permission, can't be renamed, edited or deleted), Manager (`staff.view`,
  `staff.manage`, `roles.view`) and Member (`staff.view`), and can add its own.
  Permissions: `staff.view`, `staff.manage`, `roles.view`, `roles.manage`,
  `business.manage`.
- **Nobody can hand out more than they hold.** Anyone but an owner can only
  create, edit, assign or act on a role whose permissions they have
  themselves; the Owner role and the people holding it are an owner's alone.
  Nobody changes their own role or deactivates themselves, and the last active
  owner can't be moved or deactivated.
- **Per-request lookups are cached** in Valkey for a minute
  (`shared/account-cache.ts`) and dropped by every successful change the
  business makes, so a deactivation or a re-permissioned role applies on the
  very next request. Without Valkey it reads straight from Postgres.

Invite links and emailed codes are printed to the API's console in development
(`[invite:dev]`, `[email:dev]`) when `RESEND_API_KEY` is unset.

Deploying: see [deploy/README.md](deploy/README.md).
