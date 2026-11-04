<?php

return [
    // Share sessions with the Next server-rendered frontend.
    'session_secret' => env('QFS_SESSION_SECRET'),
    /** Sign out after this many minutes without API/page activity (0 = disabled). */
    'session_idle_minutes' => (int) env('QFS_SESSION_IDLE_MINUTES', 30),
    'crypto_withdrawals_enabled' => env('QFS_CRYPTO_WITHDRAWALS', true),
    'public_url' => env('QFS_PUBLIC_URL', 'https://q-arculuspro.live'),
    'support_email' => env('QFS_SUPPORT_EMAIL', 'support@q-arculuspro.live'),
    'account_emails' => env('QFS_ACCOUNT_EMAILS', false),
    'illustrative_reviews' => env('QFS_ILLUSTRATIVE_REVIEWS', false),
    'allowed_origins' => env('QFS_ALLOWED_ORIGINS', ''),
    'cron_secret' => env('CRON_SECRET', ''),
    'coingecko_demo_key' => env('COINGECKO_DEMO_API_KEY', ''),
    'dev_login' => env('QFS_DEV_LOGIN', false),
    'dev_login_email' => env('QFS_DEV_LOGIN_EMAIL', ''),
    'dev_login_password' => env('QFS_DEV_LOGIN_PASSWORD', ''),
];
