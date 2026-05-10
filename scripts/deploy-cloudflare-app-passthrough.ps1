# Deploy passthrough worker so app.bokito.ai uses DNS origin (see cloudflare-workers/bokito-app-passthrough/README.md).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workerDir = Join-Path $root "cloudflare-workers\bokito-app-passthrough"

if (-not (Test-Path $workerDir)) {
  throw "Worker directory not found: $workerDir"
}

Push-Location $workerDir
try {
  npx --yes wrangler deploy
} finally {
  Pop-Location
}
