# Runs the local FastAPI with hot reload against LIVE prod data (via the tunnel).
# Start scripts/dev/prod-tunnel.ps1 in another terminal FIRST.
#
# Loads apps/api/.env.prodbridge as OS env (overrides apps/api/.env), so your
# regular local .env is left untouched.

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$apiDir = Join-Path $repoRoot "apps\api"
$envFile = Join-Path $apiDir ".env.prodbridge"

if (-not (Test-Path $envFile)) { throw "Bridge env not found: $envFile" }

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1)
    Set-Item -Path "env:$name" -Value $val
}

Write-Host "Bridge env loaded. DATABASE_URL -> $($env:DATABASE_URL)"
Write-Host "LLM_MODE=$($env:LLM_MODE)  SCHEDULER=$($env:TRIGGER_SCHEDULER_ENABLED)  EMAIL_SYNC=$($env:EMAIL_SYNC_ENABLED)"
Write-Host "WARNING: writes hit PRODUCTION data. Sending a suggestion sends a REAL email." -ForegroundColor Yellow

$py = Join-Path $apiDir ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

Push-Location $apiDir
try {
    & $py -m uvicorn app.main:app --reload --host 127.0.0.1 --port $Port
}
finally {
    Pop-Location
}
