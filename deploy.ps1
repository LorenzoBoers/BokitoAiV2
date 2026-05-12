param(
  [string]$BuildName = "",
  [string]$BuildDescription = "",
  [switch]$SkipBuild,
  [switch]$Prod,
  # Upload once, then activate the same build on both dev and prod (Metadata API).
  [switch]$BothEnvs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Initialize-EnvFromDotEnv {
  param([string]$DotEnvPath = ".\.env")
  if (-not (Test-Path -LiteralPath $DotEnvPath)) { return }
  $lines = Get-Content -LiteralPath $DotEnvPath -ErrorAction Stop
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Length -ne 2) { continue }
    $key   = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ([string]::IsNullOrWhiteSpace($key)) { continue }
    # Always apply .env so file edits win over inherited Process vars (e.g. stale static host name).
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Get-EnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required env var: $Name"
  }
  return $value
}

function Get-EnvValueFirst {
  param([Parameter(Mandatory = $true)][string[]]$Names)
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }
  throw "Missing required env var (set one of): $($Names -join ', ')"
}

function Get-EnvOptional {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [Environment]::GetEnvironmentVariable($Name)
}

function Test-ViteProductionEnvSanity {
  $viteBase = (Get-EnvOptional -Name "VITE_XANO_BASE_URL")
  $viteControlPlaneHost = (Get-EnvOptional -Name "VITE_APP_CONTROL_PLANE_HOST")
  $viteTenantRootDomain = (Get-EnvOptional -Name "VITE_TENANT_ROOT_DOMAIN")
  $viteControlPlaneUrl = (Get-EnvOptional -Name "VITE_APP_CONTROL_PLANE_URL")

  if (-not [string]::IsNullOrWhiteSpace($viteBase) -and $viteBase.ToLower().Contains("localhost")) {
    throw "Invalid VITE_XANO_BASE_URL for live deploy: '$viteBase' (localhost not allowed)."
  }
  if (-not [string]::IsNullOrWhiteSpace($viteControlPlaneUrl) -and $viteControlPlaneUrl.ToLower().Contains("localhost")) {
    throw "Invalid VITE_APP_CONTROL_PLANE_URL for live deploy: '$viteControlPlaneUrl'. Keep this empty in production."
  }

  if (-not [string]::IsNullOrWhiteSpace($viteControlPlaneHost) -and $viteControlPlaneHost.Trim().ToLower() -ne "app.bokito.ai") {
    Write-Warning "VITE_APP_CONTROL_PLANE_HOST is '$viteControlPlaneHost' (expected app.bokito.ai)."
  }
  if (-not [string]::IsNullOrWhiteSpace($viteTenantRootDomain) -and $viteTenantRootDomain.Trim().ToLower() -ne ".bokito.ai") {
    Write-Warning "VITE_TENANT_ROOT_DOMAIN is '$viteTenantRootDomain' (expected .bokito.ai)."
  }

  Write-Host "Vite env sanity: OK (no localhost production overrides detected)."
}

