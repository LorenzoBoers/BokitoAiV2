<#
  Update Cloudflare CNAME for app.<zone> to point at the Xano bokitoapp static host.

  Requires:
    - CLOUDFLARE_API_TOKEN in the environment (or pass -ApiToken), with Zone.DNS Edit (and Zone.Zone Read).
    - Zone name defaults to bokito.ai.

  Example:
    $env:CLOUDFLARE_API_TOKEN = "..."
    ./scripts/update-cloudflare-app-cname.ps1 -NewTarget "bokitoapp-prod-7443ed-xrex-nmji-j9ur.f2.xano.io"

  After updating DNS, purge Cloudflare cache for app.<zone> if the edge still serves old HTML/JS.
#>
param(
  [string]$ZoneName = "bokito.ai",
  [string]$RecordHost = "app",
  [Parameter(Mandatory = $true)]
  [string]$NewTarget,
  [string]$ApiToken = $env:CLOUDFLARE_API_TOKEN
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ApiToken)) {
  throw "Set CLOUDFLARE_API_TOKEN or pass -ApiToken (Zone.DNS Edit + Zone.Zone Read)."
}

$base = "https://api.cloudflare.com/client/v4"
$headers = @{
  Authorization = "Bearer $ApiToken"
  "Content-Type" = "application/json"
}

function Invoke-CfJson {
  param([string]$Method, [string]$Uri, [string]$Body = $null)
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers }
  if ($null -ne $Body) { $params.Body = $Body }
  $resp = Invoke-RestMethod @params
  if (-not $resp.success) {
    $msg = ($resp.errors | ForEach-Object { $_.message }) -join "; "
    throw "Cloudflare API error: $msg"
  }
  return $resp
}

$zoneResp = Invoke-CfJson -Method GET -Uri "$base/zones?name=$ZoneName"
$zone = $zoneResp.result | Select-Object -First 1
if (-not $zone) { throw "Zone not found: $ZoneName" }
$zoneId = $zone.id

$fqdn = if ($RecordHost -eq "@" -or [string]::IsNullOrWhiteSpace($RecordHost)) { $ZoneName } else { "$RecordHost.$ZoneName" }
$listUri = "$base/zones/$zoneId/dns_records?type=CNAME&name=$fqdn"
$recResp = Invoke-CfJson -Method GET -Uri $listUri
$rec = $recResp.result | Select-Object -First 1
if (-not $rec) { throw "No CNAME found for $fqdn" }

$payloadObj = @{
  type    = "CNAME"
  name    = $rec.name
  content = $NewTarget.TrimEnd(".")
  proxied = [bool]$rec.proxied
  ttl     = 1
}
$body = ($payloadObj | ConvertTo-Json -Compress)
$updateUri = "$base/zones/$zoneId/dns_records/$($rec.id)"
$null = Invoke-CfJson -Method PUT -Uri $updateUri -Body $body

Write-Host "OK: $fqdn CNAME -> $($payloadObj.content) (proxied=$($payloadObj.proxied))"
