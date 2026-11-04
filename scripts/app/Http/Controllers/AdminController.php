<?php

namespace App\Http\Controllers;

use App\Support\SessionAuth;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Serves the Blade admin console. The overview's stats are rendered server-side
 * (reusing AdminReadController); list/content pages fetch /api/admin/* in the
 * browser. Access is gated by the RequireAdmin middleware.
 */
final class AdminController
{
    /** Pages that render inside the admin shell besides the overview. */
    public const PAGES = [
        'users', 'kyc', 'requests', 'transactions', 'swaps', 'plans', 'investments',
        'loans', 'documents', 'reviews', 'markets', 'wallet-issues', 'settings', 'security', 'reconciliation', 'audit',
    ];

    public function overview(Request $request): View
    {
        $stats = app(AdminReadController::class)->stats($request)->getData(true)['data'] ?? [];

        return $this->render($request, 'overview', ['stats' => $stats]);
    }

    public function show(Request $request, string $page): View
    {
        abort_unless(in_array($page, self::PAGES, true), 404);

        return $this->render($request, $page);
    }

    private function render(Request $request, string $page, array $data = []): View
    {
        $user = SessionAuth::user($request);

        return view('admin.'.$page, array_merge([
            'adminUser' => SessionAuth::publicUser($user),
            'page' => $page,
        ], $data));
    }
}
