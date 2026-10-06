# Build progress

One section per phase of the backend-integration brief. Each phase ends with all tests green.

## Phase 1 — Foundation ✅

**Exit criterion met:** log in, edit profile and log out work end to end (Playwright, desktop).

Done
- Monorepo: `apps/web` (moved, history kept), `apps/api` (NestJS 11), `packages/shared` (Zod schemas, enums, GST maths, types), `e2e` (Playwright).
- **Deep-link fix:** `vercel.json` rewrites every non-file route to `/index.html` (and `/api/*` to the API host).
- Prisma schema for every model in the brief (+ `counters`, `files`, `photo_comments`, `invoice_payments`, `faq_feedback`), first migration, snake_case columns, paise, soft deletes, indexes.
- Seed: plans, WhatsApp templates, FAQs (idempotent), demo studio mirroring the mock (Golden Hour Studios / Arjun Mehta), platform admin.
- API: error format + filter, Zod pipe, Helmet, CORS allowlist, rate limits, Swagger at `/api/docs`, auth (signup/login/refresh rotation/logout/me/forgot/reset/change password), profile + logo upload (content-sniffed), studio-scoped and public file routes, notifications, global search, plan-limit `UsageService`, credit/wallet ledger.
- Web: TypeScript + strict + ESLint, TanStack Query, API client with silent refresh and "Session expired" redirect, auth screens (Login, Sign up, Forgot/Reset password), protected routes, Logout, Profile (wired, Reset to last saved, Save only when changed and valid, unsaved-changes warning, logo, change password), Topbar (real name/plan/credits, notifications bell with unread count, debounced global search, `/` shortcut), shared Modal/ConfirmDialog/Select/Field/Skeleton/ErrorState/Pagination, Sonner toasts, plan-limit and top-up dialogs, face-recognition flag.

Tests
- shared (Vitest): 28 — validators (phone, email, password, GSTIN/state, PAN, PIN, amounts, dates), GST maths, invoice numbering helpers, website settings.
- API (Jest + Supertest): 17 — signup/login/refresh-reuse/logout/expired token/forgot+reset/change password/profile/GSTIN mismatch/logo sniffing/error format.
- Web (Vitest + Testing Library): 3 — login form errors, blur validation, API field errors mapped to the form.
- E2E (Playwright): 4 — deep link → login → back, inline login errors, profile edit/reset/save + logout, sign up.


## Phase 2 — Core ✅

**Exit criterion met:** both flows pass end to end in Playwright (desktop): new client + event → selection → upload → WhatsApp reminder → client picks with quota lock → submit; album from picks → send for review → client feedback + spread approval → studio resolves.

Done
- API: clients (CRUD, search by name/phone/email), events (CRUD, sequential codes, past-date rule, Starter plan limit → `PLAN_LIMIT`), dashboard aggregate, selections (list with derived EXPIRED, summary, create with family members, uploads with content sniffing + checksum de-dup, send/remind/preview through `MessagingService`, Lightroom CSV/TXT export, quota/deadline edits), public selection (view, picks with a row-locked quota check, comments, submit → read-only), albums (list/summary, create from event photos, reorder pages, status changes, share, resolve feedback), public album (view, per-spread feedback, approvals). Drafts are never public.
- `MessagingService` stand-in: template → text → `wa.me` link; the credit is deducted in the same transaction as the logged message (no negative balances).
- Web: Dashboard (real greeting/plan/credits, next-assignment countdown, stats with month-over-month trends, active campaign banner, recent events, activity feed, booking chart, pipeline, recent albums, New Event modal with async client select + inline "Create new client", Share Gallery modal, WhatsApp preview from a real selection); Photo Selection (URL-synced search/status/sort/page, stats, Remind with confirm, New Selection with family members + multi-file upload, Manage modal: photos/picks/comments, share link, message preview, Lightroom export, quota/deadline, delete); Digital Album (API-counted tabs, search, pagination, Create Album with page ordering, studio flipbook with status/share/feedback actions, "Coming soon" print export); public `/s/:token` and `/a/:token` pages (mobile friendly).

Tests
- API +23 (`core.e2e-spec.ts`): cross-tenant access on clients/events/selections/photos/albums/feedback/search, plan limit, uploads (fake type, duplicate), credit ledger + insufficient credits, quota lock, member/photo validation, export, submit/read-only, derived EXPIRED, album privacy/sharing/feedback/approvals/status counts, dashboard.
- E2E +3 (`phase2-selection-album.spec.ts`).

Fixed along the way
- Pre-existing CSS bug: the Booking Analytics bars rendered 0 px tall (the tooltip wrapper had no height).
- react-select menus inside dialogs were unclickable (portaled outside the dialog); menus now render in place with fixed positioning.
- Empty required text fields said "must be at least N characters"; they now say "… is required".

## Phase 3 — Money ✅

**Exit criterion met:** GST maths (shared unit tests + API) and invoice numbering (API: sequential, concurrent-safe, per financial year incl. the 31 March / 1 April boundary) are tested.

