# Decisions

Choices made where the build brief was ambiguous or where the environment forced a trade-off. Newest at the bottom of each section.

## Tooling

| Decision | Why |
| --- | --- |
| **pnpm 10 via Corepack** (`packageManager` field), not a global install | Reproducible version; Vercel and Railway honour the field. Run commands as `corepack pnpm …` if `pnpm` is not on PATH. |
| **Prisma 6.19** (not 7/8) | Prisma 8 is still an RC and 7 requires driver adapters and a config file; 6.19 is the latest mature line with the classic client. |
| **TypeScript 5.9** (not 7) | The NestJS/ts-jest/typescript-eslint toolchain supports `<6.1`. |
| **NestJS 11** (not 12) | Latest line with a long track record; 12 is days old. |
| **Shared package consumed two ways** | The web app imports `packages/shared/src` directly through a Vite alias (no build step); the API uses the compiled CommonJS output in `packages/shared/dist`. Jest maps to the source. |
| **Validation documented in Swagger from the same Zod schemas** | `z.toJSONSchema()` feeds `@ApiBody`, so the docs cannot drift from validation. |
| **Local dev database** is a private cluster on port **5433** (`scripts/local-db.mjs`) | The machine's existing PostgreSQL 18 service (5432) has credentials we don't have; a separate trust-auth cluster under `%LOCALAPPDATA%\weddyzone` keeps dev/test data isolated and out of OneDrive. Any `DATABASE_URL` works. |
| **Three databases**: `weddyzone` (dev, seeded), `weddyzone_test` (Jest; truncated per test file), `weddyzone_e2e` (Playwright; `prisma migrate reset` + seed per run) | Tests never touch dev data. |

## API

| Decision | Why |
| --- | --- |
| **Requests carry rupees, responses carry paise** | Forms validate rupee inputs (> 0, ≤ 2 decimals) with the shared schema; the API converts with `toPaise()`. Response money fields end in `Paise` so the unit is never ambiguous. Storage is always integer paise. |
| **Errors**: `{ error: { code, message, fields?, details? } }` | `details` is an optional extension used by `PLAN_LIMIT` (resource/limit/used) and `INSUFFICIENT_CREDITS` (needed/balance) so the UI can render the upgrade/top-up dialog. |
| **Auth cookies**: `wz_at` (JWT, 15 min, path `/`) and `wz_rt` (JWT, 30 days, path `/api/v1/auth`) | Refresh tokens are JWTs whose SHA-256 hash is stored; every refresh rotates, and replaying a rotated token revokes all of the user's sessions. |
| **Same-site deployment** | `vercel.json` rewrites `/api/*` to the API host, so the browser sees one origin and cookies are `SameSite=Lax`. For a cross-site setup set `COOKIE_SAMESITE=none` (forces `Secure`) and `VITE_API_URL`. |
| **CSRF**: SameSite=Lax cookies + CORS allowlist + JSON/multipart-only mutations | Cross-site forms can't send cookies (Lax) and can't send JSON without a preflight that the allowlist rejects. |
| **bcryptjs** (pure JS bcrypt) | No native build step on Windows/CI; cost 10. |
| **Password reset** tokens: random 32 bytes, stored hashed, 1 hour, single use; revokes all sessions on use | `forgot-password` always returns 200 so emails can't be enumerated. |
| **New studios start on a 30-day Starter trial with 50 bonus WhatsApp credits** | Lets a new studio try messaging immediately; the "first upgrade" for referrals is the first paid plan change. |
| **Per-studio human codes** come from a `counters` table (atomic upsert-increment) | `EVT-1049`, `SEL-312`, `ALB-89`, `TKT-513`, `INV-2026-0035`. Invoice keys are per financial year (`INV-<FY start year>`). |
| **File type checked by magic bytes** (JPEG/PNG/WebP; PDF for ticket attachments) | Extension and client MIME type are ignored. Multer keeps the upload in memory (one file per request) so nothing unvalidated touches disk. |
| **Studio files** are served at `/api/v1/files/:id` (auth, studio-scoped); logos and banners at `/api/v1/public/files/:id`; photos only via their selection/album public token | Photos are never public by id. |
| **Profile email is the studio's business email**, not the login email | Changing the login email needs re-verification, which is out of scope for v1. |
| **Global rate limit 600 req/min/IP**; auth 10/min; public pages 120/min | Configurable by env. |

