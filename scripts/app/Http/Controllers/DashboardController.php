<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Serves the Blade account dashboard. Data is pulled from the existing JSON API
 * controllers (reused server-side) so there is a single source of truth.
 */
final class DashboardController
{
    /** Views that render inside the dashboard shell besides the overview. */
    private const VIEWS = ['investments', 'transactions', 'withdrawals', 'loans', 'verification', 'settings', 'statements'];

    public function index(Request $request): View
    {
        return view('dashboard.index', [
            'overview' => $this->overview($request),
            'view' => 'dashboard',
        ]);
    }

    public function show(Request $request, string $view): View
    {
        if (! in_array($view, self::VIEWS, true)) {
            abort(404);
        }

        $data = ['overview' => $this->overview($request), 'view' => $view];
        if ($view === 'investments') {
            $data['investmentHistory'] = app(InvestmentLifecycleController::class)->history($request)->getData(true)['data'];
        }

        return view('dashboard.index', $data);
    }

    /** Reuse OverviewController to assemble the dashboard payload (array form). */
    private function overview(Request $request): array
    {
        $payload = app(OverviewController::class)->show($request)->getData(true);

        return $payload['data'] ?? [];
    }
}
