# QFS Laravel API

Laravel owns the API, financial ledger, admin operations, earnings accrual, and Ethereum wallet verification. Next.js remains the frontend. Both servers use the same PostgreSQL schema and `qfs_session` cookie.

Admin document uploads are stored on Laravel's private local disk and served through authenticated `/api/documents/files/{name}` routes. Set PHP `upload_max_filesize` to at least `10M` and `post_max_size` above that (for example `12M`) to accept the full 10 MB limit.

See [MIGRATION_MATRIX.md](MIGRATION_MATRIX.md) for a route-by-route frontend trace.
See [IMPLEMENTATION_STATE.md](IMPLEMENTATION_STATE.md) for manual KYC, investment materials, and the remaining operational gaps.

## Local start

1. Install PHP 8.3 or newer with `curl`, `fileinfo`, `gmp`, `intl`, `mbstring`, `openssl`, `pdo_pgsql`, and `zip`; Composer; PostgreSQL; and Node.js.
2. Configure `server/.env` from `server/.env.example`. Set the PostgreSQL credentials, `QFS_SESSION_SECRET` (the same value as root `SESSION_SECRET`), `QFS_PUBLIC_URL`, `QFS_ALLOWED_ORIGINS`, and `CRON_SECRET`. The development-only preview login needs the same `QFS_DEV_LOGIN_*` values in both environments.
3. In `server/`, run `composer install`, `php artisan key:generate` if the app key is empty, then `php artisan migrate --force`.
4. Run `php artisan db:seed --class=QfsSeeder --force`. This inserts missing plans, markets, settings, and an admin only if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are configured. It preserves existing rows and can be rerun.
5. Start `php artisan serve --host=127.0.0.1 --port=8000`. In the project root, set `LARAVEL_API_URL=http://127.0.0.1:8000`, install Node packages, and run `npm run dev -- --hostname 0.0.0.0`.

On this Windows machine, `scripts/start-local.ps1` restarts the local database and both servers if their ports are down. Tailscale Serve is configured to forward `https://desktop-3agleec.tailf7d6a2.ts.net:8443/` to the Next frontend on port 3000. Laravel listens on loopback only.

## cPanel domain and email

The canonical frontend is `https://q-arculuspro.live`. Root `.env` uses `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL`; `server/.env` uses `APP_URL`, `QFS_PUBLIC_URL`, `QFS_SUPPORT_EMAIL` and `QFS_ALLOWED_ORIGINS`. Contact links, referral URLs, wallet challenges, email links and replies use these settings. Rebuild Next after changing `NEXT_PUBLIC_*` values.