## Web

| Decision | Why |
| --- | --- |
| **Feature flag name** is exactly `FEATURE_FACE_RECOGNITION` | Vite is configured with `envPrefix: ['VITE_', 'FEATURE_']`. The face-recognition page/component files are kept; routes, nav item, dashboard card, chip and scanner button are hidden when the flag is off. |
| **Pages are converted to TypeScript as they are wired** | During the migration `allowJs` is on; it will be switched off once no `.jsx` remains. |
| **New UI pieces reuse the existing tokens** (`additions.css`) | Modals, confirm dialogs, skeletons, field errors, counters, selects, pagination and auth screens use the same colours, radii, shadows and fonts. |
| **Auth forms use `method="post"`** | If JavaScript hasn't started yet, a submit can never put the password in the URL. |
| **Profile form**: added State, PAN, address and PIN code fields | State is required to pick CGST+SGST vs IGST and to validate the GSTIN prefix. |
| **Global search** results link to the list page with an id in the query string | e.g. `/billing?invoice=<id>` opens that invoice. |
| **`.btn-lg` has no style of its own** | It appeared in the original markup without CSS; adding one would change approved buttons. |
| **Marketing copy kept verbatim** | Feature ribbons, tooltips and the WhatsApp preview's side panel keep the approved wording even where it describes more than v1 does (e.g. "Official Verified Meta API", "98% read rate"). Only text that showed mock numbers or the hidden face feature changed. **Product owner: please review these claims before launch** — v1 sends through the studio's own WhatsApp via `wa.me` links. |
| **"Next Assignment" crew/kit chips** show the event's client, type and status | The brief's schema has no crew or kit data; the chips keep their look with real event data. |
| **App Store / Google Play buttons** stay as approved but do nothing | There is no mobile app yet. |
| **WhatsApp opens in a blank tab that then navigates to `wa.me`** | Opening synchronously inside the click avoids popup blockers; the API call (credit + log) happens in between. |
| **Open dialogs live in the URL** (`?selection=`, `?album=`, `?new=1`, `?create=1`, `?event=`) | Deep links from search and notifications open the right item; a refresh keeps it open. |
| **Select menus render in place with fixed positioning** (not portaled) | A menu portaled outside a Radix dialog can't be clicked; dialogs are centred without transforms so fixed menus line up. |

## Selections & albums

