<?php

declare(strict_types=1);

/**
 * PHP built-in server router. Keep the document root restricted to public/.
 * Usage: php -S 127.0.0.1:8080 -t public dev-router.php
 */
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$publicRoot = realpath(__DIR__.'/public');
$static = realpath($publicRoot.$uri);

if ($uri !== '/' && $static !== false && str_starts_with($static, $publicRoot.DIRECTORY_SEPARATOR) && is_file($static)
    && ! str_ends_with(strtolower($static), '.php') && ! preg_match('~(^|[/\\\\])\.~', $uri)) {
    $ext = strtolower(pathinfo($static, PATHINFO_EXTENSION));
    $mime = match ($ext) {
        'css' => 'text/css; charset=UTF-8',
        'js' => 'application/javascript; charset=UTF-8',
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'woff2' => 'font/woff2',
        'woff' => 'font/woff',
        'json' => 'application/json',
        'txt' => 'text/plain; charset=UTF-8',
        default => 'application/octet-stream',
    };
    header('Content-Type: '.$mime);
    header('Content-Length: '.(string) filesize($static));
    readfile($static);

    return true;
}

require __DIR__.'/index.php';
