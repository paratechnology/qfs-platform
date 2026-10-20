<?php

namespace App\Http\Middleware;

use App\Support\Api;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class VerifyFrontendOrigin
{
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->method(), ['POST', 'PATCH', 'PUT', 'DELETE'], true)) {
            $allowed = array_filter(array_map('trim', explode(',', (string) config('qfs.allowed_origins'))));
            $allowed[] = $request->getSchemeAndHttpHost();
            $source = $request->header('Origin') ?: $request->header('Referer');
            if ($source) {
                $parts = parse_url($source);
                $origin = isset($parts['scheme'], $parts['host'])
                    ? $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '') : '';
                if (!in_array($origin, $allowed, true)) return Api::error('CSRF', 'Cross-origin request blocked', 403);
            } elseif (!in_array($request->header('Sec-Fetch-Site'), [null, 'same-origin', 'none'], true)) {
                return Api::error('CSRF', 'Cross-origin request blocked', 403);
            }
        }
        return $next($request);
    }
}
