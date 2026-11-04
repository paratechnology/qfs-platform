<?php

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

echo 'connection: '.config('database.default').PHP_EOL;
echo 'database: '.config('database.connections.'.config('database.default').'.database').PHP_EOL;

$keys = DB::table('Setting')->where('key', 'like', 'mail_%')->orderBy('key')->get(['key', 'value']);
echo 'mail_* rows: '.$keys->count().PHP_EOL;
foreach ($keys as $row) {
    $display = $row->key === 'mail_smtp_password' ? (strlen((string) $row->value) ? '(set)' : '(empty)') : $row->value;
    echo "  {$row->key}: {$display}".PHP_EOL;
}
if ($keys->isEmpty()) {
    echo '  (none — add via Admin → Settings → Email & SMTP)'.PHP_EOL;
}
