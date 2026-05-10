param(
  [string]$AppHost = "https://app.bokito.ai",
  [string]$ExpectedXanoProdHost = "https://bokitoapp-prod-7443ed-xrex-nmji-j9ur.f2.xano.io",
  [string]$LegacyXanoProdHost = "https://widget-prod-7443ed-xrex-nmji-j9ur.f2.xano.io",
  [string]$TenantHost = "",
  [string]$ApiBase = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Headers {
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $response = Invoke-WebRequest -Method Head -Uri $Url -UseBasicParsing -MaximumRedirection 5
    return $response.Headers
  } catch {
    Write-Warning "HEAD failed for $Url :: $($_.Exception.Message)"
    return @{}
  }
}

function Get-HeaderValue {
  param(
    [hashtable]$Headers,
    [string]$Name
  )
  foreach ($key in $Headers.Keys) {
    if ([string]::Equals([string]$key, $Name, [System.StringComparison]::OrdinalIgnoreCase)) {
      return [string]$Headers[$key]
    }
  }
  return ""
}

function Get-StatusCode {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Method,
    [string]$Body = "",
    [hashtable]$Headers = @{}
  )
  try {
    $invoke = @{
      Uri = $Url
      Method = $Method
      UseBasicParsing = $true
      MaximumRedirection = 3
      Headers = $Headers
    }
    if ($Body) { $invoke["Body"] = $Body }
    $response = Invoke-WebRequest @invoke
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Print-OriginSummary {
  param(
    [string]$Label,
    [hashtable]$Headers
  )
  $etag = Get-HeaderValue -Headers $Headers -Name "ETag"
  $modified = Get-HeaderValue -Headers $Headers -Name "Last-Modified"
  $length = Get-HeaderValue -Headers $Headers -Name "Content-Length"
  $generation = Get-HeaderValue -Headers $Headers -Name "x-goog-generation"
  Write-Host ("{0}: ETag={1} Last-Modified={2} Content-Length={3} x-goog-generation={4}" -f $Label, $etag, $modified, $length, $generation)
}

Write-Host "== Live portal smoke check ==" -ForegroundColor Cyan
Write-Host "App host: $AppHost"
Write-Host "Expected Xano prod host: $ExpectedXanoProdHost"
Write-Host "Legacy Xano prod host: $LegacyXanoProdHost"
if ($TenantHost) { Write-Host "Tenant host: $TenantHost" }
if ($ApiBase) { Write-Host "API base: $ApiBase" }
Write-Host ""

$appHeaders = Get-Headers -Url "$AppHost/"
$expectedHeaders = Get-Headers -Url "$ExpectedXanoProdHost/"
$legacyHeaders = Get-Headers -Url "$LegacyXanoProdHost/"

Print-OriginSummary -Label "app" -Headers $appHeaders
Print-OriginSummary -Label "expected-prod" -Headers $expectedHeaders
Print-OriginSummary -Label "legacy-prod" -Headers $legacyHeaders
Write-Host ""

$appEtag = Get-HeaderValue -Headers $appHeaders -Name "ETag"
$expectedEtag = Get-HeaderValue -Headers $expectedHeaders -Name "ETag"
$legacyEtag = Get-HeaderValue -Headers $legacyHeaders -Name "ETag"
$appModified = Get-HeaderValue -Headers $appHeaders -Name "Last-Modified"
$expectedModified = Get-HeaderValue -Headers $expectedHeaders -Name "Last-Modified"
$legacyModified = Get-HeaderValue -Headers $legacyHeaders -Name "Last-Modified"
$appGeneration = Get-HeaderValue -Headers $appHeaders -Name "x-goog-generation"
$expectedGeneration = Get-HeaderValue -Headers $expectedHeaders -Name "x-goog-generation"
$legacyGeneration = Get-HeaderValue -Headers $legacyHeaders -Name "x-goog-generation"

$matchesExpected = ($appEtag -and $expectedEtag -and $appEtag -eq $expectedEtag) -or
  ($appGeneration -and $expectedGeneration -and $appGeneration -eq $expectedGeneration) -or
  ($appModified -and $expectedModified -and $appModified -eq $expectedModified)
$matchesLegacy = ($appEtag -and $legacyEtag -and $appEtag -eq $legacyEtag) -or
  ($appGeneration -and $legacyGeneration -and $appGeneration -eq $legacyGeneration) -or
  ($appModified -and $legacyModified -and $appModified -eq $legacyModified)

if ($matchesExpected) {
  Write-Host "PASS: app host matches expected Xano prod host." -ForegroundColor Green
} elseif ($matchesLegacy) {
  Write-Host "FAIL: app host still matches legacy Xano host (likely wrong DNS/Worker origin)." -ForegroundColor Red
} else {
  Write-Host "WARN: could not prove parity with either expected or legacy host." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "== Same-origin auth checks ==" -ForegroundColor Cyan
$authMeStatus = Get-StatusCode -Url "$AppHost/api/auth/me" -Method "GET"
$authRefreshStatus = Get-StatusCode -Url "$AppHost/api/auth/refresh" -Method "POST"
$authLoginStatus = Get-StatusCode -Url "$AppHost/api/auth/login" -Method "POST" -Body "{}" -Headers @{ "Content-Type" = "application/json" }

Write-Host "GET /api/auth/me => $authMeStatus"
Write-Host "POST /api/auth/refresh => $authRefreshStatus"
Write-Host "POST /api/auth/login => $authLoginStatus"

if ($authMeStatus -eq 404 -or $authRefreshStatus -eq 404 -or $authLoginStatus -eq 404) {
  Write-Host "FAIL: one or more /api/auth endpoints return 404 on app host." -ForegroundColor Red
} else {
  Write-Host "PASS: /api/auth endpoints resolve on app host (non-404)." -ForegroundColor Green
}

if ($TenantHost) {
  Write-Host ""
  Write-Host "== Tenant host check ==" -ForegroundColor Cyan
  $tenantStatus = Get-StatusCode -Url "$TenantHost/api/auth/me" -Method "GET"
  Write-Host "GET $TenantHost/api/auth/me => $tenantStatus"
  if ($tenantStatus -eq 404) {
    Write-Host "FAIL: tenant /api/auth/me returns 404." -ForegroundColor Red
  } elseif ($tenantStatus -eq 0) {
    Write-Host "WARN: tenant host unreachable (DNS or TLS)." -ForegroundColor Yellow
  } else {
    Write-Host "PASS: tenant /api/auth/me resolves (non-404)." -ForegroundColor Green
  }
}

if ($ApiBase) {
  Write-Host ""
  Write-Host "== CORS preflight check ==" -ForegroundColor Cyan
  $origin = $AppHost.TrimEnd("/")
  $corsStatus = Get-StatusCode -Url "$ApiBase/email/oauth/start?provider=outlook" -Method "OPTIONS" -Headers @{
    "Origin" = $origin
    "Access-Control-Request-Method" = "GET"
  }
  Write-Host "OPTIONS $ApiBase/... with Origin $origin => $corsStatus"
  if ($corsStatus -eq 0) {
    Write-Host "WARN: CORS preflight check unreachable." -ForegroundColor Yellow
  } else {
    Write-Host "INFO: inspect response headers manually when needed (Access-Control-Allow-Origin/Methods)." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Done."
