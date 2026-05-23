<#
  Create or update worker.bokito.ai A record -> VPS IP (DNS only, not proxied).

  Requires CLOUDFLARE_API_TOKEN with Zone.DNS Edit.
#>
param(
  [string]$ZoneName = "bokito.ai",
  [string]$RecordHost = "worker",
  [string]$IpAddress = "31.97.45.44",
  [string]$ApiToken = $env:CLOUDFLARE_API_TOKEN
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ApiToken)) {
  throw "Set CLOUDFLARE_API_TOKEN"
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
$zoneId = ($zoneResp.result | Select-Object -First 1).id
if (-not $zoneId) { throw "Zone not found: $ZoneName" }

$fqdn = "$RecordHost.$ZoneName"
$listUri = "$base/zones/$zoneId/dns_records?type=A&name=$fqdn"
$recResp = Invoke-CfJson -Method GET -Uri $listUri
$rec = $recResp.result | Select-Object -First 1

$payloadObj = @{
  type    = "A"
  name    = $RecordHost
  content = $IpAddress
  proxied = $false
  ttl     = 1
}

if ($rec) {
  $body = ($payloadObj | ConvertTo-Json -Compress)
  $null = Invoke-CfJson -Method PUT -Uri "$base/zones/$zoneId/dns_records/$($rec.id)" -Body $body
  Write-Host "OK: updated $fqdn A -> $IpAddress (proxied=false)"
} else {
  $body = ($payloadObj | ConvertTo-Json -Compress)
  $null = Invoke-CfJson -Method POST -Uri "$base/zones/$zoneId/dns_records" -Body $body
  Write-Host "OK: created $fqdn A -> $IpAddress (proxied=false)"
}
