# Comparing the maintained application with the original UI

The apps are independent. Use separate disposable databases and private upload directories for comparison. Never seed or reset the owner's imported database.

| App | Command | URL |
| --- | --- | --- |
| Maintained Laravel/Blade app | From `scripts/`: `php artisan serve --host=127.0.0.1 --port=8080` | http://127.0.0.1:8080 |
| Original Laravel API | From `server/`: `php artisan serve --host=127.0.0.1 --port=8000` | http://127.0.0.1:8000 |
| Original Next.js UI | From repository root: `npm run dev` | http://localhost:3000 |

Configure each app's URL, allowed origins and session credentials for its own isolated installation. Do not share one live database between independent app versions. Do not run duplicate schedulers. The maintained app does not need the other two processes.

The root-level `*.mjs` browser checks in `scripts/` were written for the original React UI; many selectors are framework-specific. They remain reference utilities and should not be treated as proof of Blade parity. The imported app's current regressions run from `scripts/` with:

```sh
php vendor/bin/phpunit
node --test tests/browser/financial-flows.test.mjs
```

See [the application README](../README.md) for deployment, SMTP and data preservation details.
