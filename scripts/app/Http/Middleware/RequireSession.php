<?php

namespace App\Http\Middleware;

use App\Support\SessionAuth;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate Blade pages behind a valid qfs_session cookie. Unauthenticated visitors
 * are redirected to the login page instead of seeing a JSON 401.
 */
final class RequireSession
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! SessionAuth::user($request) && ! SessionAuth::devUser($request)) {
            return redirect()->guest('/user/user/login');
        }

        return $next($request);
    }
}
