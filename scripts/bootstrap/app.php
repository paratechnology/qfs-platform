<?php

use App\Http\Middleware\SetLanguage;
use App\Http\Middleware\VerifyFrontendOrigin;
use App\Support\Api;
use App\Support\SwapProviderException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(
            at: ['127.0.0.1', '::1'],
            headers: Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO,
        );
        $middleware->web(append: [SetLanguage::class]);
        $middleware->api(append: [SetLanguage::class, VerifyFrontendOrigin::class]);
        // qfs_session / qfs_locale are set raw by the API; keep the web group
        // from encrypting (and thus dropping) them so Blade pages can read them.
        $middleware->encryptCookies(except: ['qfs_session', 'qfs_locale']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (SwapProviderException $error, Request $request) {
            return Api::error('SWAP_PROVIDER', $error->getMessage(), 503);
        });
        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->is('api/*')) {
                return Api::error('BAD_REQUEST', $e->validator->errors()->first(), 400);
            }
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
