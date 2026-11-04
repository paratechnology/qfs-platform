<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$adminEmail = strtolower(trim((string) env('ADMIN_EMAIL', '')));
$adminPassword = (string) env('ADMIN_PASSWORD', '');
if (! filter_var($adminEmail, FILTER_VALIDATE_EMAIL) || strlen($adminPassword) < 10) {
    fwrite(STDERR, "Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 characters) before generating an installation.\n");
    exit(1);
}

$schemaPath = database_path('qfs-schema.mysql.sql');
if (! is_file($schemaPath)) {
    passthru(PHP_BINARY.' '.escapeshellarg(base_path('database/scripts/build_mysql_schema.php')), $code);
    if ($code !== 0 || ! is_file($schemaPath)) {
        fwrite(STDERR, "Could not build qfs-schema.mysql.sql\n");
        exit(1);
    }
}

$dbPath = sys_get_temp_dir().DIRECTORY_SEPARATOR.'qfs_install_'.bin2hex(random_bytes(4)).'.sqlite';
touch($dbPath);

putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE='.$dbPath);
putenv('DB_FOREIGN_KEYS=false');
putenv('ADMIN_EMAIL='.$adminEmail);
putenv('ADMIN_PASSWORD='.$adminPassword);
$_ENV['DB_CONNECTION'] = 'sqlite';
$_ENV['DB_DATABASE'] = $dbPath;
$_ENV['DB_FOREIGN_KEYS'] = 'false';
$_ENV['ADMIN_EMAIL'] = $adminEmail;
$_ENV['ADMIN_PASSWORD'] = $adminPassword;
config(['database.default' => 'sqlite']);
config(['database.connections.sqlite.database' => $dbPath]);
config(['database.connections.sqlite.foreign_key_constraints' => false]);
DB::purge('sqlite');

Artisan::call('migrate:fresh', ['--force' => true]);
Artisan::call('db:seed', ['--force' => true]);

$pdo = DB::connection('sqlite')->getPdo();
$tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);

$insertOrder = ['User', 'Account', 'InvestmentPlan', 'MarketAsset', 'Setting', 'migrations'];
$orderedTables = array_values(array_unique([...$insertOrder, ...$tables]));

$dataSql = [];
foreach ($orderedTables as $table) {
    if (! in_array($table, $tables, true)) {
        continue;
    }
    $rows = $pdo->query('SELECT * FROM "'.$table.'"')->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        continue;
    }
    $columns = array_map(static fn (string $c): string => '`'.$c.'`', array_keys($rows[0]));
    foreach ($rows as $row) {
        $parts = [];
        foreach ($row as $value) {
            $parts[] = sqlLiteral($value);
        }
        $dataSql[] = 'INSERT INTO `'.$table.'` ('.implode(', ', $columns).') VALUES ('.implode(', ', $parts).');';
    }
}

$schemaBody = trim((string) file_get_contents($schemaPath));
$schemaBody = preg_replace('/\s*SET FOREIGN_KEY_CHECKS = 1;\s*$/', '', $schemaBody) ?? $schemaBody;
$schemaBody = preg_replace('/^-- QFS platform schema.*?(?=^SET NAMES utf8mb4;)/ms', '', $schemaBody) ?? $schemaBody;
$schemaBody = trim($schemaBody);

$eol = "\r\n";
if (preg_match_all('/CREATE TABLE `([^`]+)`/', $schemaBody, $tableMatches)) {
    $drops = implode($eol, array_map(
        static fn (string $table): string => 'DROP TABLE IF EXISTS `'.$table.'`;',
        array_reverse($tableMatches[1]),
    ));
    $schemaBody = preg_replace(
        '/(SET FOREIGN_KEY_CHECKS = 0;\s*)/',
        '$1'.$drops.$eol.$eol,
        $schemaBody,
        1,
    ) ?? $schemaBody;
}

$outPath = database_path('qfs-install.mysql.sql');
$lines = [
    '-- QFS platform: schema + reference seed + admin account',
    '-- Generated: '.gmdate('Y-m-d H:i:s').' UTC',
    '--',
    '-- Admin login (change the password after import):',
    '--   Email:    '.$adminEmail,
    '--   Password: '.$adminPassword,
    '--',
    '-- phpMyAdmin (cPanel):',
    '--   1. cPanel -> MySQL Databases: create DB + user, add user to DB (ALL PRIVILEGES).',
    '--   2. phpMyAdmin: click YOUR database name on the left (not SQL, not home).',
    '--   3. Top tab: Import -> Choose file: qfs-install.mysql.sql -> Format SQL -> Go.',
    '--   4. Do not use the SQL tab or copy/paste; Import runs the whole file safely.',
    '--   5. Success: green check. Then set server/.env DB_DATABASE, DB_USERNAME, DB_PASSWORD.',
    '--   6. On shared hosting set DB_COLLATION=utf8mb4_unicode_ci to match this dump.',
    '--',
    '-- Local MySQL only (optional):',
    '--   CREATE DATABASE IF NOT EXISTS `qfs` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;',
    '--   USE `qfs`;',
    '--',
    $schemaBody,
    '',
    '-- Seed data',
    '',
    ...$dataSql,
    '',
    'SET FOREIGN_KEY_CHECKS = 1;',
    '',
];

file_put_contents($outPath, implode($eol, $lines));

@unlink($dbPath);
foreach ([$dbPath.'-wal', $dbPath.'-shm'] as $sidecar) {
    if (is_file($sidecar)) {
        @unlink($sidecar);
    }
}

echo 'Wrote '.$outPath.' ('.count($dataSql)." tables with data)\n";

function sqlLiteral(mixed $value): string
{
    if ($value === null) {
        return 'NULL';
    }
    $text = (string) $value;
    if (str_starts_with($text, '#')) {
        return "CONCAT('#', '".mysqlString(substr($text, 1))."')";
    }

    return "'".mysqlString($text)."'";
}

function mysqlString(string $value): string
{
    return str_replace(['\\', "'"], ['\\\\', "''"], $value);
}