| Decision | Why |
| --- | --- |
| **Status flow**: DRAFT (created) → SENT (link sent or copied) → IN_PROGRESS (first heart) → SUBMITTED; **EXPIRED** is derived when the deadline passes unsubmitted | No background job needed. "Awaiting Selection" is the label for SENT. |
| **Quota counts distinct photos** picked by any family member | A photo hearted by both bride and mum uses one slot. The check runs in a transaction holding a row lock on the selection, so simultaneous picks can't exceed it. |
| **A selection always has at least one member** (defaults to the client's name) | Picks are per member, so everyone can see who picked what. |
| **Photos belong to an event** (and optionally a selection); albums are built from an event's photos, client picks first | One upload path; albums reuse selection uploads. |
| **One photo per album page; a spread is two pages** | Fits the existing flipbook; captions are optional per page. |
| **Sharing a draft album moves it to In Review** (after a confirm) | Drafts are private; clients can only open In Review / Published albums. |
| **Lightroom export** = TXT (comma-separated filename stems for a Lightroom "Filename contains" filter) + CSV (filename, who picked it, comments) | The brief's CSV/TXT stand-in for XML sync. |
| **Event status moves automatically**: Upcoming → Awaiting Selection (selection created) → In Progress (client submits) | Keeps dashboard pills meaningful without extra clicks. |

## Money

| Decision | Why |
| --- | --- |
| **Plan changes apply immediately with a fresh billing period; no proration** | Simplest correct behaviour with a mock payment. Razorpay can add proration later behind `PaymentService`. |
| **Plan prices exclude GST** (as the approved UI says); the mock charge is the list price | No real money moves in v1. |
| **Downgrades are allowed even if current usage exceeds the new limits** | Limits apply to new creations only; nothing is deleted. |
| **Cancelling keeps the plan until the period ends**, then Starter applies (derived on read) | No background job. A free trial can't be cancelled (it just ends). |
| **Included credits** (Studio 1,000 per payment, All-Access 10,000 per year) are granted on each plan payment | Matches the plan copy. |
| **Referral "first upgrade"** = the referred studio's first paid plan change; both studios get ₹1,500 wallet credit | The brief's rule. Wallet spending (renewals, packs) is not wired yet — the balance and history are shown. |
| **Invoice numbers**: `INV-<FY start year>-<4-digit seq>`, per studio, per April–March year, allocated in the same transaction as the insert | Gap-free and duplicate-free under concurrency (counter row lock). Cancelled invoices keep their number. |
| **GST is computed per line and rounded to the paisa per component** (CGST and SGST each at half the rate) | Matches common Indian invoicing; the web form and the API run the same function. |
| **The studio's state is required before invoicing**; no state ⇒ the API refuses with a message pointing to My Profile | CGST/SGST vs IGST can't be decided otherwise. |
| **Invoices can't be edited** — cancel (if unpaid) and create a new one | Keeps the GST series auditable; editing is out of scope for v1. |
| **Partial payments** are supported; milestones are marked paid in order as payments cover them; overpayment is rejected | "Record payment" in the brief. |
| **"PDF"** = print view + browser Save as PDF | The brief's stand-in; no server-side PDF library. |

## Website, banners, help, support

| Decision | Why |
| --- | --- |
| **Public studio website lives at `/w/<studio-slug>`** | The brief needs a public lead form; custom domains are stored and format-checked only (no DNS automation in v1). |
| **Live Preview renders the real site component scaled to 50%** | What the studio sees is exactly what visitors get. |
| **Website sections save immediately** (each toggle/reorder); design settings save from the Edit Design dialog | The brief asks for "toggles and order saved with a toast". |
| **"Client reviews" and "Blog" sections** show "Coming soon" in the preview and are hidden on the public site | There is no reviews/blog data in the brief. |
| **Lead form spam protection**: hidden honeypot field + public rate limit | No CAPTCHA service (no third parties). |
| **Visits are counted by the public page calling `/visit`** | The studio's own preview doesn't inflate numbers. |
| **Banner "status" is derived** (Draft = off, Scheduled = starts later, Expired = ended, Active) | No scheduler needed. |
| **Referral sharing on WhatsApp is free** (a plain `wa.me/?text=` link) | It goes to contacts/groups the studio chooses, not a client, so no credits are charged or logged. |
| **Support attachments**: one image or PDF ≤ 10 MB per message; they count towards storage | Content-sniffed like every upload. |
| **SUPER_ADMIN has API endpoints only** (Swagger) — no admin UI in v1 | The brief asks for "simple SUPER_ADMIN endpoints". |
| **Face-recognition sample data** moved to `src/data/faceDemo.ts` next to the hidden screen | The feature is out of scope and flagged off; the screen keeps working as a demo if the flag is turned on. |
| **Studio-specific numbers removed from shared tooltip copy** (e.g. "1,840 credits available") | They were mock data; the sidebar/top bar now fill credits, plan, wallet and studio name from the live studio. |

## Seed data

| Decision | Why |
| --- | --- |
| **Dates are relative to the day the seed runs** | The next assignment is always 4 days away, one invoice is always overdue, selections have live deadlines. |
| **Placeholder photos are generated gradients** (tiny PNG encoder, no dependencies) | The repo has no real wedding photos; the campaign poster is used for the active banner. |
| **Smaller photo counts than the mock** (20–36 per selection instead of 320–1,240) | Keeps the seed fast and the repo light; names, statuses, codes and relationships mirror the mock. |
| **Face-recognition mock content** (face events, "Face AI" ticket/activity/messages) is not seeded | Out of scope for v1. |
| **Demo login**: `hello@goldenhour.studio` / `Golden@2026`; admin `admin@weddyzone.app` / `Admin@2026` | Printed by the seed; change or remove in production with `SEED_DEMO=false`. |

## Subscriptions & alerts

| Decision | Why |
| --- | --- |
| **Extended the existing Subscription/Payment/Notification models** instead of new ones | `cycle` = billing cycle, `currentPeriodStart/End` = start date / deadline. Added grace, auto-renew, amounts, gateway ids, invoice numbers, recipient/channel/dedupe key. |
| **Status is computed, then stored** (`computeStatus` in `@weddyzone/shared`) | Reads (access checks, admin lists) recompute from the dates, so a studio is never locked out or let in because the hourly job hasn't run yet. The job saves it for filtering and sends the alerts. |
| **All calendar maths in IST**, stored in UTC; months clamp to the month's last day and return to the anchor day (31 Jan → 28 Feb → 31 Mar) | "Days left" counts IST calendar days, so a reminder never fires twice or is skipped around midnight. |
| **After downtime only the most urgent reminder is sent** (T-3 at 2 days left, not T-7 too) | No burst of stale messages. Exactly-once comes from the unique dedupe key, not timing. |
| **Studio cancellation = cancel at period end; then CANCELLED (read-only), no grace** | Replaces the old "fall back to Starter" behaviour: the brief makes ended plans read-only. Admin cancel is immediate. |
| **Plan prices exclude GST; checkout charges 18% on top** | As the pricing pages say. Pro yearly = ₹24,990 + ₹4,498.20 = ₹29,488.20. |
| **Renewing the same plan early continues from the current deadline** | Paying a week early loses no days. Changing plan starts a fresh period from now (no proration, as before). |
| **Admin alerts are one shared feed** (no per-admin read state) | Small team; any admin clearing an alert clears it for all. |
| **Webhook path is `/api/v1/webhooks/payments`, admin API under `/api/v1/admin/*`** | Same `/api/v1` prefix as every other route. |
| **Auto-renew without a gateway mandate doesn't suppress reminders** | Only a gateway subscription can actually charge; in test mode the job simulates the renewal webhook at the deadline. |
| **Two-factor sign-in is optional TOTP** (no new dependency), secrets AES-GCM encrypted | Works with any authenticator app. |
| **No WhatsApp provider ⇒ WhatsApp alerts are not attempted** (no row, no "Failed") | Until `WHATSAPP_CLOUD_TOKEN` is set they could never be delivered. "Send reminder now" reports WhatsApp as "Skipped – not configured" and the dialog disables it. Older rows recorded before this show as skipped too. Once configured, the next job run sends WhatsApp for the stage due then. |
| **Every paid plan payment has a GST invoice number** | Migration `20261003090000_backfill_platform_invoices` numbers older payments in payment order per financial year (IST) and moves the counters on, so the series stays gap-free and new invoices continue it. Admins open any invoice at `/admin/invoices/:id`. |
| **WhatsApp credits are shown as a balance, not a limit** | "0 used this month · 1,839 left in balance". Credits are bought in packs; the plan sets no monthly cap (`limit: null`, `remaining` = balance). |
| **Admin amounts exclude GST everywhere**, labelled once in the admin top bar | Revenue view: the subscriptions table, CSV, detail page, MRR/ARR and admin alerts all show the price before GST ("₹24,990 + GST" in alerts, which are also emailed). Studio-facing pages and invoices still show GST in full. |
| **MRR = paid billing periods covering that moment** (one per subscription, monthly-equivalent, excl. GST) | The dashboard card and every point of the trend use the same function, so the card always equals the trend's current month. A plan in grace or with no payment adds nothing; an admin cancellation stops it immediately. |
| **"Needs attention"** = in grace, payment failed, or deadline within 7 days | One KPI and one list tab (`?tab=attention`), each subscription counted once. |

## Photo uploads

| Decision | Why |
| --- | --- |
| **Upload limits come from the plan** (`maxPhotoMb`, `maxFilesPerUpload`, `uploadConcurrency` in each plan's `limits`; missing → Starter values) | Starter 25 MB / 300 / 3 · Pro 50 / 1,000 / 4 · Studio 80 / 3,000 / 5 · All-Access 100 / 5,000 / 6. Editable in Admin → Plans. `GET /me/upload-limits` tells the uploader; the server enforces all of it again. |
| **The size limit is applied while the file is read** (a per-request multer limit from the plan) | An oversize photo is cut off at the plan limit instead of being buffered in full; 413 FILE_TOO_LARGE. |
| **Storage is checked under the selection lock** | Parallel uploads can't overshoot the plan together. Usage is the live sum of the studio's files, so My Subscription → Storage needs no separate counter. |
| **Uploads have their own rate-limit bucket** (`RATE_LIMIT_UPLOADS_PER_MIN`, default 6,000) | A 600+ photo folder hit the general 600/min limit and the rest failed with 429. 429s are also retried by the uploader. |
| **Folders keep their path** (`photos.folder`, e.g. "Wedding/Stage") | Relative to the folder that was picked or dropped. |
| **Production body size** | No nginx in this repo and the Vite dev proxy has no body limit. Uploads in production go Vercel → Render via the `/api` rewrite: check a 100 MB upload there, or point `VITE_API_URL` straight at the API if the rewrite limits bodies. |

## Studio workflow (selections, dashboard)

| Decision | Why |
| --- | --- |
| **One event page per selection** (`/photo-selection/:id`, data from `GET /selections/:id/overview`) | Replaces the Upload & Download dialog. Old `?selection=<id>` links redirect to it. |
| **Statuses: Draft → Uploading → Shared (`SENT`) → In progress → Submitted → Delivered**, Expired derived | New enum values only; old rows keep theirs. Uploading starts with the first photo, Shared with the first link copy or WhatsApp send. Expired never overrides Submitted/Delivered. |
| **Folders are rows** (`selection_folders`, `photos.folder_id`) | A dropped folder's top folder becomes the selection folder; a folder chosen on the page wins; otherwise General. The migration filed existing photos the same way. Deleting a folder moves its photos to General. |
| **PIN = 4 digits, HMAC-hashed per selection; 5 wrong tries lock it for 15 minutes**, plus 10 tries/min per IP | The right PIN returns an access key (HMAC of the selection + PIN hash) sent as `X-Gallery-Key` or `?k=` on photo URLs; changing or removing the PIN kills every key. PIN errors are 403 so the web app doesn't try a studio login refresh. The studio sees the PIN only when setting it. |
| **Clients only ever get server-made previews** (≤ 1600 px JPEG at quality 82, mozjpeg with the standard tables, studio name tiled when watermarking) | Made with sharp right after upload (2 at a time) or on first view; stored as files linked from `photos.preview_file_id` and not counted as studio storage. Toggling the watermark drops them so they are remade. Originals only via `/photos/:id/download`, and only when downloads are on. |
| **ZIP export streams the originals** (archiver, stored not compressed, one file open at a time) | Works for big events without holding the ZIP in memory. Picked only by default; `scope=all`; optional `folderId`. |
| **Unlock, reset picks, delivered and access changes are logged** (`selection_log`, actor STUDIO/CLIENT/SYSTEM) | Shown on the event page; client entries feed the dashboard's activity list. A visit is counted once per 30 minutes. |
| **Automatic reminders after 3 and 7 quiet days, at most two per selection** | Quiet = since the share or the client's last visit; a manual reminder in the last 2 days holds them back. They only run with the WhatsApp Cloud API configured (template `selection_reminder`, 7 body parameters), because a wa.me link can't be sent by a job. Delivered first, then charged 1 credit and logged like a manual reminder; failures cost nothing. |
| **Studio defaults** (`studios.selection_defaults`: watermark, downloads, gallery days, notes) | Pre-fill the New Selection form; the API applies them when a field is left out. |
| **Dashboard data is a new optional `workflow` field** on `GET /dashboard` | Older fields stay for compatibility. |
| **Digital Album removed from the studio app** | On request: sidebar entry, page and its dialogs are gone; `/digital-album` redirects to the dashboard. Album data, the albums API and clients' `/a/:token` links are kept. The album cover/review columns from the workflow migration are unused for now. |
