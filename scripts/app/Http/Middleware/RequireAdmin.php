<?php

namespace App\Http\Middleware;

use App\Support\SessionAuth;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate Blade admin pages. Signed-out visitors go to the admin login; signed-in
 * non-admins are sent to their user dashboard.
 */
final class RequireAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = SessionAuth::user($request);
        if (! $user) {
            return redirect()->guest('/admin/login');
        }
        if ($user->role !== 'ADMIN') {
            return redirect('/user/user/dashboard');
        }

        return $next($request);
    }
}
