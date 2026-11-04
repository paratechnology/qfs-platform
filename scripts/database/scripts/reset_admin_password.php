<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$email = strtolower(trim((string) env('ADMIN_EMAIL', 'admin@qfs.local')));
$password = (string) env('ADMIN_PASSWORD', '');

if ($email === '' || strlen($password) < 10) {
    fwrite(STDERR, "Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) in this application's .env\n");
    exit(1);
}

$user = DB::table('User')->where('email', $email)->first();
if ($user === null) {
    fwrite(STDERR, "No user found for {$email}\n");
    exit(1);
}

DB::table('User')->where('id', $user->id)->update([
    'passwordHash' => Hash::make($password, ['rounds' => 12]),
    'updatedAt' => now(),
]);

$hash = (string) DB::table('User')->where('id', $user->id)->value('passwordHash');
echo Hash::check($password, $hash) ? "Reset password for {$email}\n" : "Reset failed verification\n";