Done
- `PaymentService` interface + `MockPaymentService` (always succeeds, `provider: mock`, "Test mode, no real charge" shown on every purchase).
- Plans from the DB; subscription overview (effective plan, usage from real counts, recent payments); change plan (immediate, new period, included credits granted, All-Access yearly-only); cancel at period end / resume; lapsed cancellations fall back to Starter on read.
- Referral reward: ₹1,500 wallet credit to both studios on the referred studio's first paid plan change — idempotent (conditional status flip + unique wallet transaction keys).
- WhatsApp credits: balance, packs (500 / 2,000 / 5,000) via the mock payment → ledger `PURCHASE`, message log with type/search filters and pagination.
- Invoices: create with CGST+SGST (same state) or IGST (other state) computed by the shared maths, FY numbering `INV-<FY>-<seq>` in the same DB transaction, optional milestones that must equal the total, list tabs All/Pending/Overdue/Paid (OVERDUE derived), summary, detail, record (partial) payments with milestone settlement, mark paid, cancel (unpaid only; number kept), send on WhatsApp, print view with amount in words.
- Web: All Subscriptions (cycle toggle in URL, current plan, confirm), My Subscription (plan card, trial/renewal/cancel states, usage bars, features, payment history), All-Access (DB price, dynamic comparison vs your plan), WhatsApp Credit (balance, packs, confirm + test mode, filterable log), Billing (stats, URL tabs + search + pagination, row actions, Create Invoice with live totals and milestones, invoice detail, record payment, print page `/invoices/:id/print`).

Tests
- Shared +1 (amount in words). API +19 (`money.e2e-spec.ts`). Web +4 (`CreateInvoiceModal.test.tsx`: intra/inter totals, every validation error, milestone mismatch). E2E +3 (`phase3-money.spec.ts`).

## Phase 4 — Rest ✅

**Exit criterion met:** no in-scope screen reads mock data. `src/data.js` and the mock JSON are deleted; the web app has no `.js`/`.jsx` left (`allowJs` off). Studio-specific numbers in shared tooltip copy were removed or replaced with live values.

Done
- Refer & Earn: code, invite link (`/signup?ref=CODE` pre-fills sign up), copy with toasts, WhatsApp share link (no credits — it goes to whoever the studio picks), wallet balance, total earned, referred studios with status, wallet history.
- My Website: sections toggle + reorder (auto-saved with a toast, optimistic), Edit Design (theme/colour/font selects, tagline, custom domain format check + uniqueness, SEO title/description counters, YouTube/Vimeo validation), Live Preview renders the real site scaled down and updates while typing, enquiries list. Public site `/w/:slug` (hero banner + CTA, published albums, about, film, enquiry form with honeypot) → Lead + notification; visits counted.
- Gallery Banner: upload with type/size checks and preview, title, CTA text/URL, start/end dates, active toggle, reorder, edit, delete with confirm; status (Active/Scheduled/Expired/Draft) derived from dates.
- Help Center: FAQs from the DB grouped by category, debounced search in the URL, topic filters, "Was this helpful?" (one vote per user, counters adjusted on change).
- Support Tickets: new ticket (subject counter, category/priority selects, description, optional image/PDF attachment), list with status tabs/search/pagination, thread with replies (+ attachments), resolve/reopen; replying to a resolved ticket reopens it. SUPER_ADMIN API: list/reply/status for all tickets (studio gets a notification), FAQ CRUD, plan editing.
- Notifications (bell + activity) now include leads, ticket replies, referral rewards, plan changes and credit purchases.

Tests
- API +11 (`business.e2e-spec.ts`), E2E +5 (`phase4-business.spec.ts`).

## Phase 6 — Admin subscriptions & plan-deadline alerts ✅

Done
- Migration `20261002150000_subscription_alerts`: subscription status lifecycle (TRIAL…PAYMENT_FAILED), grace/auto-renew/amount/GST/gateway fields, `subscription_events`, payment invoice numbers and periods, notification recipient/channel/dedupe key, platform settings/counters, webhook events, coupons, admin TOTP. Existing payments backfilled.
- Signed, idempotent payment webhook; checkout → webhook → subscription + GST invoice + instant admin alert (in-app + email) + studio confirmation.
- Hourly IST job: T-7/3/1 reminders, GRACE, EXPIRED (read-only), auto-renew, win-back coupons, 80% usage alerts, daily digest; exactly-once via dedupe keys.
- Admin: dashboard with charts, subscriptions table (tabs, filters, search, server-side paging, CSV, row actions), detail page (countdown, usage, timeline, payments, alerts sent), alerts feed + bell, settings, optional 2FA, rate limits.
- Studio: `/me/subscription`, plan banner (dashboard, My Subscription; urgent states on every page), grace warning, read-only mode, cancel with reason, auto-renew toggle, one-click renew links, plan invoices.

Tests
- Shared +28 (deadline maths: monthly, yearly, month-end, leap years, IST boundaries; status changes; reminder stages; dedupe).
- API +25 (`subscriptions.e2e-spec.ts`): webhook signature/idempotency, activation + alerts, 403 for non-admins, T-7/3/1/T/grace-end with no duplicates on re-runs, ACTIVE → GRACE → EXPIRED, read-only, admin extend/change/cancel/remind logged, failed payment, auto-renew, win-back, digest, usage alert, stats, CSV, settings, 2FA.
- E2E +2 (`phase6-subscriptions.spec.ts`).