function New-CleanZip {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
  )
  Add-Type -Assembly System.IO.Compression
  Add-Type -Assembly System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
  try {
    $files = Get-ChildItem -Path $SourceDir -Recurse -File
    foreach ($file in $files) {
      $entryName = $file.FullName.Substring($SourceDir.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $file.FullName, $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
    Write-Host "Zipped $($files.Count) files."
  }
  finally {
    $zip.Dispose()
  }
}

Initialize-EnvFromDotEnv -DotEnvPath ".\.env"

$metaApiKey   = Get-EnvValue -Name "XANO_METADATA_API_KEY"
$metaBaseUrl  = (Get-EnvValue -Name "XANO_META_BASE_URL").TrimEnd("/")
# Prefer names from .env.example; fall back to legacy WIDGET_* keys.
$workspaceId  = Get-EnvValueFirst -Names @("XANO_DASHBOARD_WORKSPACE_ID", "XANO_WEBSITEWORKSPACE_ID", "XANO_WIDGET_WORKSPACE_ID")
$staticHost   = Get-EnvValueFirst -Names @("XANO_DASHBOARD_STATIC_HOST_NAME", "XANO_WEBSITE_STATIC_HOST_NAME", "XANO_WIDGET_STATIC_HOST_NAME")
Test-ViteProductionEnvSanity

if ([string]::IsNullOrWhiteSpace($BuildName)) {
  $BuildName = "portal-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
}

$dashboardDir = Join-Path $PSScriptRoot "apps\dashboard"
$distDir      = Join-Path $dashboardDir "dist"

if (-not $SkipBuild) {
  Write-Host "Building dashboard (vite build, no tsc — use 'npm run build' locally for full typecheck)..."
  Push-Location $dashboardDir
  try {
    [Environment]::SetEnvironmentVariable("VITE_APP_VERSION", $BuildName, "Process")
    # Vite emits warnings to stderr (chunk-size advisories, mixed-import notes). Under
    # `Set-StrictMode` + `$ErrorActionPreference = Stop`, stderr from a native command
    # is auto-elevated to a terminating error even when exit code is 0. Redirect stderr
    # to stdout for the npm invocation, then rely solely on $LASTEXITCODE.
    $prevErrAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      cmd /c "npm run build:static 2>&1"
    } finally {
      $ErrorActionPreference = $prevErrAction
    }
    if ($LASTEXITCODE -ne 0) { throw "vite build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  Write-Host "Build complete."
}

if (-not (Test-Path -LiteralPath $distDir)) {
  throw "Build output directory not found: $distDir — run without -SkipBuild or run 'npm run build' first."
}

$chatWidgetDir = Join-Path $PSScriptRoot "apps\chat-widget"
$chatWidgetDest = Join-Path $distDir "chat-widget"

$widgetProductionItems = @("bokito-chat.js", "assets", "css", "fonts", "sounds")

if (Test-Path -LiteralPath $chatWidgetDir) {
  Write-Host "Copying chat-widget production files into dist/chat-widget/..."
  if (Test-Path -LiteralPath $chatWidgetDest) {
    Remove-Item -LiteralPath $chatWidgetDest -Recurse -Force
  }
  New-Item -ItemType Directory -Path $chatWidgetDest | Out-Null
  foreach ($item in $widgetProductionItems) {
    $src = Join-Path $chatWidgetDir $item
    if (Test-Path -LiteralPath $src) {
      Copy-Item -Path $src -Destination $chatWidgetDest -Recurse -Force
    }
  }
  Write-Host "Chat-widget production files merged."
} else {
  Write-Host "Warning: chat-widget directory not found at $chatWidgetDir — skipping merge."
}

$tempZip = Join-Path ([System.IO.Path]::GetTempPath()) ("xano-portal-{0}.zip" -f [guid]::NewGuid().ToString("N"))

try {
  New-CleanZip -SourceDir $distDir -ZipPath $tempZip

  $uri = "$metaBaseUrl/workspace/$workspaceId/static_host/$staticHost/build"
  Write-Host "Uploading build '$BuildName' to Xano static host '$staticHost'..."

  $curlArgs = @(
    "-s", "-w", "`n%{http_code}",
    "-X", "POST", $uri,
    "-H", "Authorization: Bearer $metaApiKey",
    "-F", "file=@$tempZip;type=application/zip",
    "-F", "name=$BuildName"
  )
  if (-not [string]::IsNullOrWhiteSpace($BuildDescription)) {
    $curlArgs += @("-F", "description=$BuildDescription")
  }

  $response = & curl.exe @curlArgs
  $lines = $response -split "`n"
  $statusCode = $lines[-1].Trim()
  $body = ($lines[0..($lines.Length - 2)] -join "`n").Trim()

  if ($statusCode -ne "200") {
    throw "Upload failed (HTTP $statusCode): $body"
  }

  $buildId = ($body | ConvertFrom-Json).id
  Write-Host "Build uploaded successfully: $BuildName (ID: $buildId)"

  # Xano Metadata API: POST .../static_host/{host}/build/{build_id}/env  body: {"env":"dev"|"prod"}
  $envTargets = if ($BothEnvs) { @("dev", "prod") } elseif ($Prod) { @("prod") } else { @("dev") }

  foreach ($envName in $envTargets) {
    Write-Host "Activating build $buildId on $envName environment..."
    $activateUri = "$metaBaseUrl/workspace/$workspaceId/static_host/$staticHost/build/$buildId/env"
    $tmpActivate = [System.IO.Path]::GetTempFileName()
    try {
      $payloadJson = "{`"env`":`"$envName`"}"
      $utf8NoBom = New-Object System.Text.UTF8Encoding $false
      [System.IO.File]::WriteAllText($tmpActivate, $payloadJson, $utf8NoBom)
      $activateResponse = & curl.exe -s -w "`n%{http_code}" `
        -X POST $activateUri `
        -H "Authorization: Bearer $metaApiKey" `
        -H "Content-Type: application/json; charset=utf-8" `
        --data-binary "@$tmpActivate"
    } finally {
      Remove-Item -LiteralPath $tmpActivate -Force -ErrorAction SilentlyContinue
    }

    $activateLines = $activateResponse -split "`n"
    $activateStatus = $activateLines[-1].Trim()
    $activateBody = ($activateLines[0..($activateLines.Length - 2)] -join "`n").Trim()

    if ($activateStatus -ne "200") {
      Write-Warning "$envName activation returned HTTP $activateStatus : $activateBody"
    }
    else {
      Write-Host "Build $buildId is now active on $envName."
    }
  }
}
finally {
  if (Test-Path -LiteralPath $tempZip) {
    Remove-Item -LiteralPath $tempZip -Force
  }
}
