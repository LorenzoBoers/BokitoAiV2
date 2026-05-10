# Deploy passthrough worker so app.bokito.ai uses DNS origin (see cloudflare-workers/bokito-app-passthrough/README.md).
param(
  [string]$ApiToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "cloudflare-workers\bokito-app-passthrough"

function Initialize-EnvFromDotEnv {
  param([string]$DotEnvPath)
  if (-not (Test-Path -LiteralPath $DotEnvPath)) { return }
  $lines = Get-Content -LiteralPath $DotEnvPath -ErrorAction Stop
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Length -ne 2) { continue }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ([string]::IsNullOrWhiteSpace($key)) { continue }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

Initialize-EnvFromDotEnv -DotEnvPath (Join-Path $root ".env")

if (-not (Test-Path $workerDir)) {
  throw "Worker directory not found: $workerDir"
}

$token = $ApiToken.Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN")
}
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = [Environment]::GetEnvironmentVariable("CF_API_TOKEN")
}
if (-not [string]::IsNullOrWhiteSpace($token)) {
  [Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $token, "Process")
}

if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN"))) {
  throw @"
Cloudflare credentials missing. Do one of the following:
  1) Add CLOUDFLARE_API_TOKEN to repo root .env (see .env.example), then re-run this script.
  2) Run: .\scripts\deploy-cloudflare-app-passthrough.ps1 -ApiToken '<token>'
  3) Set CF_API_TOKEN or CLOUDFLARE_API_TOKEN in the environment, then re-run.
  4) Push to GitHub and run workflow 'Deploy Cloudflare app passthrough' after adding repo secret CLOUDFLARE_API_TOKEN.

Token needs: Account Workers Scripts Edit, Workers read, and Zone read (for routes on bokito.ai).
"@
}

Push-Location $workerDir
try {
  npx --yes wrangler@3 deploy
} finally {
  Pop-Location
}
