# QFS API

Laravel 12 is the only backend. It owns SQLite persistence locally and MySQL persistence on cPanel, authentication, permissions, account/crypto ledgers, investment payouts, referral rewards, KYC, statements, email, and provider integration.

See the root [README](../README.md) for installation, cPanel deployment, data transfer, and verification.

- Routes: `routes/api.php`; scheduled jobs: `routes/console.php`.
- Endpoints return `{ok:true,data:...}` or `{ok:false,error:{code,message}}`.
- Session authentication uses the HTTP-only `qfs_session` cookie and `QFS_SESSION_SECRET`.
- Private uploads are stored in `storage/app/private` and served through authorized endpoints.
- Database changes belong in `database/migrations`; reference records belong in `QfsSeeder`.
- Dollar amounts use integer cents. Crypto balances and ledger quantities use exact atomic-unit strings with big-integer arithmetic.
- Feature tests use isolated SQLite memory databases. `DatabaseIntegrationTest` verifies complete migrations, schema rebuilding and concurrent financial writes on disposable SQLite files, or on a dedicated MySQL database ending in `_test` when configured.

Common commands:

```sh
composer install
php artisan migrate
php artisan db:seed
php artisan serve --host=127.0.0.1 --port=8000
php artisan schedule:work
php artisan test
```

Generate application keys only for new installations. Never regenerate existing encryption/session keys during deployment. Keep database exports, `.env`, private uploads, and provider signing keys out of Git.
