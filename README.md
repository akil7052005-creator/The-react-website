# Weddyzone Studio

Studio management for wedding photographers in India: events and clients, private photo-selection galleries, 3D flipbook albums, GST invoices, WhatsApp messaging, plans and credits, a public portfolio website, gallery banners, help and support.

```
apps/web         React 19 + Vite SPA (TypeScript, TanStack Query, React Hook Form + Zod)
apps/api         NestJS 11 REST API under /api/v1 (Prisma 6 + PostgreSQL), Swagger at /api/docs
packages/shared  Zod schemas, enums, GST maths and API types used by both apps
e2e              Playwright end-to-end tests (desktop + 390 px mobile)
```

See [DECISIONS.md](DECISIONS.md) for design choices, [PROGRESS.md](PROGRESS.md) for what each phase delivered and [QA.md](QA.md) for the manual QA checklist.

## Requirements

- Node.js 20+ (tested with 24)
- pnpm 10 — via Corepack: `corepack enable` (or prefix commands with `corepack pnpm`)
- PostgreSQL 14+ (tested with 18)

## Setup

```bash
corepack pnpm install

# Environment
cp apps/api/.env.example apps/api/.env     # then edit DATABASE_URL, JWT secrets, APP_URL, CORS_ORIGINS
cp apps/web/.env.example apps/web/.env

# Database: create tables and load plans, templates, FAQs + the demo studio
corepack pnpm db:migrate         # prisma migrate dev
corepack pnpm db:seed            # development only: also creates demo login accounts
```

### Local PostgreSQL without a password (optional)

If you have PostgreSQL installed but not its password, `scripts/local-db.mjs` runs a private cluster for this project on port **5433** (trust auth for user `weddyzone`, data in `%LOCALAPPDATA%\weddyzone\pgdata` or `~/.weddyzone/pgdata`). It matches the defaults in `.env.example`.

```bash
corepack pnpm db:local:init      # once
corepack pnpm db:local:start     # creates weddyzone, weddyzone_test and weddyzone_e2e
corepack pnpm db:local:stop
```

Set `PG_BIN` if PostgreSQL's `bin` folder is not `C:\Program Files\PostgreSQL\18\bin` or on your PATH.

## Run

```bash
corepack pnpm dev
```

- Web: http://localhost:5173 (Vite proxies `/api` to the API)
- API: http://localhost:4000/api/v1 — Swagger: http://localhost:4000/api/docs

Demo logins (created by the seed; set `SEED_DEMO=false` in production):

| | Email | Password |
|---|---|---|
| Studio owner (Arjun Mehta, Golden Hour Studios) | `hello@goldenhour.studio` | `Golden@2026` |
| Platform admin (API only) | `admin@weddyzone.app` | `Admin@2026` |

Password-reset emails are printed in the API console unless `SMTP_HOST` is set.

Public client pages (no login): `/s/<token>` selection, `/a/<token>` album, `/w/<studio-slug>` studio website (e.g. `/w/golden-hour`).

## Test

```bash
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e
```

- `test` runs the shared unit tests (Vitest), the API integration tests (Jest + Supertest against `TEST_DATABASE_URL`, truncated before each file) and the web tests (Vitest + Testing Library).
- `e2e` builds the API, starts it on port 4100 and Vite on 5174, resets and seeds `E2E_DATABASE_URL` (`prisma migrate reset`), then runs Playwright at desktop and 390 px mobile widths. First time only: `corepack pnpm --filter @weddyzone/e2e e2e:install` to download Chromium.

The e2e database is wiped on every run — never point `E2E_DATABASE_URL` or `TEST_DATABASE_URL` at real data.

## Subscriptions & plan-deadline alerts

Platform admins (SUPER_ADMIN) get `/admin` (dashboard: MRR/ARR, plan split, MRR trend, new vs churned), `/admin/subscriptions` (filterable table, CSV, extend / change plan / cancel / remind), `/admin/subscriptions/:id`, `/admin/alerts` (bell feed) and `/admin/settings` (reminder days, grace days, digest time, win-back coupon, optional two-factor sign-in). Every `/api/v1/admin/*` call returns 403 to anyone else and is written to `admin_audit_log`.

