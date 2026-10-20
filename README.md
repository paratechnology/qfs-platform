# QFS

QFS is a Next.js 15 and React 19 frontend with a Laravel API and PostgreSQL data store. The public site, user dashboard, and admin console remain in Next. Laravel handles authentication, account operations, admin APIs, earnings and wallet signature verification.

## Run locally

The current Windows workspace has a portable PostgreSQL cluster, PHP 8.4, Composer, and Tailscale Serve configured. Start the stack with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

Open [http://localhost:3000](http://localhost:3000). The Tailnet URL is [https://desktop-3agleec.tailf7d6a2.ts.net:8443/](https://desktop-3agleec.tailf7d6a2.ts.net:8443/). The Laravel API listens on `http://127.0.0.1:8000` and is reached by the frontend through Next rewrites. The local read-only preview login remains available; real accounts use the local PostgreSQL database.

For a fresh machine, follow [server/README.md](server/README.md). The [migration matrix](server/MIGRATION_MATRIX.md) lists every frontend API flow and the product placeholders still awaiting rules or content.

## Checks

```powershell
cd server
php artisan test
cd ..
npx tsc --noEmit
npm run build
```

Laravel's `QfsSeeder` adds only missing reference rows. The old Prisma seed deletes all accounts and ledger records and is disabled unless explicitly unlocked. Laravel now owns migrations, scheduled earnings, and wallet signature verification. The legacy Next handlers remain in the repository during the transition.

Crypto funding uses admin receiving wallets configured in `/admin/settings`. Supported assets are BTC, ETH, XRP, SOL and USDT on Tron or BNB Smart Chain. Users receive address/QR instructions, including XRP destination tags where configured; injected-wallet payments cover ETH and BEP20 USDT. Deposits credit exact quantities only after admin review. Investments allocate funds to a fixed USD principal without a blockchain transaction. Withdrawals reserve funds and require a manually completed external payout.

The dashboard's **Swap** action uses server quotes and reserved crypto balances. `/admin/swaps` manages exchange funding, settlement and recovery; `/admin/settings` maps provider assets to treasury wallets. The Changelly adapter uses authenticated fixed-rate quotes and settlement records. Live swaps are disabled until provider credentials and actual treasury wallets are configured. An optional external signer adapter supports automatic swap funding; manual admin funding is available without that signer. Automatic deposit monitoring and general withdrawal broadcasting remain separate integrations. See `server/IMPLEMENTATION_STATE.md` for configuration, accounting and verification details.

The admin console is at `/admin`. Signed-out admins use `/admin/login`; the former `/user/admin` URLs redirect to the shorter paths.

Account settings at `/user/user/dashboard/settings` support profile editing, password changes, device/session management and optional authenticator two-factor protection. Admins have the same controls at `/admin/security`. Enroll your own authenticator and save the single-use recovery codes; existing accounts are not enrolled automatically. Password recovery preserves any enabled second factor. Recovery delivery and queued account emails are wired to the mail configuration; production SMTP credentials/DNS and email verification remain to be configured.

Account statements at `/user/user/dashboard/statements` provide CSV and print/save-as-PDF exports. Selected-period activity uses UTC; balances and investment records are clearly labelled current snapshots. `/admin/reconciliation` checks internal reservations, latest ledger balances and completed swap records without changing balances. KYC review at `/admin/kyc` supports server search, filtering, pagination, private encrypted revision/document history and a reasoned reverification request. Earlier files deleted before this history update cannot be restored.

## Account flows

Registration creates the account and shows a confirmation with an explicit login link. It does not issue a session; users sign in with their email and password before accessing the dashboard. Login and registration forms stay available when a previous session is saved.

Crypto deposits can be submitted and manually approved without a transaction hash; withdrawal approvals also allow a blank hash. Admins can correct or clear a submitted deposit reference. Non-empty hashes are validated and protected against duplicate use; approval remains an explicit admin decision. Deposit QR codes use whole-pixel modules, a white quiet zone and a downloadable high-resolution SVG.

Active account and admin actions use visible pending states, guarded forms, persistent errors, outcome confirmations and relevant activity/support links. Financial messages distinguish submitted requests, reviewed decisions and recorded payouts. Investment, withdrawal and swap forms keep close/cancel/funding controls visible. Fund Account opens deposits with a return action that preserves the transaction draft. Administrators can edit display/contact details at `/admin/users`; changes require their current password, a second factor when enabled, and an audit reason. Changing a user’s email revokes that user’s sessions and old recovery links.

The dashboard review reel rotates published reviews in random order, with a cinematic text treatment every third slide. Authors and quotes stay paired. Playback pauses on hover, keyboard focus, open dialogs, hidden tabs and offscreen content; manual pause is remembered. Reduced-motion preferences disable autoplay. Empty review lists invite a moderated submission. No generated testimonials are inserted.

## Languages

The site uses local translation catalogs, with no runtime translation API or third-party translation script. All 21 registered languages are published: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Russian, Turkish, Arabic, Hindi, Bengali, Urdu, Simplified Chinese, Traditional Chinese, Japanese, Korean, Indonesian, Vietnamese and Thai. Each catalog covers all 1,716 current source messages. The selector publishes a language only when its catalog is complete.

Language selection is saved in an HTTP-only cookie and, for signed-in accounts, in the account preference. Browser language is used when there is no published saved choice. Arabic and Urdu use right-to-left layouts, including recovery emails and printable statements. Currency stays in USD. Amount entry accepts the supported native digit scripts while preserving exact crypto quantities and the submitted USD value. Pages receive only the selected language's common catalog and their public, account or admin section.

Edit source-keyed JSON files in `lib/i18n/translations/<locale>/`. Regenerate the source inventory with `node scripts/localization-extract.mjs` (without `--write`), then build catalogs with `node scripts/localization-catalogs.mjs`. The builder checks ICU arguments, currency/date formatting, Laravel validation placeholders and unresolved authoring tokens, and generates matching Next/Laravel catalogs plus the publication manifests. Run `node scripts/localization-catalogs.mjs --check` to verify all languages, and `node --import tsx --test tests/localization.test.mjs` for locale, plural, private-value and amount-entry checks.

The optional `scripts/localization-draft.py` authoring tool produces resumable drafts from public source strings through an external translation endpoint. It is never run by the application or build, and sends no customer records. Drafts were structurally checked and selectively refined for financial/security language; they have not undergone independent native-speaker review. Reviewed terminology and financial explanations are kept separately from the first-pass catalogs. Languages are published only by the catalog builder after validation.

Admins can publish reviewed plan descriptions, terms and risk disclosures in each language. English remains available beside the translation. Changing the English source makes an older translation unavailable for new purchases until it is reviewed again. Existing investments retain their recorded versions and financial conditions. PDFs, private messages and user-entered content retain their original language.

## Deployment

Deploy the Laravel API to a PHP host with PostgreSQL first. Set `LARAVEL_API_URL` for the Next frontend, share the session secret between both servers, and configure `QFS_ALLOWED_ORIGINS` for the frontend domain. The Netlify configuration builds the frontend only. The target domain is `https://q-arculuspro.live`; cPanel SMTP and deployment instructions are in `server/README.md`. Public DNS, HTTPS, the mailbox and the deployed Laravel/Next services still need hosting setup.

The previous full-stack Next implementation notes are archived in [docs/legacy-next-readme.md](docs/legacy-next-readme.md).
