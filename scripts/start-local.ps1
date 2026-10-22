param([switch]$NoTailscale)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $env:LOCALAPPDATA 'qfs-runtime'
if (-not (Test-Path -LiteralPath $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }

function Test-Port([int]$Port) {
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $connected = $result.AsyncWaitHandle.WaitOne(500)
        if ($connected) { $client.EndConnect($result) }
        $client.Dispose()
        return $connected
    } catch { return $false }
}


$php = (Get-Command php.exe -ErrorAction SilentlyContinue).Source
if (-not $php) {
    $php = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe'
}
if (-not (Test-Path -LiteralPath $php)) { throw 'PHP 8.4 or newer with PDO SQLite is required locally.' }

@'
<?php
if (PHP_VERSION_ID < 80400 || !extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, 'Local SQLite requires PHP 8.4+ with PDO SQLite.');
    exit(1);
}
'@ | & $php
if ($LASTEXITCODE -ne 0) { throw 'PHP SQLite requirements are not met.' }

$localDatabase = Join-Path $project 'server/database/database.sqlite'
if (-not (Test-Path -LiteralPath $localDatabase)) { New-Item -ItemType File -Path $localDatabase | Out-Null }
Push-Location (Join-Path $project 'server')
try {
    & $php artisan migrate --force --no-interaction
    if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed.' }
} finally { Pop-Location }

if (-not (Test-Port 8000)) {
    Start-Process -FilePath $php -ArgumentList 'artisan','serve','--host=127.0.0.1','--port=8000' `
        -WorkingDirectory (Join-Path $project 'server') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtime 'laravel.out.log') `
        -RedirectStandardError (Join-Path $runtime 'laravel.err.log')
}

$scheduleRunning = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'php.exe' -and $_.CommandLine -like '*artisan schedule:work*'
}
if (-not $scheduleRunning) {
    Start-Process -FilePath $php -ArgumentList 'artisan','schedule:work' `
        -WorkingDirectory (Join-Path $project 'server') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtime 'schedule.out.log') `
        -RedirectStandardError (Join-Path $runtime 'schedule.err.log')
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is missing.' }
if (-not (Test-Port 3000)) {
    Start-Process -FilePath $node -ArgumentList (Join-Path $project 'node_modules\next\dist\bin\next'),'dev','--hostname','0.0.0.0' `
        -WorkingDirectory $project -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtime 'next.out.log') `
        -RedirectStandardError (Join-Path $runtime 'next.err.log')
}

Write-Output 'QFS frontend: http://localhost:3000'
Write-Output 'Laravel API:  http://127.0.0.1:8000'
Write-Output 'Local database: SQLite (no database service required)'
if (-not $NoTailscale -and (Get-Command tailscale.exe -ErrorAction SilentlyContinue)) {
    & tailscale.exe serve status
}
