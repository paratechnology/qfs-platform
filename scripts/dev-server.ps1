# Laravel + Blade development. Only public/ is web-accessible.
$Php = $env:QFS_PHP
if (-not $Php) { $Php = (Get-Command php -ErrorAction Stop).Source }
& $Php -r 'exit(version_compare(PHP_VERSION, "8.2.12", ">=") && extension_loaded("pdo_sqlite") ? 0 : 1);'
if ($LASTEXITCODE -ne 0) { throw "PHP 8.2.12+ with PDO SQLite is required. Set QFS_PHP to its executable." }
$listenHost = "127.0.0.1"
$port = if ($env:QFS2_PORT) { $env:QFS2_PORT } else { "8080" }
$root = $PSScriptRoot
Write-Host "QFS: http://${listenHost}:${port}/"
& $Php -S "${listenHost}:${port}" -t "$root\public" "$root\dev-router.php"
