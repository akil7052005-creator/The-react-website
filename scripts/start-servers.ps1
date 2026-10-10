# Starts everything for local development: the database, then the API, web app and tunnel under pm2.
# Safe to run again (running servers are left alone). Also run at Windows login by the shortcut that
#   powershell -File scripts/start-servers.ps1 -InstallStartup
# puts in the Startup folder (-RemoveStartup takes it out).
param([switch]$InstallStartup, [switch]$RemoveStartup)

$root = Split-Path -Parent $PSScriptRoot
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Wedmanage servers.cmd'

if ($RemoveStartup) {
  Remove-Item $startup -ErrorAction SilentlyContinue
  Write-Output 'Removed from Windows startup.'
  exit 0
}
if ($InstallStartup) {
  Set-Content -Path $startup -Encoding ascii -Value "@start `"`" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  Write-Output "Added to Windows startup: $startup"
}

Set-Location $root
# 1. Database (port 5433); returns once it accepts connections.
node scripts/local-db.mjs start
# 2. The shared package the API imports.
Push-Location packages/shared; npx tsc -p tsconfig.build.json; Pop-Location
# 3. API, web app and tunnel. Already running ones are kept.
$pm2 = (Get-Command pm2 -ErrorAction SilentlyContinue).Source
if (-not $pm2) { $pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd' }
# `pm2 pid <name>` prints the process id, or 0 / nothing when it isn't running. (pm2 jlist can't be
# read here: Windows PowerShell's ConvertFrom-Json rejects its USERNAME/username keys.)
$missing = @('api-build', 'api', 'web', 'tunnel') | Where-Object { [int]("0" + (& $pm2 pid $_ 2>$null | Select-Object -Last 1)) -le 0 }
if ($missing) {
  # Only the ones not running: starting a running app from the config would restart it.
  foreach ($name in $missing) { & $pm2 delete $name 2>$null | Out-Null }
  & $pm2 start (Join-Path $root 'ecosystem.config.cjs') --only ($missing -join ',')
}
& $pm2 save --force | Out-Null
& $pm2 status
