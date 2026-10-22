# Laravel 12 and MySQL/MariaDB implementation plan

Status: planning only; no application, dependency, database, or hosting changes performed.
Prepared: 22 October 2026 (Africa/Lagos).
Target confirmed by the owner: MySQL/MariaDB for cPanel hosting.

## 1. Objective and boundaries

Move the existing Laravel API from Laravel 13 to Laravel 12 and replace PostgreSQL with the exact MySQL or MariaDB engine/version provided by the host. Retain the Next.js frontend and the existing public site, user dashboard, admin console, routes, translations, and API response contracts.

Laravel will own persistence, migrations, financial processing, authentication, and scheduled jobs. Next.js will call Laravel rather than maintain a second database implementation. This scope does not include a Blade/Inertia frontend rewrite, a visual redesign, new investment rules, or enabling external payment/swap services.

Laravel 12 is an explicit downgrade: its published bug-fix period ended on 13 August 2026 and security support ends on 24 February 2027. Record a follow-up framework upgrade before that deadline. MySQL and MariaDB are distinct targets; implement and test against the host's selected engine, and only claim support for both after running both test matrices.

## 2. Findings from this repository

| Area | Verified state | Required work |
| --- | --- | --- |
| Framework | `server/composer.json` requires `laravel/framework: ^13.17`; lockfile and installed packages report 13.34.0. Tinker is 3.0.2; installed PHPUnit is 12.5.37. | Resolve a compatible Laravel 12 dependency set; audit bootstrap, configuration, commands, packages, and framework API usage. |
| Initial schema | The first Laravel migration rejects every driver except `pgsql` and loads PostgreSQL SQL. Its SQL baseline creates 20 tables. | Supply a native Laravel Schema Builder baseline for the new engine with equivalent constraints and relationships. |
| Migration chain | There are 15 Laravel migration files. Later files add KYC, funding, swaps, security, queue tables, localization, and referral rewards. | Exercise the entire chain on an empty target database, including data-changing migrations and PostgreSQL enum extensions. |
| SQL compatibility | Search uses `ilike`; KYC uses raw double-quoted identifiers. PostgreSQL enum alterations appear in investment maturity and swap migrations. | Replace driver-specific queries and adapt enum/status handling without changing business behavior. |
| Duplicate handling | Crypto and receiving-wallet paths recognize SQLSTATE 23505 and 23000. Several services use `insertOrIgnore`. | Distinguish actual MySQL duplicate-key errors from other integrity failures; inspect ignore behavior for truncation and invalid values. |
| Crypto precision | Crypto balances and ledger values are stored as strings up to 78 digits and computed using big-integer arithmetic. | Preserve exact strings. Do not convert these values to floats or assume a database DECIMAL can hold 78 digits. |
| Frontend/backend boundary | `next.config.mjs` rewrites API families, including wallets, to Laravel. Server-side auth and dashboard reads use Laravel when configured. | Keep the API surface and remove dependence on PostgreSQL fallbacks. |
| Legacy backend | `lib/db.ts`, `lib/services/*`, legacy Next API handlers, Prisma schema, and older tests still exist. | Trace all callers; replace remaining live persistence paths before retiring Prisma and obsolete fallbacks. |
| Tests | Laravel tests default to SQLite in memory; some manually construct simplified tables instead of running the full migration chain. | Add target-engine migration and integration coverage. SQLite alone cannot certify this migration. |
| Operations | The Windows launcher starts portable PostgreSQL. Laravel schedules earnings, referral rewards, swap reconciliation, and queued email processing. | Update local setup and cPanel deployment instructions, scheduler setup, and isolated test configuration. |

## 3. Target architecture

Browser -> Next.js public site / dashboard / admin -> Laravel 12 API -> MySQL or MariaDB.

- Keep existing client routes and `{ok, data}` / `{ok:false, error}` envelopes.
- Forward the existing session cookie and locale correctly during server rendering and API requests.
- Keep KYC and other private uploads outside the public document root.
- Run one authoritative Laravel scheduler and a host-compatible queue strategy.
- Remove the Node application's need for PostgreSQL connection strings and Prisma once all callers are migrated.

## 4. Implementation sequence

### Phase 1: Establish the deployment target and baseline

1. Record cPanel's database product/version, PHP CLI and web versions/extensions, database privileges and naming prefixes, Node.js support, cron access, process limits, and private storage location.
2. Use PHP 8.3 or 8.4 initially, subject to the host and dependency audit; do not assume the framework's lowest supported PHP version supports every existing package or application feature.
3. Inventory live tables, row counts, foreign keys, indexes, status values, identifiers, JSON/text payloads, amounts, timestamps, and upload references. Do not expose records or secrets in Git.
4. Capture an isolated baseline of the existing API behavior and financial invariants. Create a migration branch and a release checkpoint.
5. Prepare encrypted/restricted database and private-file backups and verify that they can be restored.