- **Plans activate only from a confirmed payment**: checkout opens a gateway order; `POST /api/v1/webhooks/payments` (HMAC-SHA256 with `PAYMENT_WEBHOOK_SECRET`, Razorpay format, idempotent) creates/renews the subscription, issues a sequential GST invoice (`WZ/2026-27/00001`) and alerts the studio and admins. In test mode the mock gateway confirms through the same handler.
- **Hourly job** (`JOBS_ENABLED`, all dates in IST): T-7 (in-app + email + WhatsApp), T-3 (in-app + WhatsApp), T-1 (all + admin), deadline → GRACE (+ admin), grace end → EXPIRED (read-only, + admin), win-back coupon, 80% usage alerts, 09:00 IST admin digest. Every alert has a unique dedupe key, so re-runs never send twice. Run it on demand: `POST /api/v1/admin/jobs/subscription-alerts/run`.
- **Expired = read-only**: no new events, albums or photo uploads; clients still open delivered albums and selections; nothing is deleted.
- Platform WhatsApp alerts use the `PLAN_*` templates and the WhatsApp Cloud API (`WHATSAPP_CLOUD_TOKEN`), never the studio's credits.

## Feature flags

`FEATURE_FACE_RECOGNITION=false` (in `apps/web/.env` and `apps/api/.env`) hides AI Face Recognition: its nav item, dashboard card, feature chip, scanner button and route. The code is kept for later.

## Stand-ins for paid services

Everything that would need a third party sits behind an interface with a simple v1 implementation, so the real service can be plugged in later:

| Interface | v1 implementation | Later |
|---|---|---|
| `StorageService` | `S3StorageService` (Cloudflare R2 / AWS S3) when `S3_BUCKET` is set; otherwise `LocalStorageService` — files on disk under `UPLOAD_DIR` (development) | — |
| `PaymentService` | `MockPaymentService` — always succeeds, "Test mode, no real charge" | Razorpay |
| `MessagingService` | `WaMeMessagingService` — builds the message and returns a `https://wa.me/…` link; credits are deducted and the message logged | WhatsApp Business API |
| Mail | Resend when `RESEND_API_KEY` is set, SMTP when `SMTP_HOST` is set, otherwise a console log (development) | — |

## Deploy

### API + PostgreSQL (Railway or Render; Neon also works for Postgres)

1. Create a PostgreSQL database and copy its connection string.
2. Create a service from this repo with root directory `/`:
   - Build: `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @weddyzone/shared build && pnpm --filter @weddyzone/api build` (`--prod=false` keeps the build tools — Prisma CLI, Nest CLI, TypeScript, tsx — which are dev dependencies and would otherwise be skipped when `NODE_ENV=production`)
   - Start: `pnpm --filter @weddyzone/api start:prod` (runs `prisma migrate deploy`, the reference-data seed below, then the API)
3. Environment: everything in `apps/api/.env.example`, with
   - `NODE_ENV=production`, strong random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
   - `APP_URL=https://weddyzone.vercel.app`, `CORS_ORIGINS=https://weddyzone.vercel.app`
   - `COOKIE_SECURE=true`
   - `RESEND_API_KEY` and `MAIL_FROM` (a sender on your Resend-verified domain) so password-reset emails are delivered
   - `TRUST_PROXY_HOPS=2` when Vercel forwards `/api` to the API host (rate limits then see each user's real IP)
   - The API refuses to start in production with development values (localhost URLs, example JWT secrets, no email provider)
   - `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` for a **private** Cloudflare R2 or AWS S3 bucket. Required in production: the host's disk is wiped on redeploy.
4. Reference data (plans, WhatsApp templates and FAQs) is seeded by `start:prod` on every start, so sign-up works on a fresh database ("Plan not found" means it hasn't run). By hand: `pnpm --filter @weddyzone/api db:seed:prod`. It never creates accounts, never changes existing plans, and is safe to re-run. Never run plain `db:seed` against production: it creates demo logins whose passwords are in this repo (it now refuses to when `NODE_ENV=production`).
5. Create your platform admin (signs in at `/login`, lands in `/admin`): `pnpm --filter @weddyzone/api admin:create -- --email you@yourdomain.com --name "Your Name"`. It prints a random password once; store it in a password manager. Forgot it? Run it again with `--reset-password` (this also signs that admin out everywhere). Admin sessions end after `ADMIN_SESSION_HOURS` (default 8) without activity, and every admin action is recorded in the `admin_audit_log` table.

### Web (Vercel)

1. Import the repo (root directory `/`). `vercel.json` sets the install/build commands and output directory.
2. **Edit `vercel.json`: replace `REPLACE_WITH_API_HOST` with your API's host** (e.g. `weddyzone-api.up.railway.app`). Vercel then serves `/api/*` from the API, so the browser sees a single site and the auth cookies stay first-party (`SameSite=Lax`).
3. Every other path is rewritten to `/index.html`, so deep links like `/billing` load directly.

If you'd rather call the API on its own domain, set `VITE_API_URL` on Vercel and `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` on the API.
