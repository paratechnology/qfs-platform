# QFS Laravel application

This is the maintained application: Laravel 12, Blade and Alpine, with SQLite locally and optional MySQL on cPanel. Pages and JSON APIs run from one PHP application; Node.js and a frontend build are not required to serve it. The original Next.js application at the repository root and API in `server/` remain reference implementations.

## Code map

| Path | Responsibility |
| --- | --- |
| `routes/web.php`, `resources/views/` | Public site, authentication, account dashboard and admin pages |
| `routes/api.php`, `app/Http/Controllers/` | Authenticated JSON endpoints and authorization |
| `app/Support/` | Exact financial ledgers, investments, crypto, SMTP, KYC and integrations |
| `public/js/`, `public/css/` | Alpine components and styles; no build step |
| `database/migrations/` | Schema installation and incremental changes |
| `tests/Feature/`, `tests/browser/` | PHP integration and JavaScript component regression tests |
| `storage/app/private/` | Authorized private documents and encrypted KYC uploads; never public |

## Start locally

Requirements: PHP 8.2.12+ with PDO SQLite, GMP, intl, mbstring, openssl and Laravel's standard extensions; Composer. Use the committed Composer lock with `composer install`. No database service is needed.

For an existing installation, preserve `.env`, its encryption/session keys, `database/database.sqlite` and private uploads. Do not run `migrate:fresh` or seed an existing database. SQLite may have live `-wal`/`-shm` sidecars: use SQLite's backup API or stop all writers and checkpoint before copying data. Copying only the main file while WAL writes remain can lose recent records.

For a new installation only, copy `.env.example`, create the SQLite file, generate `APP_KEY` and a separate random 32+ character `QFS_SESSION_SECRET`, then migrate and seed reference data. Existing installations need only pending migrations.

From this directory:

```sh
composer install
php artisan migrate --force
php artisan serve --host=127.0.0.1 --port=8080
```

Windows alternative: `powershell -NoProfile -File .\dev-server.ps1`. Set `QFS_PHP` to a specific PHP executable and `QFS2_PORT` to override 8080. The helper serves only `public/` and does not start a scheduler or Tailscale. `scripts/start-local.ps1` (run from the repository root) remains a legacy Next.js helper; do not use it to launch this application.

Run `php artisan schedule:work` separately when scheduled hourly earnings, swap reconciliation and mail processing are wanted. Never run duplicate schedulers against one database.

## Financial behavior

- Deposits credit the selected asset after admin approval. A transaction hash is optional for manual review.
- Investments accept USD or funded crypto directly. Crypto uses an expiring price quote; confirmation debits that coin and fixes the investment principal in USD. A separate swap to USD is unnecessary.
- Swaps credit their destination platform balance, which is usable for investment or withdrawal. Internal swaps are ledger conversions; external provider settlement still requires configured treasury/provider services.
- Withdrawals show each asset's available quantity after reservations; approvals and rejections update ledgers transactionally.
- Investment pages retain captured terms, supporting documents, payout timing and completed positions.
- Dollars use integer cents; crypto uses exact atomic-unit strings. Retries use stable references to avoid duplicate debits.

`QFS_ILLUSTRATIVE_REVIEWS=true` enables the original 50 class-project examples, explicitly disclosed as illustrative (92% five-star, 6% four-star, 2% three-star). Leave it false for real approved customer reviews; pending submissions require admin moderation. Examples never enter the customer review table.

## cPanel and SMTP

Point the domain document root at this application's `public/` directory. Keep source, `.env`, databases and private uploads outside publicly served paths. The root `.htaccess` is a compatibility entry point with sensitive-file restrictions, not the recommended document root.

Use `APP_ENV=production`, `APP_DEBUG=false`, `QFS_DEV_LOGIN=false`, correct HTTPS `APP_URL`, `QFS_PUBLIC_URL` and `QFS_ALLOWED_ORIGINS`. Preserve application and session keys. An existing SQLite database can remain SQLite if the host supports PDO SQLite and writable private storage. To use MySQL, explicitly migrate/import/reconcile data; changing `DB_CONNECTION` alone does not transfer accounts.

SMTP configuration can be entered in `.env` or **Admin → Settings → Email & SMTP**. Retain database-managed settings unless `QFS_ENV_OVERRIDES_DB=true` is intentional. Fill `MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD` and sender settings; then clear cached configuration if applicable. Blank credentials cannot deliver recovery email. Admin SMTP test reports delivery errors. `QUEUE_CONNECTION=database` needs a mail worker; `sync` sends inline.

Add one cron entry per minute using the deployment's absolute paths:

```cron
* * * * * cd /absolute/path/to/scripts && /absolute/path/to/php artisan schedule:run >> /dev/null 2>&1
```

Keep `.env`, DB/WAL files, private uploads, provider keys, runtime caches and `vendor/` out of Git. Obtain private data backups separately; the source repository does not contain the live database.

## Verification

```sh
php vendor/bin/phpunit
node --test tests/browser/financial-flows.test.mjs
php vendor/bin/pint --dirty --format agent
```

PHP tests use disposable databases; financial integration tests cover actual SQLite locking and concurrent writes. Browser-component tests exercise the shipped Alpine logic, wallet funding, quote expiry, retry identity, QR rendering, document editing and review/card actions. They are not a substitute for provider credentials, SMTP delivery or a production browser acceptance check.