Exit gate: target platform documented, restorable backups available, existing behavior recorded, and test databases separated from application data.

### Phase 2: Make Laravel 12 work on the existing database

1. Resolve `laravel/framework` to the latest suitable 12.x release and regenerate the Composer lockfile.
2. Check Tinker, Boost, Pao, Pail, Collision, PHPUnit, Symfony/Carbon dependencies, and wallet-signature packages. Change only incompatible requirements; a downgrade of every package is not automatically necessary.
3. Review Laravel 13-specific bootstrap/configuration, Artisan scripts, exception handling, mail/queue behavior, CSRF/origin protection, cache/session settings, and query-builder differences.
4. Preserve application keys, password hashes, session-signing secrets, and encryption compatibility; never generate new production keys as a migration shortcut.
5. Boot Laravel, validate routes and commands, and run the relevant isolated tests before changing the database engine.

Exit gate: Laravel 12 boots and existing authentication, permissions, wallet verification, and financial behavior remain compatible on PostgreSQL. Separating the framework change from the engine change makes regressions easier to locate.

### Phase 3: Provide the MySQL/MariaDB schema

1. Build a portable Schema Builder baseline equivalent to the PostgreSQL baseline. Retain the PostgreSQL installation path during the transition so the source installation remains recoverable.
2. Map keys, foreign-key lengths/types, unique constraints, defaults, signed amounts, nullable values, and status fields explicitly. Keep existing identifier values and table naming; test exact table casing on Linux and properly quote reserved names such as `Transaction`.
3. Use InnoDB, strict mode, and utf8mb4. Choose comparison rules explicitly: emails/search may be case-insensitive, while tokens, idempotency references, identifiers, and case-sensitive crypto addresses must retain their intended uniqueness.
4. Preserve cents as exact integers and atomic quantities as exact strings. Check source maxima against target limits before import; widening money types is a separate decision if actually required.
5. Preserve timestamp precision and UTC interpretation; choose timestamp/datetime columns based on the actual stored date ranges and nullability.
6. Keep existing JSON/text payload contracts unless a deliberate, tested conversion is necessary. Handle booleans and PDO result types so API booleans remain booleans.
7. Adapt the full 15-file chain, including enum additions, column alterations, queue tables, indexes, and data-writing plan/settings migrations. Do not rerun previously applied business backfills blindly on imported records.
8. Test clean installation and repeated `migrate` execution against the selected target engine.

Exit gate: an empty target database reaches the complete current schema without manual SQL patches or missing constraints.

### Phase 4: Adapt queries and financial transactions

1. Replace `ilike` in user/admin search and raw PostgreSQL identifier quoting in KYC queries with compatible query-builder operations. Preserve search escaping, localization, and filtering.
2. Identify MySQL/MariaDB duplicate-key errors precisely rather than treating every SQLSTATE 23000 integrity failure as an idempotent retry.
3. Review `insertOrIgnore`, upsert semantics, affected-row assumptions, boolean comparisons, sorting, and unique-key behavior under the selected engine.
4. Validate row locks, transaction isolation, lock ordering, deadlock retries, and conditional status transitions on InnoDB.
5. Exercise concurrent requests using separate connections: repeated deposit approval, concurrent withdrawals, investment creation, hourly payout sweeps, principal releases, referral rewards, and swap reconciliation.
6. Require exact invariants: no double credit, no double referral reward, no negative available funds, reserved funds do not exceed holdings, and ledger movements match account changes.

Exit gate: concurrency and retry tests prove the same financial rules on the target engine.

### Phase 5: Finish Laravel ownership and retire PostgreSQL dependencies

1. Map every frontend API call, server-side session/overview load, locale persistence action, and background job to its Laravel implementation.
2. Remove obsolete live Next/Prisma persistence paths after proving coverage, including behavior when the API is unavailable. Missing Laravel configuration must fail clearly rather than silently activate an old backend.
3. Remove unused Prisma dependencies, generation commands, schema/migration tooling, PostgreSQL-only test setup, and obsolete environment variables after auditing their consumers.
4. Port still-useful legacy financial assertions to the authoritative Laravel/target-engine tests; retain browser and localization checks.
5. Update runtime templates, local launcher, host deployment configuration, and existing operational documentation.

Exit gate: a production Next.js build and normal account flows work without Prisma or a PostgreSQL runtime connection.

### Phase 6: Rehearse the data transfer

