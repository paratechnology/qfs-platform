<?php

declare(strict_types=1);
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$dbPath = sys_get_temp_dir().DIRECTORY_SEPARATOR.'qfs_mysql_schema_'.bin2hex(random_bytes(4)).'.sqlite';
touch($dbPath);

putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE='.$dbPath);
putenv('DB_FOREIGN_KEYS=false');
$_ENV['DB_CONNECTION'] = 'sqlite';
$_ENV['DB_DATABASE'] = $dbPath;
$_ENV['DB_FOREIGN_KEYS'] = 'false';
config(['database.default' => 'sqlite']);
config(['database.connections.sqlite.database' => $dbPath]);
config(['database.connections.sqlite.foreign_key_constraints' => false]);
DB::purge('sqlite');

$php = PHP_BINARY;
$artisan = base_path('artisan');
$command = escapeshellarg($php).' '.escapeshellarg($artisan).' migrate --no-interaction --force 2>&1';
shell_exec($command);

$pdo = new PDO('sqlite:'.$dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$objects = $pdo->query("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT IN ('sqlite_sequence') ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name")->fetchAll(PDO::FETCH_ASSOC);

$tables = [];
$indexes = [];
foreach ($objects as $object) {
    $name = (string) ($object['name'] ?? '');
    if ($name === '') {
        continue;
    }
    $sql = trim((string) ($object['sql'] ?? ''));
    if ($sql === '') {
        continue;
    }
    $mysql = sqliteCreateToMysql($sql);
    if (($object['type'] ?? '') === 'table') {
        $tables[$name] = $mysql;
    } else {
        $indexes[] = $mysql;
    }
}

$tables = mergeIndexesIntoTables($tables, $indexes);
$statements = sortTablesByForeignKeys($tables);

$outPath = database_path('qfs-schema.mysql.sql');
$header = implode("\n", [
    '-- QFS platform schema (MySQL / MariaDB)',
    '-- Snapshot of all tables and indexes after `php artisan migrate`',
    '-- Generated: '.gmdate('Y-m-d H:i:s').' UTC',
    '--',
    '-- Prefer on live servers: php artisan migrate && php artisan db:seed',
    '-- Regenerate: php database/scripts/build_mysql_schema.php',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
]);
$body = implode("\n\n", array_map(static fn (string $sql): string => rtrim($sql, ';').';', $statements));
$footer = "\nSET FOREIGN_KEY_CHECKS = 1;\n";

file_put_contents($outPath, $header.$body."\n\n".$footer);
@unlink($dbPath);
foreach ([$dbPath.'-wal', $dbPath.'-shm'] as $sidecar) {
    if (is_file($sidecar)) {
        @unlink($sidecar);
    }
}

echo 'Wrote '.$outPath.' ('.count($statements)." objects)\n";

/**
 * @param  array<string, string>  $tables
 * @return list<string>
 */
function sortTablesByForeignKeys(array $tables): array
{
    /** @var array<string, list<string>> $dependsOn */
    $dependsOn = [];
    foreach ($tables as $name => $sql) {
        $refs = [];
        if (preg_match_all('/foreign key\([^)]+\) references `([^`]+)`/i', $sql, $matches)) {
            foreach ($matches[1] as $ref) {
                if ($ref !== $name) {
                    $refs[] = $ref;
                }
            }
        }
        $dependsOn[$name] = array_values(array_unique($refs));
    }

    $sorted = [];
    $pending = $tables;
    while ($pending !== []) {
        $progress = false;
        foreach (array_keys($pending) as $name) {
            $ready = true;
            foreach ($dependsOn[$name] as $ref) {
                if (isset($pending[$ref])) {
                    $ready = false;
                    break;
                }
            }
            if ($ready) {
                $sorted[] = $pending[$name];
                unset($pending[$name]);
                $progress = true;
            }
        }
        if (! $progress) {
            foreach ($pending as $sql) {
                $sorted[] = $sql;
            }
            break;
        }
    }

    return $sorted;
}

/**
 * @param  array<string, string>  $tables
 * @param  list<string>  $indexes
 * @return array<string, string>
 */
function mergeIndexesIntoTables(array $tables, array $indexes): array
{
    foreach ($indexes as $indexSql) {
        if (! preg_match('/^CREATE (UNIQUE )?INDEX `([^`]+)` on `([^`]+)` \((.+)\)\s*$/i', $indexSql, $matches)) {
            continue;
        }
        if (str_starts_with(strtolower($matches[2]), 'sqlite_')) {
            continue;
        }
        $tableName = $matches[3];
        if (! isset($tables[$tableName])) {
            continue;
        }
        $keyType = $matches[1] !== '' ? 'UNIQUE KEY' : 'KEY';
        $keyClause = ', '.$keyType.' `'.$matches[2].'` ('.$matches[4].')';
        $tables[$tableName] = appendIndexBeforeTableEngine($tables[$tableName], $keyClause);
    }

    return $tables;
}

function appendIndexBeforeTableEngine(string $tableSql, string $keyClause): string
{
    $engineSuffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    if (! str_ends_with($tableSql, $engineSuffix)) {
        return $tableSql;
    }

    $enginePos = strlen($tableSql) - strlen($engineSuffix);
    if ($enginePos < 1 || $tableSql[$enginePos - 1] !== ')') {
        return $tableSql;
    }

    return substr($tableSql, 0, $enginePos - 1).$keyClause.')'.substr($tableSql, $enginePos);
}

function sqliteCreateToMysql(string $sql): string
{
    $sql = preg_replace('/"{3,}([^"]+)"{3,}/', '"$1"', $sql) ?? $sql;
    $sql = preg_replace_callback(
        '/references "([A-Za-z_][A-Za-z0-9_]*)"\\("([A-Za-z_][A-Za-z0-9_]*)"\\)/i',
        static fn (array $m): string => 'references `'.$m[1].'`(`'.$m[2].'`)',
        $sql,
    ) ?? $sql;
    $sql = preg_replace_callback(
        '/"([A-Za-z_][A-Za-z0-9_]*)"/',
        static fn (array $m): string => '`'.$m[1].'`',
        $sql,
    ) ?? $sql;
    $sql = preg_replace('/default\s+\(\s*\'([^\']*)\'\s*\)/i', "default '$1'", $sql) ?? $sql;
    $sql = preg_replace('/default\s+\(\s*CURRENT_TIMESTAMP\s*\)/i', 'default CURRENT_TIMESTAMP', $sql) ?? $sql;

    $sql = preg_replace_callback(
        '/\bvarchar\b(?!\()/i',
        static fn (): string => 'varchar(255)',
        $sql,
    ) ?? $sql;

    $sql = preg_replace('/\binteger\b/i', 'int', $sql) ?? $sql;

    $sql = preg_replace(
        '/`id` int primary key autoincrement not null/i',
        '`id` bigint unsigned not null auto_increment primary key',
        $sql,
    ) ?? $sql;

    $sql = preg_replace(
        '/\bdatetime\b(?!\()/i',
        'datetime',
        $sql,
    ) ?? $sql;

    if (preg_match('/^create table `/i', $sql) && ! preg_match('/engine\s*=/i', $sql)) {
        $sql = rtrim($sql).' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    }

    return $sql;
}
