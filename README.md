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
corepack pnpm db:seed
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

## Feature flags

`FEATURE_FACE_RECOGNITION=false` (in `apps/web/.env` and `apps/api/.env`) hides AI Face Recognition: its nav item, dashboard card, feature chip, scanner button and route. The code is kept for later.

## Stand-ins for paid services

Everything that would need a third party sits behind an interface with a simple v1 implementation, so the real service can be plugged in later:

| Interface | v1 implementation | Later |
|---|---|---|
| `StorageService` | `LocalStorageService` — files on disk under `UPLOAD_DIR` | S3 / R2 |
| `PaymentService` | `MockPaymentService` — always succeeds, "Test mode, no real charge" | Razorpay |
| `MessagingService` | `WaMeMessagingService` — builds the message and returns a `https://wa.me/…` link; credits are deducted and the message logged | WhatsApp Business API |
| Mail | Console log, or SMTP via nodemailer when `SMTP_HOST` is set | Any SMTP provider |

## Deploy

### API + PostgreSQL (Railway or Render; Neon also works for Postgres)

1. Create a PostgreSQL database and copy its connection string.
2. Create a service from this repo with root directory `/`:
   - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @weddyzone/shared build && pnpm --filter @weddyzone/api build`
   - Start: `pnpm --filter @weddyzone/api start:prod` (runs `prisma migrate deploy`, then the API)
3. Environment: everything in `apps/api/.env.example`, with
   - `NODE_ENV=production`, strong random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
   - `APP_URL=https://weddyzone.vercel.app`, `CORS_ORIGINS=https://weddyzone.vercel.app`
   - `COOKIE_SECURE=true`
   - `RESEND_API_KEY` and `MAIL_FROM` (a sender on your Resend-verified domain) so password-reset emails are delivered
   - `TRUST_PROXY_HOPS=2` when Vercel forwards `/api` to the API host (rate limits then see each user's real IP)
   - The API refuses to start in production with development values (localhost URLs, example JWT secrets, no email provider)
   - `UPLOAD_DIR` on a **persistent volume** (Railway volume / Render disk) — local-disk storage is lost on redeploy otherwise
4. Seed reference data once: `SEED_DEMO=false pnpm --filter @weddyzone/api db:seed`.

### Web (Vercel)

1. Import the repo (root directory `/`). `vercel.json` sets the install/build commands and output directory.
2. **Edit `vercel.json`: replace `REPLACE_WITH_API_HOST` with your API's host** (e.g. `weddyzone-api.up.railway.app`). Vercel then serves `/api/*` from the API, so the browser sees a single site and the auth cookies stay first-party (`SameSite=Lax`).
3. Every other path is rewritten to `/index.html`, so deep links like `/billing` load directly.

If you'd rather call the API on its own domain, set `VITE_API_URL` on Vercel and `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` on the API.
