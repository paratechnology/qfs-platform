# QFS — Full-Stack Investment Platform

A complete Next.js 15 full-stack application: public landing site, dark/light user
dashboard, an admin control center, a real backend (API routes + PostgreSQL
database + custom session auth), real MetaMask wallet connection, and a
reliability-tested money engine. Deploys to Netlify.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript
- **Prisma 6** ORM — **PostgreSQL** (required; see [Deployment](#deployment-netlify))
- **viem** — EIP-1193 wallet calls, `personal_sign` verification, checksummed addresses
- **Custom auth** — opaque bearer tokens hashed (sha256) into a `Session` table;
  `httpOnly` + `SameSite=Lax` cookie (`qfs_session`). No third-party auth SDK.
- **zod 4** validation on every route; **bcryptjs** password hashing
- **Vitest** — 72 tests covering money math, accrual, referral, idempotency, security, and wallet signatures

## Features

| Area | What's included |
|---|---|
| Landing | Marketing site with markets, plans, reviews, documents, referral capture (`?ref=CODE`) |
| Auth | Register / login / logout, role-based redirects, suspend enforcement |
| Wallet | MetaMask / any EIP-1193 wallet on Ethereum mainnet; server-issued single-use challenge, `personal_sign` verification, multiple addresses, disconnect |
| User dashboard | Balances, deposit (with pay-to instructions + reference), withdraw/invest/loan modals, cards, notifications (mark all read), markets by tab, plans, referrals, history, resources, KYC |
| Admin console | Overview stats (incl. lifetime deposit/withdrawal totals), users (suspend/activate/role, manual balance adjustments, per-user deposit/withdrawal totals, search by address), deposit & withdrawal review with the payout address shown in full, transactions, plans CRUD, loans approval, documents/reviews/markets CRUD, settings, audit log |
| Money engine | Integer cents everywhere; PENDING → admin approve/reject; atomic `prisma.$transaction` creates Transaction + LedgerEntry + balance update |
| Earnings | Deterministic accrual formula, idempotent materializer (unique `EARN-{invId}-{p}` refs), triggered on dashboard read, via a secret-keyed endpoint, and by a Netlify scheduled function |
| Referrals | One-time bonus per referred investment (`referral_rate_bps`, default 500), enforced by unique `investmentId` |
| Safety | Idempotency keys (reference) on deposits/withdrawals/investments, audit log on every admin mutation, server-side role checks on every admin endpoint |

## Connecting a wallet

`/user/user/connect` — the header and hero both link here. The flow:

1. `POST /api/wallet/challenge` returns a nonce and the exact text to sign. The
   message is built and **stored server-side**, so verification compares against
   that exact copy rather than a rebuilt one.
2. The wallet signs it with `personal_sign` (free, no transaction).
3. `POST /api/wallet/verify` recovers the address from the signature and stores the
   connection only if the recovered address matches the claimed one. The recovered
   address is the source of truth.

**Signing proves ownership; it never moves money.** Funds still move only when an
admin approves a request. Deposits are credited by an admin after they confirm the
transfer — this does not watch the chain, so it cannot detect a deposit that was
never sent.

A verified address is not scammer-proof. Withdrawal approval always shows the full
address so the admin can compare it against what the user claims.

## Deposits — pay-to instructions

Deposits stay a manual, admin-verified flow, but with the details a user actually
needs to pay:

1. The admin stores their receiving details in **Admin → Settings**:
   `deposit_bank_name`, `deposit_bank_account`, `deposit_bank_account_name`,
   `deposit_btc_address`, `deposit_eth_address`, `deposit_usdt_trc20`,
   `deposit_usdt_bep20`. A method only appears for users once its address/account
   is set — blank settings keep the method hidden, so no placeholder details can
   leak.
2. In the dashboard's **Add Funds** modal the user picks a method, and a **Pay to**
   panel shows the company's bank account or crypto address with a copy button.
3. The modal generates a `DEP-…` **deposit reference** (also copyable). The user
   includes the reference in their bank transfer description or crypto memo before
   sending, then submits the request. The reference is served with the request to
   the admin queue, so a payment can be matched to a specific user.
4. The admin reviews the request, confirms the transfer, and approves — crediting
   the balance atomically.

References double as idempotency keys: reusing one short-circuits to the existing
request, and a reference claimed by another user is refused (409).

## Withdrawals — limits

Withdrawals are admin-reviewed too, and a few rules apply at submission time
(server-side, so typing a bigger number in the modal changes nothing):

- **Never above available balance** — funds reserved by pending withdrawals and
  money committed to investments are untouchable; exceeding available is rejected
  before the request is even created.
- **`min_withdrawal_cents`** — the seeded $50 floor (0 = no floor).
- **`max_withdrawal_daily_cents`** — an optional per-user 24h ceiling across all
  requests (0 = unlimited). Rejected requests don't count against it.

The dashboard shows your available balance right in the withdraw modal as a
client-side mirror; the API stays the source of truth.

## Admin finance — adjusting balances

From **Admin → Users**, an admin can **Adjust** a single account (credit "profit"
or debit), or use **Adjust all users** for a bulk credit/debit that hits every
non-admin account (active and suspended; admins are excluded). Each adjustment:

- lands as a completed `ADJUSTMENT` transaction (`ADJ-…` reference, "Manual" method)
  plus a ledger entry with the resulting balance,
- never pushes a user's available balance below zero — and bulk debits skip the
  users who can't afford them instead of zeroing them,
- notifies the user and is recorded in the audit log (`FIN.ADJUST` / `FIN.ADJUST_ALL`),
- appears in the user's transaction history as an **Adjustment** row.


npm install

# 2. environment — needs a real PostgreSQL database (see Deployment below)
cp .env.example .env

# 3. apply migrations + generate the client
npm run db:deploy

# 4. seed the admin account + reference content (plans, markets, docs, settings — no demo users)
npm run db:seed

# 5. run
npm run dev
```

Open **http://localhost:3000**.

### Local dashboard preview without PostgreSQL

To inspect the user dashboard while setting up PostgreSQL, add these values to
your ignored `.env` file and run `npm run dev`:

```dotenv
QFS_DEV_LOGIN=true
QFS_DEV_LOGIN_EMAIL=dev@qfs.local
QFS_DEV_LOGIN_PASSWORD=<choose-a-long-random-password>
```

Sign in through the normal login page. This account uses clearly labelled sample
data and cannot perform account actions. It is accepted only when
`NODE_ENV=development`; production builds ignore it. A real PostgreSQL database
is still required for registration, admin access and all financial flows.

> **No PostgreSQL to hand?** Neon and Supabase both have a free tier — create a
> database, paste the connection string into `DATABASE_URL`, and you're set. A
> local `file:./dev.db` is **not** supported any more: the app is deployed to
> serverless functions with an ephemeral disk.

### Seed accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@qfs.local` | `Admin1234!` |

> ⚠️ Change `ADMIN_PASSWORD` in `.env` before any real deployment.

> No demo accounts are seeded. Every non-admin user is a real account created
> through `/user/user/register` (emails are unique — duplicates are rejected).

## Deployment (Netlify)

The app is a standard Next.js 15 App Router project with `netlify.toml` committed.

| Step | Detail |
|---|---|
| Database | Hosted PostgreSQL (Neon/Supabase/RDS). **Required** — serverless functions have no persistent disk. |
| Migrations | `npm run db:deploy` (`prisma migrate deploy`) runs in the Netlify build, before `next build`. |
| Env vars | Set `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` in the Netlify UI. |
| `DIRECT_URL` | The unpooled connection, used for DDL. Hosted providers issue a separate "direct" URL because a pooled connection cannot run `CREATE INDEX` inside a transaction. If yours gives you only one URL, set `DIRECT_URL` to the same value. |
| `NEXT_PUBLIC_APP_URL` | Must match the public origin exactly, with no trailing slash. It is embedded in the wallet sign-in challenge. |
| Earnings sweep | `netlify/functions/accrue.mts`, scheduled daily at 03:17 UTC. It calls the same service as `POST /api/cron/accrue`, because the scheduler cannot send the `x-cron-secret` header. |
| Seed | `npm run db:seed` is **not** run at build. Run it once from your machine against the production database, then change the admin password. |

Security headers are set in two places on purpose: `next.config.mjs` covers
Next-served routes (including the CSP), and `netlify.toml` covers static assets,
which never pass through Next.

## Admin console

Sign in as the admin user, then visit **/user/admin**. Sections:

- **Overview** — KPIs incl. lifetime total deposits/withdrawals (only money actually
  credited/paid) and the priority queue (pending deposits/withdrawals/loans)
- **Users** — search/filter, suspend/activate, promote/demote admins, per-user lifetime
  deposits/withdrawals, and **Adjust** (credit or debit a balance)
- **Requests** — the manual review workflow. Approving a deposit credits the user
  atomically; approving a withdrawal pays out reserved funds; rejecting a withdrawal
  releases the reservation.
- **Transactions** — immutable ledger of every move
- **Investment Plans / Documents / Reviews / Markets** — full CRUD
- **Loans** — approve/reject applications, optional admin note
- **Finance** — from the Users screen, an admin can credit or debit a single account or
  all non-admin accounts at once (active and suspended). Each lands as a completed
  **ADJUSTMENT** transaction with a note, notifies the user, and is audit-logged as
  `FIN.ADJUST` / `FIN.ADJUST_ALL`. Debits can never push a user's available balance below
  zero; users who can't afford a bulk debit are skipped.
- **Settings** — key/value pair editor (payout details like `deposit_bank_account` / `deposit_usdt_trc20`, plus `referral_rate_bps`, `min_withdrawal_cents`, `max_withdrawal_daily_cents`, …)
- **Audit Log** — every admin mutation, with actor, action, target and metadata

## Real-time updates

Both dashboards stay current without a page reload. A single shared hook,
`useLive` in `lib/use-live.tsx`, drives it:

- loads on mount, then re-fetches every **15s** (`LIVE_MS`)
- also refreshes the moment the tab regains focus or becomes visible again
- pauses while the tab is hidden, and never lets two requests overlap
- a failed refresh keeps the last good data on screen instead of blanking the page

Every admin screen and the user dashboard are wired to it, so an admin approving
a deposit shows up in the user's balance, the request queue, the audit log and
the KPI tiles within one interval — and the reverse for anything a user submits.
The pulsing **Live · Ns ago** pill in each topbar shows the age of the data on
screen. Pass `{ intervalMs: 0 }` to `useFetch` to opt a screen out.

This is short-interval polling, not websockets: it needs no extra process or
infra, and a multi-instance deployment would want a shared store (see
*Production notes*).

**Live market prices.** The dashboard market feeds (metals, stocks, crypto) are
decorated with real-time quotes from Yahoo Finance's public chart endpoint
(`lib/live-prices.ts`) — no API key. Each symbol maps to its upstream ticker
(indices `^GSPC`/`^IXIC`/`^DJI`, metal futures `GC=F` & friends, stocks by
ticker, crypto `BTC-USD` & friends). Quotes are fetched in one single-flight
batch per process every **60s** and cached, so the 15s dashboard poll never
hammers the feed. The whole refresh runs under a hard ~6s wall-clock budget
(per-fetch timeouts shrink as the budget drains), so a slow upstream can never
stall an overview past that. The seeded `marketAsset` price/change columns
remain the last-known fallback when the upstream is unreachable; admin market
editing is unaffected.

## Earnings accrual (cron)

Earnings materialize lazily: any dashboard read calls `accrueEarningsForUser`, and
an external scheduler can POST to the cron endpoint to keep balances warm:

```bash
curl -X POST http://localhost:3000/api/cron/accrue \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d "{}"
```

The endpoint accrues for every user with active investments. It is idempotent —
re-running credits nothing new.

## Testing

The suite runs against a **separate PostgreSQL database** that it force-resets
before every run. Point it at a throwaway one — never the database your app uses:

```bash
# in .env
TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST/qfs_test?schema=public"
TEST_DIRECT_URL="postgresql://USER:PASSWORD@HOST/qfs_test?schema=public"

npm test          # or: npx vitest run
```

The suite refuses to start if `TEST_DATABASE_URL` is unset, and refuses to start if
the database name does not contain `test`. Both guards exist because the reset is
destructive.

Covered:

- **Money** — dollar→cent conversion (FP-safe), half-up rounding, ROI math, month math
- **Accrual** — one completed EARNING per elapsed month, idempotency, term caps,
  ledger/balance reconciliation
- **Referrals** — exact bps bonus in cents, floor rounding, once-per-investment
- **Idempotency** — duplicate references short-circuit; deposit approval/double-approve
  guards; withdrawal reservation prevents overspending; rejection releases funds;
  investment min/max + available-balance enforcement
- **Requests** — every approve/reject combination reports the decision it made and
  leaves the stored row, balance and ledger in agreement
- **Security** — CSRF, body caps, IP/account throttling, password policy, URL allowlist,
  login parity (no user enumeration)
- **Wallet** — a valid signature is stored; a signature from a *different key* is
  refused; a signature over a *different message* is refused; a replayed nonce is
  refused; another user's nonce cannot be spent; expired challenges are refused;
  non-mainnet chains are refused; reconnecting does not duplicate a row; a lowercase
  address is normalised to checksummed form; one user can hold several addresses;
  disconnect is scoped so nobody can remove someone else's wallet

### Wallet checks (optional)

```bash
node scripts/wallet-e2e.mjs            # API: challenge → spoofing → verify → money flow
node scripts/wallet-ui.mjs             # browser: drives the real page with a stub wallet
node scripts/gen-baseline.mjs          # regenerate the Postgres baseline migration
```

`wallet-ui.mjs` injects a stub EIP-1193 provider into a real headless Chrome, then
signs the page's challenge with a throwaway key using viem — so the page runs its
actual code path and the server performs a real signature verification. It also
covers the no-wallet-installed state, a user rejecting the signature, and the
dashboard's wallet picker.

### E2E smoke checks (optional)

With `npm run start` running against a seeded DB:

```bash
node scripts/smoke.mjs           # register → deposit → admin approve → balance +$250.00
node scripts/pages.mjs           # 11 admin pages render, role/anonymous guards redirect
node scripts/live-check.mjs      # every screen loads + polls; two sessions stay in sync
node scripts/register-check.mjs  # register form contract + validation
node scripts/security-check.mjs  # headers, CSRF, throttling, cron secret, session revocation
node scripts/redirect-check.mjs  # session redirects resolve, with no ping-pong loops
```

### Responsive checks (optional)

Layout is verified against a real browser rather than eyeballed. `scripts/lib/cdp.mjs`
drives the installed Chrome over the DevTools protocol, so these add no dependencies.

```bash
npm run check:responsive          # 15 routes x 5 viewports; writes scripts/responsive-report.txt
npm run check:responsive -- --shots   # also saves PNGs to scripts/shots/
node scripts/probe.mjs "/user/admin/users" 360 "<expression>"   # one-off measurement
```

Viewports are 360 / 390 / 430 / 768 / 1280. Each page is checked for:

- **hard** — content overflowing the viewport, the page scrolling sideways, and
  interactive targets under 32px
- **soft** — off-screen positioned elements, 32–44px targets, and clipped text

Deliberate patterns are excluded rather than patched: elements inside a scroll or
`overflow: hidden` ancestor, off-canvas drawers parked at exactly `-100%`, controls
wrapped in a `<label>`, and the progress-bar fill, whose label is anchored to the
animating fill before the IntersectionObserver runs.

## Project layout

```
app/
  api/            # all backend routes (/api/auth, /api/admin/**, /api/cron/accrue, …)
  user/admin/     # admin console pages (server-guarded by role)
  user/user/      # auth pages + user dashboard + wallet connect
components/
  admin/          # admin shell + shared client toolkit (ui.tsx)
  dashboard/      # DashboardApp + icons
lib/
  services/       # domain logic: account, auth, admin, overview, referral, admin-log, wallet, accrual
  api/            # errors, helpers, ApiError envelope
  session.ts      # cookie/session handling (requireUser / requireAdmin)
  wallet-client.ts # EIP-1193 wrapper: accounts, chain switch, personal_sign
  use-live.tsx    # client hook: load on mount + poll + refresh on focus (LiveBadge)
  validators.ts   # zod schemas for every route
  money.ts        # integer-cents helpers
netlify/
  functions/      # accrue.mts — scheduled earnings sweep
prisma/
  schema.prisma   # 20 models (PostgreSQL)
  migrations/     # single baseline; regenerate with scripts/gen-baseline.mjs
  seed.ts         # wipe-and-reseed: admin + reference content only (no demo users)
  cleanup-demo.ts # one-off purge of demo/test users (kept for reference)
tests/            # vitest suite + helpers + setup
styles/           # dashboard.css (.qfs-dash tokens), admin.css, globals.css
```

## Security

Enforced in code (see `tests/security.test.ts` and `scripts/security-check.mjs`):

- **Sessions** — 256-bit random opaque tokens; only an HMAC-SHA256 hash (keyed with
  `SESSION_SECRET`) is stored. Cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production.
  A suspended user's live session is destroyed on the next request, not just at login.
- **Auth redirects** — `middleware.ts` only guards *absence* of a cookie, because the token
  is opaque and can only be verified against the DB in a server component. So it bounces
  protected pages to login when signed out, but never bounces the login/register pages
  forward: doing that on cookie presence made a stale or revoked cookie ping-pong between
  `/user/user/dashboard` and `/user/user/login` forever. The auth pages verify the session
  for real and redirect only when one genuinely exists. `npm run check:redirects` asserts
  all 15 combinations.
- **Passwords** — bcrypt at cost 12, minimum 10 characters with a letter and a number,
  and a hard 72-byte cap (bcrypt ignores anything beyond that, which would otherwise let
  two different passwords share a hash).
- **Account throttling** — per-IP *and* per-account limits on login (and per-address on
  register). IPs come from proxy headers, so when none are present the shared bucket gets
  a high cap: one noisy client must not be able to lock out the whole site.
- **CSRF** — every state-changing route (including the admin `DELETE`s) requires a
  same-origin `Origin`, `Referer`, or `Sec-Fetch-Site`; header-less clients (curl, cron)
  are allowed through. `SameSite=Lax` is the second layer.
- **Headers** — CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`),
  `X-Frame-Options: DENY`, `nosniff`, strict `Referrer-Policy`, `Permissions-Policy`,
  COOP/CORP, HSTS in production, and no `X-Powered-By`.
- **Cron** — `/api/cron/accrue` is disabled (503) unless `CRON_SECRET` is set, and compares
  it in constant time.
- **Wallet** — the address is only stored if the signature recovers to that same address,
  so a user cannot attach a wallet they do not control. Challenges are single-use and
  expire in 10 minutes, so a signature harvested from a page's network log or a shared
  browser cannot be replayed later. The signed message is built and stored server-side
  rather than reconstructed at verify time, and it states plainly that signing costs no
  gas and moves no funds. Verified addresses are shown in full to admins on withdrawal
  approval, since a verified address is not scammer-proof.
- **Input** — zod on every route, a 64 KB body cap, and a URL allowlist (`/path` or
  `https://`) on admin-supplied links so `javascript:` can't reach an `href`.
- **Responses** — all API JSON is `Cache-Control: no-store`; errors never leak internals.

Not yet done (needs deployment context): per-endpoint CSP nonces instead of
`'unsafe-inline'`, a shared rate-limit store (the current one is per-process), and
MFA/email verification for admin accounts.

## Production notes

- **PostgreSQL is required**, in dev and in production. SQLite was used during
  development but cannot work on Netlify: serverless functions have an ephemeral
  disk, so users, balances, sessions, wallet connections and the audit log would all
  vanish between requests. The provider was switched to `postgresql` and the SQLite
  migrations were replaced by a single Postgres baseline
  (`prisma/migrations/20260926000000_baseline`, regenerate with
  `node scripts/gen-baseline.mjs` — it needs no live database).
- `listUsers` search uses `mode: "insensitive"` on every field. This is load-bearing,
  not cosmetic: on SQLite `contains` compiled to `LIKE`, which is case-insensitive, but
  Postgres `LIKE` is case-**sensitive**. Without it, searching `john` silently stopped
  finding `John` — and wallet search broke too, because addresses are stored
  checksummed (mixed case).
- Emails are lowercased in three places (zod schema, register, login) so the unique
  index behaves the same on Postgres as it did on SQLite.
- **Money is stored as integer cents** (`balanceCents`, `amountCents`, …) — never floats.
  These are 32-bit `Int` columns, so the ceiling is 2,147,483,647 cents
  ($21,474,836.47). A total past that is a bug, and Postgres raises rather than
  silently wrapping.
- Set strong `SESSION_SECRET` (32+ chars — production refuses to run without it) and
  `CRON_SECRET` values, plus a real `ADMIN_PASSWORD`.
- Every admin endpoint re-checks the role server-side (`requireAdmin`); the UI guard
  is convenience only.
- Real-time updates are per-tab polling against a single origin. On more than one
  instance, raise `LIVE_MS` and move the throttling buckets to a shared store
  (Redis) so limits are global rather than per-process. Note that serverless functions
  make this per-process limiter weaker, not stronger.
- Deliberately not built: per-endpoint CSP nonces, MFA / email verification for
  admins, websocket push, on-chain deposit verification (deposits are admin-credited,
  so a deposit that was never actually sent will not be detected automatically).
