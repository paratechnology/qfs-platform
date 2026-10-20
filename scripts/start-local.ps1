param([switch]$NoTailscale)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $env:LOCALAPPDATA 'qfs-postgres-runtime'
$pgCtl = Join-Path $runtime 'pgsql\bin\pg_ctl.exe'
$pgData = Join-Path $runtime 'data'

if (-not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath $pgData)) {
    throw 'Local PostgreSQL is missing. Install it and configure server/.env before starting QFS.'
}

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

if (-not (Test-Port 5432)) {
    & $pgCtl -D $pgData -l (Join-Path $runtime 'postgres.log') -o '-h 127.0.0.1 -p 5432' start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start.' }
}

$php = (Get-Command php.exe -ErrorAction SilentlyContinue).Source
if (-not $php) {
    $php = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe'
}
if (-not (Test-Path -LiteralPath $php)) { throw 'PHP 8.4 is missing.' }

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
if (-not $NoTailscale -and (Get-Command tailscale.exe -ErrorAction SilentlyContinue)) {
    & tailscale.exe serve status
}
