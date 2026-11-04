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
