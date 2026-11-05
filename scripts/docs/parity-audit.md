# Functionality parity — Laravel/Blade application

The original root Next.js UI and `server/` API are references. The maintained app is directly under `scripts/`, using its existing Blade/Alpine architecture and database.

| Area | Current implementation |
| --- | --- |
| Deposits | Bank and per-network crypto deposits, QR/download/address, optional hash, connected EVM wallet payment, admin review |
| Investments | USD or direct crypto funding quotes; USD principal fixed at confirmation; captured plan terms and private supporting documents |
| Swaps | Existing internal ledger conversions retained; destination balance usable immediately after completion; external provider workflow retained when configured |
| Withdrawals | USD/crypto source, available quantities after reservations, quote/review, stable references and admin approval/rejection |
| Portfolio | Separate active investments menu; captured terms, payout/principal dates, supporting documents, funding receipt and completed history |
| Cards | Account-scoped freeze/unfreeze/default controls |
| Reviews | Submission, moderation, approved list and existing animated reel; optional disclosed original sample catalog with 92/6/2 distribution |
| KYC | Private upload/admin review plus authorized previous-submission history on both user and admin views |
| Plans/documents | Admin document assignment, PDF upload, version-bound reviewed translations |
| Navigation | Notification loading/read actions, document links and selected transaction search links |
| Retained additions | SMTP admin controls, review images, wallet issue reporting, idle sessions, extra locale catalogs and crypto withdrawal setting |

Regression coverage: `BladeFunctionalityTest` covers the deposit → direct crypto investment → swap → investment → withdrawal lifecycle, duplicate investment confirmation, captured terms/documents, reviews and rendered pages. `tests/browser/financial-flows.test.mjs` exercises shipped Alpine logic. Existing backend tests retain financial concurrency, authorization, account recovery, SMTP and KYC coverage.

Provider integrations require real configured credentials and treasury settlement. Automated tests use controlled prices and isolated data; they do not execute a live blockchain transfer or prove SMTP delivery. Translation catalogs remain the imported app's catalogs; newly restored English copy uses the existing translation mechanism with English fallback.

## UI regression check — 5 November 2026

Compared the original root Next.js reference and maintained Blade application at 390 × 844 mobile and 1440 × 1000 desktop CSS viewports, using the same disposable SQLite fixture and controlled prices. Browser scrollbar cropping changes some image dimensions; this is a targeted functional/visual comparison, not a claim of pixel identity across every route.

- Restored login field spacing and circular loading spinner; successful sign-in hides the spinner. Registration success is readable on the dark card and requires an explicit login.
- Language selectors retain full names on mobile. Added Hungarian core UI translations (English fallback for remaining strings), bringing the selector to 35 languages. Guest selection now persists in a cookie; authenticated selection also updates only that account.
- Direct crypto investment accepts USD or crypto quantity, shows available USD equivalents and exact-unit conversion estimates, then reviews an authoritative expiring quote. USD principal remains fixed at confirmation. Current plan terms and documents are available before confirmation; existing investments retain captured terms.
- Admin users show contacts, crypto balances and restored bulk adjustments. Account edit includes the password/reason/code required by the API. Protected deletion removes access and sessions while retaining financial and audit history; self-deletion is blocked.
- Fixed multi-root Alpine conditionals that silently discarded review navigation, funding activity, SMTP fields, swap route configuration and the logout label. All rendered dashboard and admin templates now have structural regression checks. Removed duplicate Alpine initialization that caused repeated loads.
- Fixed plan selection styling so reactive border/background changes preserve padding, radius and layout. Added selected-state accessibility.
- Combined sidebar valuation follows the funded portfolio. Mobile admin header and filters no longer overlap.

Verification: 221 PHP tests (3,146 assertions) and 19 JavaScript component checks passed. Browser checks confirmed review navigation/list, USD/crypto investment quotes, registration/login, full language names/Hungarian selection, admin user controls and visible SMTP/swap configuration. No real financial transaction, account deletion or SMTP delivery was performed. No schema migration or real database reset was required.
