# QA checklist

Manual pass over every in-scope screen at **desktop (1366 px)** and **mobile (390 px)**, run against the seeded demo studio (`hello@goldenhour.studio` / `Golden@2026`). Automated coverage is noted next to each item: **API** = Jest integration tests, **Web** = Vitest form tests, **E2E** = Playwright (desktop + mobile).

Legend: ✅ checked and passing · 🤖 covered by automated tests · ⚠️ known limitation (see DECISIONS.md)

## Global

- ✅🤖 Deep links (`/billing`, `/profile`, …) load directly; logged-out visitors go to `/login?next=…` and return after login (E2E). `vercel.json` rewrites all non-file paths to `index.html`.
- ✅🤖 Every non-public API route returns 401 without a session (API: route sweep).
- ✅🤖 Silent token refresh; a replayed refresh token revokes all sessions; failed refresh → "Session expired, please log in again" + redirect (API + client).
- ✅ Toasts on every create/update/delete; API error message toasted; API `fields` errors mapped onto inputs (Web).
- ✅ Confirm dialogs before delete, cancel, publish, submit, send, mark paid (named item in the message).
- ✅ Skeletons while loading, empty states with a call to action, error states with Retry.
- ✅ Unsaved-changes warning on the Profile and Support forms (route change + tab close) and on every dialog form (close).
- ✅ Filters, tabs, search and page are in the URL on Photo Selection, Digital Album, Billing, WhatsApp Credit, Help, Support, Subscriptions (cycle).
- ✅🤖 Plan limit → upgrade dialog (`PLAN_LIMIT`, API); insufficient credits → top-up dialog.
- ✅ Feature-highlight chips and tooltips keep their popovers; marketing copy unchanged.
- ✅🤖 `FEATURE_FACE_RECOGNITION=false` hides the nav item, dashboard AI Face tile, "AI Face Match" chip, "Try AI Face Scanner" and the `/face-recognition` route.
- ✅🤖 Security headers (Helmet), CORS allowlist, JSON/multipart-only mutations, rate limits on auth and public routes (API).
- ✅🤖 Tenant isolation: studio B gets 404 on every studio A record and sees nothing of A in lists, search or dashboard (API).
- ✅ Mobile: sidebar slides in from the menu button; dialogs fit 390 px; tables scroll horizontally; public pages use 2-column grids.

## Auth
- ✅🤖 Sign up (field errors, duplicate email, referral code, Starter trial + 50 credits) — API + E2E.
- ✅🤖 Login inline errors; wrong password; show/hide password — Web + E2E.
- ✅🤖 Forgot password (always "check your email"), reset link once, expired link message — API.
- ✅🤖 Logout clears the session — E2E.

## Dashboard
- ✅ Real greeting, date, plan badge, credit pill; notifications bell with unread count and "Mark all read".
- ✅ Global search (debounced, `/` shortcut, keyboard navigation) across clients, events, albums, invoices; results open the item.
- ✅ Next Assignment = soonest upcoming event with a days-left countdown.
- ✅ Stats with month-over-month trend, booking chart (bars now render — pre-existing CSS bug fixed), pipeline, activity feed, recent events and albums, active campaign banner.
- ✅🤖 New Event: client select (async) with inline "Create new client", type/city selects, past-date validation — E2E.
- ✅ Share Gallery: pick album or selection → copy link or WhatsApp (1 credit, confirm).

## Photo Selection
- ✅🤖 New Selection (event select, quota, deadline, family members) → multi-file upload with per-file progress, per-file errors (type/size), duplicate check by checksum — API + E2E.
- ✅🤖 List with status, picked/quota progress, search, status filter, sort, pagination.
- ✅🤖 Remind / send link → confirm → WhatsApp opens, credit deducted, message logged — E2E.
- ✅ Preview Client Message shows the real reminder text.
- ✅🤖 Lightroom export: TXT filename list + CSV with who picked and comments — API.
- ✅🤖 Public `/s/:token`: member picker, hearts, lightbox with comments, quota lock message, submit with confirm → read-only; expired deadline → read-only — API + E2E.

