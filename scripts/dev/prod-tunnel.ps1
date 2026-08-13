# Opens an SSH tunnel from localhost to the LIVE prod Postgres + Redis containers.
# Keep this running in its own terminal; Ctrl+C to stop.
#
#   localhost:15432 -> prod postgres:5432
#   localhost:16379 -> prod redis:6379
#
# Container IPs are resolved live each run (they change on recreate), so this
# stays correct after deploys.

param(
    [string]$VpsHost = $(if ($env:VPS_HOST) { $env:VPS_HOST } else { "31.97.45.44" }),
    [string]$Key = $(if ($env:VPS_SSH_KEY) { $env:VPS_SSH_KEY } else { "$env:USERPROFILE\.ssh\bokito_vps_deploy" }),
    [int]$PgPort = 15432,
    [int]$RedisPort = 16379
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }

Write-Host "Resolving prod container IPs on $VpsHost ..."
$pgip = (ssh -i $Key -o StrictHostKeyChecking=accept-new "root@$VpsHost" "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' `$(docker compose -p bokito ps -q postgres)").Trim()
$rdip = (ssh -i $Key "root@$VpsHost" "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' `$(docker compose -p bokito ps -q redis)").Trim()

if (-not $pgip -or -not $rdip) { throw "Could not resolve container IPs (postgres='$pgip' redis='$rdip')" }

Write-Host "postgres=$pgip  redis=$rdip"
Write-Host "Tunnel up: localhost:$PgPort -> postgres:5432 | localhost:$RedisPort -> redis:6379"
Write-Host "Press Ctrl+C to close the tunnel."

ssh -N -i $Key -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 `
    -L "${PgPort}:${pgip}:5432" `
    -L "${RedisPort}:${rdip}:6379" `
    "root@$VpsHost"
