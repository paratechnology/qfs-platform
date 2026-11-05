<?php

declare(strict_types=1);
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

if (getenv('APP_ENV') !== 'testing' || ! str_ends_with((string) getenv('DB_DATABASE'), '_test.sqlite')) {
    http_response_code(403);
    exit('A disposable browser test database is required.');
}

$root = dirname(__DIR__, 2);
$public = realpath($root.'/public');
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$file = realpath($public.$path);
if ($file && str_starts_with($file, $public.DIRECTORY_SEPARATOR) && is_file($file)
    && ! str_ends_with(strtolower($file), '.php')) {
    return false;
}

define('LARAVEL_START', microtime(true));
require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
config()->set('filesystems.disks.local.root', dirname((string) getenv('DB_DATABASE')).'/private');
Http::preventStrayRequests();
$prices = [];
foreach (['bitcoin' => 100000, 'ethereum' => 2000, 'tether' => 1, 'ripple' => 2, 'solana' => 100] as $coin => $rate) {
    $prices[$coin] = ['usd' => $rate, 'last_updated_at' => time()];
}
Http::fake([
    'api.coingecko.com/*' => Http::response($prices),
    '*' => Http::response([]),
]);
$app->handleRequest(Request::capture());
