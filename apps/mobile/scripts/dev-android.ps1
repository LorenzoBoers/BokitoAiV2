# Bokito mobile — Android emulator dev bootstrap (Windows)
# Requires: Android Studio SDK, emulator AVD, FastAPI on :8000

$ErrorActionPreference = "Stop"

$MobileRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Resolve-Path (Join-Path $MobileRoot "..\..")
$ApiDir = Join-Path $RepoRoot "apps\api"
$Apk = Join-Path $MobileRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$AndroidHome = $env:LOCALAPPDATA + "\Android\Sdk"
$Adb = Join-Path $AndroidHome "platform-tools\adb.exe"
$Emulator = Join-Path $AndroidHome "emulator\emulator.exe"
$AvdName = "Medium_Phone_API_36.1"

if (-not $env:ADB_VENDOR_KEYS) { $env:ADB_VENDOR_KEYS = "$env:USERPROFILE\.android" }

function Test-Api {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 5
        return $r.ok -eq $true
    } catch { return $false }
}

function Wait-AdbDevice {
    param([int]$TimeoutSec = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $lines = & $Adb devices 2>&1
        foreach ($line in $lines) {
            if ($line -match "^emulator-\d+\s+device$") {
                return ($line -split "\s+")[0]
            }
            if ($line -match "^emulator-\d+\s+unauthorized$") {
                Write-Host "Emulator connected but UNAUTHORIZED."
                Write-Host "On the emulator window: tap Allow on the USB debugging dialog."
                Write-Host "(Or: Settings > Developer options > Revoke USB debugging authorizations, then reconnect.)"
            }
        }
        Start-Sleep -Seconds 4
    }
    return $null
}

Write-Host "== Bokito Android dev ==" -ForegroundColor Cyan

if (-not (Test-Path $Adb)) {
    throw "adb not found at $Adb — install Android Studio SDK."
}

if (-not (Test-Api)) {
    Write-Host "Starting API (mock LLM)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$ApiDir'; `$env:DATABASE_URL='sqlite+aiosqlite:///./dev-local.db'; `$env:LLM_MODE='mock'; `$env:BOKITO_MOCK_EXECUTION='true'; `$env:JWT_SECRET='dev-jwt-secret'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
    ) | Out-Null
    Start-Sleep -Seconds 6
    if (-not (Test-Api)) { throw "API not reachable on http://127.0.0.1:8000" }
}

$serial = (& $Adb devices) | Select-String "emulator-\d+\s+device" | ForEach-Object { ($_ -split "\s+")[0] } | Select-Object -First 1
if (-not $serial) {
    if (-not (Test-Path $Emulator)) { throw "emulator not found at $Emulator" }
    Write-Host "No authorized emulator — starting $AvdName on port 5556..." -ForegroundColor Yellow
    if (-not $env:ADB_VENDOR_KEYS) { $env:ADB_VENDOR_KEYS = "$env:USERPROFILE\.android" }
    $emuArgs = @("-avd", $AvdName, "-port", "5556", "-skip-adb-auth")
    # Use saved dev snapshot when present (avoids -wipe-data on every boot).
    $snapDir = Join-Path $env:USERPROFILE ".android\avd\Medium_Phone_API_36.1.avd\snapshots"
    if (Test-Path $snapDir) {
        $emuArgs += @("-snapshot", "bokito-dev")
    } else {
        $emuArgs += "-no-snapshot-load"
    }
    Start-Process -FilePath $Emulator -ArgumentList $emuArgs -WindowStyle Normal
    $serial = Wait-AdbDevice -TimeoutSec 180
}
if (-not $serial) {
    throw "No authorized emulator. Tap Allow on USB debugging, then re-run this script."
}

Write-Host "Using device $serial" -ForegroundColor Green
& $Adb -s $serial wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 2; done' 2>$null
Start-Sleep -Seconds 2
& $Adb -s $serial reverse tcp:8081 tcp:8081 | Out-Null
& $Adb -s $serial reverse tcp:8000 tcp:8000 | Out-Null
Write-Host "Port reverse: 8081 (Metro), 8000 (API)"

if (-not (Test-Path $Apk)) {
    Write-Host "Building debug APK..." -ForegroundColor Yellow
    $env:JAVA_HOME = "$env:ProgramFiles\Android\Android Studio\jbr"
    $env:ANDROID_HOME = $AndroidHome
    $env:BOKITO_API_URL = "http://10.0.2.2:8000"
    Set-Location $MobileRoot
    npm run android:build
}

Write-Host "Installing native debug APK..." -ForegroundColor Yellow
& $Adb -s $serial install -r $Apk
& $Adb -s $serial shell am start -n ai.bokito.mobile/.MainActivity

Write-Host ""
Write-Host "Login: admin@bokito.ai / bokito-test-password" -ForegroundColor Cyan
Write-Host "Trading tenant: trader@bokito.ai / bokito-test-password (after SEED_TRADING_TENANT=1)" -ForegroundColor Cyan
Write-Host "For JS hot reload, also run: npm run start:offline (in apps/mobile)" -ForegroundColor Cyan