Create the sender mailbox in cPanel **Email Accounts**. Copy the SSL/TLS outgoing-server details from **Connect Devices** into `server/.env`:

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=smtps
MAIL_HOST=HOST_FROM_CPANEL
MAIL_PORT=465
MAIL_USERNAME=no-reply@q-arculuspro.live
MAIL_PASSWORD=MAILBOX_PASSWORD
MAIL_FROM_ADDRESS=no-reply@q-arculuspro.live
MAIL_FROM_NAME=QFS
QFS_SUPPORT_EMAIL=support@q-arculuspro.live
QFS_ACCOUNT_EMAILS=true
```

Use the provider's actual server/port. Port 587 uses `MAIL_SCHEME=smtp` with STARTTLS; keep TLS certificate verification enabled. The sender must be permitted by the authenticated mailbox. SMTP and account emails are enabled in the environment configuration. Fill the outgoing server and mailbox credentials before expecting delivery; recovery explicitly reports unavailable delivery when these values are missing, and account emails are not queued as if delivery were working.

The normal deployment steps remain `php artisan migrate --force` and `php artisan config:cache` after changing environment values. Keep Laravel's minute cron running (`* * * * * /path/to/php /path/to/server/artisan schedule:run >> /dev/null 2>&1`). This existing scheduler runs the dedicated database mail queue automatically, so a separate persistent mail worker is unnecessary. Jobs retry failed delivery five times with backoff; inspect `php artisan queue:failed` and use `php artisan queue:retry ID` after resolving the provider failure. Registration and important deposit/withdrawal/loan/verification updates send localized account emails; hourly earnings do not generate email spam. Recovery retains its separate private, expiring link flow. Email is queued after the business transaction commits and cannot undo a financial approval.

The hosting person must point the domain's DNS to the actual public frontend, issue HTTPS, and configure cPanel Email Deliverability records (SPF/DKIM/DMARC) plus MX for receiving support mail. The domain had no public A/MX records at the October 18 check. cPanel hosting needs a compatible Node service for Next and PHP/PostgreSQL for Laravel; a PHP document root alone does not serve the frontend.

## Schema and data

`database/sql/qfs_baseline.sql` is the original Prisma PostgreSQL baseline. The Laravel migration imports it for a fresh database and recognizes a complete existing Prisma schema. It does not drop financial tables on rollback. Do not run the old `prisma/seed.ts` against real data: it wipes users, transactions, and ledger rows. The Laravel seeder is non-destructive.

All amounts are integer cents. Deposit and withdrawal approvals, reservations, investment debits, referral bonuses, ROI credits, and admin adjustments use database transactions. Balance-changing paths lock account rows. Wallet verification accepts Ethereum and BNB Smart Chain EOA addresses only after a one-time challenge is signed. The connection page discovers EIP-6963 and legacy browser wallets, supports late injection, and offers MetaMask/Trust Wallet app links on HTTPS. Wallet app browsers require their own account sign-in. Users may also paste a wallet-produced signature. Cross-device WalletConnect QR pairing is not installed. The application never asks for or stores a seed phrase or private key.

The market preview caches quotes for 60 seconds. Yahoo quotes are fetched in parallel, and CoinGecko supplies a batch of crypto USD prices and 24-hour changes. Set `COINGECKO_DEMO_API_KEY` for a supported Demo API connection. On Windows PHP with OpenSSL, configure `curl.cainfo` and `openssl.cafile` in `php.ini` to a trusted CA bundle; otherwise HTTPS quote requests fail and crypto prices appear unavailable. Keep TLS verification enabled. The dashboard hides seeded crypto prices whenever no fresh quote is available.

Investment plans define a monthly ROI and a payout interval. MONTHLY (the default for existing plans) shows pending profit after each whole hour and credits it to the spendable balance on each investment start-date anniversary. HOURLY credits spendable profit after each whole hour. Each investment snapshots its rate, term and payout interval at purchase, so later admin edits affect new investments only. A month's profit is rounded to cents once; hourly credit uses cumulative rounding across that investment month. The overview returns pending amounts to four decimal places for visibility, while ledger credits remain integer cents. The Laravel scheduler sweeps hourly; run `php artisan schedule:work` locally or `php artisan schedule:run` every minute from the host cron. The local start script launches the scheduler.

After final profit settlement, investments mature. Plans set `principalRelease` to `AUTOMATIC` or `MANUAL` (default). New investments snapshot this policy. Automatic plans return principal during maturity; manual plans appear in `/admin/investments` for release. Because purchase reserves principal from available balance while retaining it in total balance, release restores availability only. A unique `PRINCIPAL_RETURN` transaction and ledger entry record the return. User `GET /api/investments` provides private cursor-paginated completed history. Early exit is not implemented.

Referral rewards now use approved deposits, with a default rate of 500 basis points (5%). Each new approved deposit pays the inviter a spendable USD bonus once; investing those funds does not pay another reward. Existing investment-based rewards remain historical records and earlier approvals are not backfilled. Cash uses the confirmed USD amount. Crypto uses a fresh USD price, saved with the reward; when pricing is unavailable, the deposit still succeeds and the reward waits for the next fresh price. The existing minute scheduler retries pending rewards and temporarily unavailable recipient accounts. Rewards round down to whole cents; amounts below one cent do not credit. Admin settings can adjust the rate for future approvals, with validation from 0 through 10,000 basis points.

## Account recovery

User and admin sign-in link to `/forgot-password`. Laravel accepts `POST /api/auth/forgot-password` and sends a private link to `/reset-password` with its token in the URL fragment, which is not sent in browser HTTP requests. Tokens are hashed in `PasswordRecoveryToken`, expire after 30 minutes, and are replaced by a new request. `POST /api/auth/reset-password` consumes the token, changes the password, revokes that account's sessions and sends a security notification. Sign in again after resetting; recovery never changes account roles or reactivates suspended accounts.

Configure `MAIL_MAILER=smtp`, your provider's `MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD`, and verified `MAIL_FROM_ADDRESS` in `server/.env`. Set `QFS_PUBLIC_URL` to the user-facing HTTPS origin. The existing Laravel mail configuration also supports its other delivery transports when their dependencies/credentials are available. Recovery refuses log/array-only mail and failover paths containing them outside tests, so live reset secrets are not written to mail logs. Requests report recovery unavailable until the SMTP connection values are configured. Request responses do not disclose whether an account exists; delivery happens after the response and failures are logged without links or credentials.

## Verification

Run `php artisan test` for the financial flow and session tests. With both servers running, exercise endpoints through `http://localhost:3000/api/*` so the Next rewrite, cookie, and origin behavior are included. The API returns the existing `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code": ..., "message": ... } }` envelope.

## Deployment

The frontend needs `LARAVEL_API_URL` at build and runtime. Deploy Laravel to a PHP host with PostgreSQL, configure HTTPS, and set `QFS_ALLOWED_ORIGINS` to the exact frontend origin. Run `php artisan migrate --force` as a backend deployment step, then the non-destructive seeder when reference content is needed. The old Netlify scheduled accrual and Prisma migration build step have been removed; schedule `POST /api/cron/accrue` on the Laravel host with the `x-cron-secret` header. No production Laravel host has been selected yet.
