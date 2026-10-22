# QFS

Next.js 15 / React 19 frontend, Laravel 12 API, and MySQL 8.0.13+ or MariaDB 10.11+.
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

Requirements: Node.js 22+, PHP 8.3+ with PDO MySQL, intl, mbstring, openssl, GMP, and standard Laravel extensions; Composer; MySQL/MariaDB.

1. Run `npm ci` in the project root and `composer install` in `server/`.
2. Copy `.env.example` to `.env` and `server/.env.example` to `server/.env`.
3. Create a database and restricted database user. Fill Laravel's `DB_*` settings. Set `DB_CONNECTION=mysql` for MySQL or `mariadb` for MariaDB. Use InnoDB, strict SQL mode, utf8mb4, and the template's binary collation so identifiers and crypto addresses retain case-sensitive uniqueness.
4. For a **new installation only**, run `php artisan key:generate` from `server/`. Generate a separate random 32+ character `QFS_SESSION_SECRET`. Preserve both keys when moving an existing installation.
5. Run `php artisan migrate` from `server/`. For an empty installation, run `php artisan db:seed` to add reference plans/settings and the optional admin specified by `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Do not seed sample data into an imported account database.
6. Run `php artisan serve --host=127.0.0.1 --port=8000` from `server/` and `npm run dev` from the root.
7. Run `php artisan schedule:work` separately when scheduled financial processing is wanted locally.

The existing Windows workspace can also use `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1`. It starts the configured portable MariaDB instance, API, frontend, and scheduler. A separately managed database may be started before the script. Logs and local database files stay outside the repository.

The frontend opens at http://localhost:3000. Only Laravel receives database credentials; the frontend needs `LARAVEL_API_URL` and public site/support settings.

## Hosting on cPanel

- Confirm that the host supports PHP 8.3+, PDO MySQL, and the actual MySQL/MariaDB version. The local integration target is MariaDB 11.4.
- Next.js requires Node.js application hosting or a separate frontend host. A PHP-only cPanel plan cannot run this frontend by uploading static files.
- Deploy Laravel with the document root pointing at `server/public`. Keep `.env`, `storage/app/private`, source, and vendor files outside publicly served paths.
- Fill `DB_*`, `APP_URL`, `QFS_PUBLIC_URL`, `QFS_ALLOWED_ORIGINS`, keys, SMTP, and optional provider credentials. Set `APP_ENV=production`, `APP_DEBUG=false`, and `QFS_DEV_LOGIN=false`.
- Point frontend `LARAVEL_API_URL` to the API origin and set `NEXT_PUBLIC_APP_URL` / support email. Build using `npm run build` and run `npm start` under the host's process manager. API requests and session cookies must pass through unchanged.
- Run migrations and `php artisan config:cache` during deployment. Preserve existing application/session keys and password hashes.
- Add one cron entry every minute: `* * * * * cd /absolute/path/to/server && /absolute/path/to/php artisan schedule:run >> /dev/null 2>&1`.
- The scheduler processes hourly investment earnings, referral rewards, swap reconciliation, and the database mail queue. Avoid duplicate scheduler installations; verify cron and queued email on the actual host.
- Configure SMTP through the mailbox's cPanel connection values. A blank SMTP configuration cannot deliver recovery or account mail.
- Keep private database/file backups outside this public repository. Changing connection settings does not move data: import an approved database export and copy private uploads separately, then verify row counts, financial balances, reservations, and file references before enabling writes.

For a database move, pause writes and scheduled workers, take final backups, import and reconcile, then reopen the application. After the new database has accepted writes, reverting to an old backup requires reconciling those new records first.

## Verification

- `npm test`: frontend localization, financial amount-entry, and shared utility checks; no database writes.
- `npm run lint`: TypeScript checking.
- `npm run build`: production frontend build.
- `cd server; php artisan test`: isolated SQLite feature tests. SQLite is a fast test fixture engine, not the deployed database.
- `cd server; php artisan test --filter=MySqlIntegrationTest`: full migrations, precision/collation, searches, financial requests, and concurrent approvals/withdrawals/earnings on a real MySQL/MariaDB database. Supply `APP_ENV=testing` and `DB_*` through the process environment for an isolated database ending in `_test`; its user must have access only to that test database. This suite intentionally recreates that isolated schema and refuses to run on the application database.
- Browser scripts use fixtures for financial writes and require a local check session/account. They do not send cryptocurrency.

Migrations remain in execution order because they are the supported installation path, not an alternative historical backend. The application has one backend and one migration owner.

## Languages and optional services

Translation catalogs are bundled locally in 21 languages. Edit source-keyed files under `lib/i18n/translations/`, regenerate using `node scripts/localization-extract.mjs` (without `--write`) and `node scripts/localization-catalogs.mjs`, then run localization tests. Crypto amounts preserve atomic precision; investment principal and returns remain fixed in USD.

Wallet connections use signatures and never collect seed phrases. Receiving wallets are managed by admins. Changelly swaps remain disabled until valid provider and treasury credentials are configured. Private KYC uploads are reviewed by admins. Illustrative class-project reviews appear only when explicitly enabled and retain their disclosure.

Laravel 12 security support ends on 24 February 2027; schedule the next framework upgrade before then.