## Digital Album
- ✅🤖 Tabs All/Published/In Review/Draft with API counts; search; pagination.
- ✅🤖 Create Album (event, title/subtitle/location, pick photos in order, reorder) — E2E.
- ✅🤖 Status changes with confirm; sharing a draft moves it to In Review — API + E2E.
- ✅🤖 Public flipbook `/a/:token`: real pages, per-spread feedback, spread approval; drafts are 404 — API + E2E.
- ✅ Studio resolves feedback from the flipbook; "Lab Print-Ready Export" shows "Coming soon".

## Subscriptions
- ✅🤖 Plans from DB, monthly/yearly toggle, current plan "Active"; upgrade via confirm with "Test mode, no real charge" — E2E.
- ✅🤖 My Subscription: plan, renewal/trial/cancel states, usage bars from real counts, features, payment history; cancel + resume — API + E2E.
- ✅ All-Access: DB price, "Saves ₹21,989" computed, comparison table from real limits.

## Refer & Earn
- ✅🤖 Code, invite link (pre-fills sign-up), copy toasts, WhatsApp share, referred studios, wallet history — E2E.
- ✅🤖 ₹1,500 to both studios on first upgrade, exactly once — API.

## WhatsApp Credit
- ✅🤖 Balance from ledger; packs 500/2,000/5,000 via mock payment with confirm — API + E2E.
- ✅🤖 Message log with type filter, search, pagination — API.
- ✅🤖 Sends blocked with "Top up" dialog when credits run out — API.

## Billing
- ✅🤖 Create Invoice: client/event selects, dates, place of supply, line items (SAC default 998386, qty, rate, GST 0/5/12/18/28), add/remove rows, live totals with CGST+SGST vs IGST, milestones must equal the total — Web + E2E.
- ✅🤖 Sequential FY numbering in a transaction, concurrent-safe — API.
- ✅🤖 Tabs All/Pending/Overdue/Paid (overdue derived), search; view/print, WhatsApp, record payment, mark paid, cancel — API + E2E.
- ✅ Print view: GSTINs, tax split, amount in words, milestones, payments; Save as PDF.

## My Website
- ✅🤖 Section toggles + order save with a toast; Live Preview updates instantly — E2E.
- ✅🤖 Theme/colour/font; custom domain format + uniqueness; SEO counters; YouTube/Vimeo validation — API + E2E.
- ✅🤖 Public `/w/:slug` lead form (honeypot, rate limit) → Lead + notification; visits counted — API + E2E.

## Gallery Banner
- ✅🤖 Upload with type/size validation and preview; title, CTA text + URL, dates, active toggle; reorder (optimistic); edit; delete with confirm — API + E2E.

## My Profile
- ✅🤖 GET/PATCH; Reset restores last saved; Save enabled only when changed and valid; GSTIN/state/PAN checks; logo upload; change password — API + E2E.

## Help Center
- ✅🤖 FAQs by category, debounced search, topic filters, "Was this helpful?" (one vote per user) — API + E2E.

## Support Tickets
- ✅🤖 New ticket (subject counter, category/priority, description, optional attachment), status tabs, search, thread with replies, resolve/reopen; admin reply notifies the studio — API + E2E.

## Known limitations (v1)
- ⚠️ Payments are simulated (`MockPaymentService`); wallet balance is shown but not yet spendable at checkout.
- ⚠️ WhatsApp messages open on the studio's phone via `wa.me` links; there is no delivery/read status.
- ⚠️ Uploads are stored on the API server's disk — use a persistent volume in production.
- ⚠️ Invoices can't be edited (cancel and recreate); no credit notes.
- ⚠️ SUPER_ADMIN features are API-only (Swagger).
- ⚠️ Some approved marketing copy promises more than v1 (e.g. "Official Meta API") — flagged for product review in DECISIONS.md.
