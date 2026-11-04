<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\DashboardController;
use App\Http\Middleware\RequireAdmin;
use App\Http\Middleware\RequireSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::view('/', 'home')->name('home');

/*
 * Blade auth pages. These render static views; the forms post to the JSON API
 * under /api/auth/* (see routes/api.php), which sets the qfs_session cookie.
 */
Route::view('/user/user/login', 'auth.login')->name('login');
Route::view('/user/user/register', 'auth.register')->name('register');
Route::get('/register', function (Request $request) {
    $query = $request->getQueryString();

    return redirect('/user/user/register'.($query ? '?'.$query : ''));
})->name('register.short');
Route::view('/admin/login', 'auth.admin-login')->name('admin.login');
Route::view('/forgot-password', 'auth.recover', ['reset' => false])->name('password.request');
Route::view('/reset-password', 'auth.recover', ['reset' => true])->name('password.reset');

/*
 * Account dashboard (Blade). Guarded by the qfs_session cookie; the overview is
 * rendered server-side, per-view data is fetched from /api/* in the browser.
 */
Route::middleware(RequireSession::class)->group(function () {
    Route::get('/user/user/dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/user/user/dashboard/{view}', [DashboardController::class, 'show'])->name('dashboard.view');
    Route::view('/user/user/connect', 'connect')->name('connect');
});

/*
 * Admin console (Blade). Gated by RequireAdmin; /admin/login stays public above.
 */
Route::middleware(RequireAdmin::class)->group(function () {
    Route::get('/admin', [AdminController::class, 'overview'])->name('admin');
    Route::get('/admin/{page}', [AdminController::class, 'show'])
        ->whereIn('page', AdminController::PAGES)->name('admin.page');
});
