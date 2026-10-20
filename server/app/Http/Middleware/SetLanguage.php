<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class SetLanguage
{
    public const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'hi', 'bn', 'ur', 'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'vi', 'th'];

    /** @return list<string> */
    public static function available(): array
    {
        return require lang_path('available.php');
    }

    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $languages = self::available();
        $saved = $request->cookie('qfs_locale');
        $locale = in_array($saved, $languages, true) ? $saved : null;
        if ($locale === null) {
            foreach ($request->getLanguages() as $language) {
                $tag = strtolower(str_replace('_', '-', $language));
                if ($tag === 'zh' || str_starts_with($tag, 'zh-')) {
                    $chinese = preg_match('/tw|hk|mo|hant/', $tag) ? 'zh-TW' : 'zh-CN';
                    if (in_array($chinese, $languages, true)) {
                        $locale = $chinese;
                        break;
                    }

                    continue;
                }
                $base = explode('-', $tag)[0];
                if (in_array($base, $languages, true)) {
                    $locale = $base;
                    break;
                }
            }
        }
        app()->setLocale($locale ?? 'en');
        $response = $next($request);
        $response->headers->set('Content-Language', app()->getLocale());

        return $response;
    }
}