1. Create a restricted importer with a dry-run/preflight mode and deterministic table mapping. Import in dependency order, including self-referencing referrals; handle cycles in a second pass or with controlled validation.
2. Preserve user IDs, password hashes, admin roles, wallet/network associations, USD balances, crypto balances/reservations, ledgers, requests, investment snapshots/accrual state, payouts, referral records, KYC history, notifications, settings, and document references.
3. Preserve security/encrypted fields using the existing keys. Decide whether to carry valid sessions/recovery challenges or deliberately invalidate only those ephemeral records at cutover.
4. Reconcile records created by schema/data migrations separately from imported settings/plans. Do not run demonstration seeders into the imported financial dataset.
5. Transfer private files separately and verify database-to-file references and file checksums. Database migration alone does not move uploaded documents.
6. Validate row counts, required relationships, status distributions, source/target checksums of normalized records, and exact per-user/per-asset monetary totals.
7. Verify investment principal, paid profit, pending accrual position, next payout boundaries, referral idempotency, and reserved withdrawals. Document existing discrepancies separately rather than changing money to make totals appear to match.
8. Rehearse restoration and measure import/verification duration on a copy of the dataset.

Exit gate: migration rehearsal has zero unexplained financial differences and an agreed, measured cutover window.

### Phase 7: Validate the integrated application

- Run clean-schema and imported-data suites against the actual database engine/version, plus fast unit tests where useful.
- Cover registration/login/recovery, admin authorization, account edits, KYC submission/review/files, receiving-wallet edits, deposits, withdrawals, investments, hourly earnings, principal return, referral rewards, swaps, history, notifications, emails, documents, and statements.
- Test positive flows, insufficient funds, failed quotes, repeat submissions, rejected/approved statuses, and concurrent requests.
- Test dates around monthly anniversaries and hour boundaries; keep USD-fixed investment terms and existing payout choices intact.
- Run frontend type checking, production build, localization tests, and desktop/mobile browser checks. Use provider fixtures or sandboxes for external transactions and email.
- Verify Linux filesystem/table casing, HTTP redirects, cookies, SSL, API proxying, upload privacy, cron, queue delivery, and backups on staging.

Exit gate: selected-engine integration suite, migration checks, frontend build, and critical browser journeys all pass.

### Phase 8: Cut over and monitor

1. Put all writes behind maintenance protection; pause scheduler/queue writers and drain in-flight financial operations. Include admin actions, API clients, and provider callbacks in the freeze/replay plan.
2. Take final consistent backups and export/import the final frozen dataset. Repeat financial and file reconciliation.
3. Switch Laravel to the target database, keep Next.js pointed at the tested Laravel API, and rebuild configuration caches. Do not regenerate secrets.
4. Smoke-test while writes remain disabled. Re-enable the application and then one scheduler/queue setup after reconciliation.
5. Confirm hourly earnings/referral/swaps jobs cannot duplicate previously processed records, and monitor errors, locks, queue failures, balances, and slow queries.
6. Retain the old PostgreSQL snapshot read-only for the agreed rollback window.

Rollback rule: before new writes are enabled, restoring the previous release/database is straightforward. After the new database accepts writes, switching back to the old snapshot would discard transactions. Pause writes and reconcile or replay all new records before any rollback; prefer a forward repair where safe.

## 5. Hosting constraint

Laravel 12 plus MySQL/MariaDB does not by itself make this project deployable on every cPanel plan. The existing Next.js frontend requires a supported Node.js runtime or separate frontend hosting. Laravel requires the correct PHP extensions, web root set to `server/public`, writable private storage, and scheduled execution. Confirm those capabilities in Phase 1. Static export or a full Laravel frontend conversion would be additional scope.

## 6. Definition of done

- Laravel 12 and a compatible locked dependency set are installed and verified.
- The selected MySQL/MariaDB engine supports a complete fresh installation and existing-data import.
- Imported account/ledger, asset/reservation, investment/payout, and referral totals reconcile exactly.
- Private files and security material remain usable and protected.
- All existing frontend journeys remain connected to Laravel; no PostgreSQL dependency remains in the active application/build path.
- Financial concurrency/idempotency tests and critical browser journeys pass.
- cPanel configuration, cron/queue setup, backups, cutover procedure, and rollback conditions are recorded and rehearsed.
- The implementation is committed/pushed, with secrets, database exports, and customer uploads excluded.

## 7. Decisions still needed before production cutover

- Exact host database product/version, PHP/Node availability, and deployment topology.
- Which dataset is authoritative and must be retained; data preservation is the default.
- Maintenance window and who can authorize live cutover.
- Whether existing sessions should be preserved or users should log in again.

Development can begin with framework compatibility and portable schema work while hosting details are collected. Production data transfer waits for a verified target and a successful rehearsal.

## References

- Laravel 12 support policy: https://laravel.com/docs/12.x/releases#support-policy
- Laravel 12 database support/configuration: https://laravel.com/docs/12.x/database
- Laravel 13 changes to review in reverse: https://laravel.com/docs/13.x/upgrade
