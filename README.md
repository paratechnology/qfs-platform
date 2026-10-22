# QFS

Next.js 15 / React 19 frontend and Laravel 12 API. Local development uses SQLite; cPanel deployment supports MySQL 8.0.13+ or MariaDB 10.11+.
All authentication, database access, financial operations, and scheduled processing live in Laravel. Next.js renders the public website, user dashboard, and admin console and proxies `/api/*` to Laravel.

## Code map

| Directory | Responsibility |
| --- | --- |
| `app/` | Next.js routes and layouts; `/admin` aliases the admin console |
| `components/` | Public, account, and admin interface components |
| `lib/` | API payload types, Laravel session adapter, localization, wallet UI, and client utilities |
| `styles/`, `public/` | Styling and static assets |
| `server/app/Http/Controllers/` | Authoritative API endpoints |
| `server/app/Support/` | Financial rules, exact crypto arithmetic, pricing, security, verification, and provider adapters |
| `server/database/migrations/` | Complete schema installation and incremental changes |
| `server/tests/` | Laravel feature and database integration tests |
| `tests/`, `scripts/` | Frontend localization and isolated browser checks |

## Local setup

Requirements locally: Node.js 22+, PHP 8.4+ with PDO SQLite, intl, mbstring, openssl, GMP, and standard Laravel extensions; Composer. No database server is required. PHP 8.4 enables the immediate SQLite transactions used to serialize local financial writes.

1. Run `npm ci` in the root and `composer install` in `server/`.
2. Copy `.env.example` to `.env` and `server/.env.example` to `server/.env`.
3. Keep `DB_CONNECTION=sqlite`. Create an empty `server/database/database.sqlite` file (`New-Item -ItemType File server/database/database.sqlite` in PowerShell). Omit `DB_DATABASE` to use that default, or set an absolute SQLite file path.
4. For a **new installation only**, run `php artisan key:generate` from `server/` and generate a separate random 32+ character `QFS_SESSION_SECRET`. Preserve existing keys when moving an installation.
5. Run `php artisan migrate` from `server/`. For an empty installation, run `php artisan db:seed` to add reference plans/settings and the optional admin specified by `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Do not seed an imported account database.
6. Run `php artisan serve --host=127.0.0.1 --port=8000` from `server/` and `npm run dev` from the root.
7. Run `php artisan schedule:work` separately for scheduled financial processing.

Windows shortcut: `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1`. It checks PHP/PDO SQLite, creates the default file if needed, runs pending migrations, and starts the API, frontend and scheduler. It does not start a database service. SQLite files and WAL sidecars are ignored by Git; logs stay outside the repository.

The frontend opens at http://localhost:3000. Only Laravel receives database credentials; the frontend needs `LARAVEL_API_URL` and public site/support settings.

## Hosting on cPanel

- Confirm PHP 8.3+, PDO MySQL, and the actual host database version. Set `DB_CONNECTION=mysql` (or `mariadb`), fill the host's `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, and keep `DB_COLLATION=utf8mb4_bin` with strict mode and InnoDB. Shared migrations and financial flows are tested with local SQLite and MariaDB 11.4.
- Next.js requires Node.js application hosting or a separate frontend host. A PHP-only cPanel plan cannot run this frontend by uploading static files.
- Deploy Laravel with the document root pointing at `server/public`. Keep `.env`, `storage/app/private`, source, and vendor files outside publicly served paths.
- Fill `DB_*`, `APP_URL`, `QFS_PUBLIC_URL`, `QFS_ALLOWED_ORIGINS`, keys, SMTP, and optional provider credentials. Set `APP_ENV=production`, `APP_DEBUG=false`, and `QFS_DEV_LOGIN=false`.
- Point frontend `LARAVEL_API_URL` to the API origin and set `NEXT_PUBLIC_APP_URL` / support email. Build using `npm run build` and run `npm start` under the host's process manager. API requests and session cookies must pass through unchanged.
- Run migrations and `php artisan config:cache` during deployment. Preserve existing application/session keys and password hashes.
- Add one cron entry every minute: `* * * * * cd /absolute/path/to/server && /absolute/path/to/php artisan schedule:run >> /dev/null 2>&1`.
- The scheduler processes hourly investment earnings, referral rewards, swap reconciliation, and the database mail queue. Avoid duplicate scheduler installations; verify cron and queued email on the actual host.
- Configure SMTP through the mailbox's cPanel connection values. A blank SMTP configuration cannot deliver recovery or account mail.
- Keep private database/file backups outside this public repository. Changing connection settings does not move data. A SQLite file cannot be imported directly through MySQL/phpMyAdmin: existing local accounts need a deliberate SQLite-to-MySQL conversion/import. Copy private uploads separately, then reconcile row counts, financial balances, reservations, and file references before enabling writes.

For a database move, pause writes and scheduled workers, take final backups, import and reconcile, then reopen the application. After the new database has accepted writes, reverting to an old backup requires reconciling those new records first.

## Verification

- `npm test`: frontend localization, financial amount-entry, and shared utility checks; no database writes.
- `npm run lint`: TypeScript checking.
- `npm run build`: production frontend build.
- `cd server; php artisan test`: isolated SQLite feature tests and full-schema/concurrency tests on disposable SQLite files. The application database is never used.
- `cd server; php artisan test --filter=DatabaseIntegrationTest`: full migrations, precision/collation, search, financial requests, reserved-name foreign-key rebuilding, and concurrent approvals/withdrawals/earnings. Defaults to disposable `*_test.sqlite` files. For cPanel-style testing, supply `APP_ENV=testing` and MySQL/MariaDB `DB_*` process environment values for a restricted database ending in `_test`. This suite recreates only that isolated schema and refuses the application database.
- Browser scripts use fixtures for financial writes and require a local check session/account. They do not send cryptocurrency.

Migrations remain in execution order because they are the supported installation path, not an alternative historical backend. The application has one backend and one migration owner.

## Languages and optional services

Translation catalogs are bundled locally in 21 languages. Edit source-keyed files under `lib/i18n/translations/`, regenerate using `node scripts/localization-extract.mjs` (without `--write`) and `node scripts/localization-catalogs.mjs`, then run localization tests. Crypto amounts preserve atomic precision; investment principal and returns remain fixed in USD.

Wallet connections use signatures and never collect seed phrases. Receiving wallets are managed by admins. Changelly swaps remain disabled until valid provider and treasury credentials are configured. Private KYC uploads are reviewed by admins. Illustrative class-project reviews appear only when explicitly enabled and retain their disclosure.

Laravel 12 security support ends on 24 February 2027; schedule the next framework upgrade before then.
