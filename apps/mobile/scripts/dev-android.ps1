# Bokito mobile — Android emulator dev bootstrap (Windows)
# Requires: Android Studio SDK, emulator AVD

param(
    [string]$ApiUrl = "https://app.bokito.ai",
    [switch]$StartMetro,
    [switch]$ForceRebuild
)

$ErrorActionPreference = "Stop"

$MobileRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Resolve-Path (Join-Path $MobileRoot "..\..")
$ApiDir = Join-Path $RepoRoot "apps\api"
$Apk = Join-Path $MobileRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$ApkStamp = Join-Path $MobileRoot "android\.dev-apk-stamp"
$AndroidHome = $env:LOCALAPPDATA + "\Android\Sdk"
$Adb = Join-Path $AndroidHome "platform-tools\adb.exe"
$Emulator = Join-Path $AndroidHome "emulator\emulator.exe"
$AvdName = "Medium_Phone_API_36.1"
$MetroPort = 8081
$UseLocalApi = $ApiUrl -match "^https?://(127\.0\.0\.1|localhost|10\.0\.2\.2)"

if (-not $env:ADB_VENDOR_KEYS) { $env:ADB_VENDOR_KEYS = "$env:USERPROFILE\.android" }

function Test-LocalApi {
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
            }
        }
        Start-Sleep -Seconds 4
    }
    return $null
}

function Test-ApkFresh {
    param([string]$ExpectedApiUrl)
    if (-not (Test-Path $Apk)) { return $false }
    if (-not (Test-Path $ApkStamp)) { return $false }
    $stamp = Get-Content $ApkStamp -Raw
    if ($stamp -notmatch [regex]::Escape($ExpectedApiUrl)) { return $false }
    if ($stamp -notmatch "expo-dev-client") { return $false }
    $pkgJson = Get-Content (Join-Path $MobileRoot "package.json") -Raw
    if ($stamp -notmatch [regex]::Escape(($pkgJson | Select-String '"expo-dev-client":\s*"([^"]+)"').Matches[0].Groups[1].Value)) {
        return $false
    }
    return (Get-Item $Apk).LastWriteTime -ge (Get-Item $ApkStamp).LastWriteTime
}

function Build-DebugApk {
    param([string]$BuildApiUrl)
    Write-Host "Building debug dev-client APK..." -ForegroundColor Yellow
    $env:JAVA_HOME = "$env:ProgramFiles\Android\Android Studio\jbr"
    $env:ANDROID_HOME = $AndroidHome
    $env:BOKITO_API_URL = $BuildApiUrl
    Set-Location $MobileRoot
    npx expo prebuild --platform android --no-install | Out-Null
    npm run android:build
    if (-not (Test-Path $Apk)) { throw "APK build failed: $Apk" }
    $devClientVer = (Get-Content (Join-Path $MobileRoot "package.json") -Raw | Select-String '"expo-dev-client":\s*"([^"]+)"').Matches[0].Groups[1].Value
    @(
        "apiUrl=$BuildApiUrl"
        "expo-dev-client=$devClientVer"
        "builtAt=$(Get-Date -Format o)"
    ) | Set-Content $ApkStamp
}

function Start-MetroServer {
    param([string]$MetroApiUrl)
    Write-Host "Starting Metro (dev client, localhost)..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        @"
Set-Location '$MobileRoot'
Remove-Item Env:CI -ErrorAction SilentlyContinue
`$env:TERM = 'xterm-256color'
`$env:BOKITO_API_URL = '$MetroApiUrl'
`$env:REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1'
npx expo start --dev-client --lan --port $MetroPort
"@
    ) | Out-Null
    Start-Sleep -Seconds 8
}

Write-Host "== Bokito Android emulator dev ==" -ForegroundColor Cyan
Write-Host "API: $ApiUrl"

if (-not (Test-Path $Adb)) {
    throw "adb not found at $Adb — install Android Studio SDK."
}

if ($UseLocalApi) {
    if (-not (Test-LocalApi)) {
        Write-Host "Starting local API (mock LLM)..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList @(
            "-NoExit", "-Command",
            "Set-Location '$ApiDir'; `$env:DATABASE_URL='sqlite+aiosqlite:///./dev-local.db'; `$env:LLM_MODE='mock'; `$env:BOKITO_MOCK_EXECUTION='true'; `$env:JWT_SECRET='dev-jwt-secret'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
        ) | Out-Null
        Start-Sleep -Seconds 6
        if (-not (Test-LocalApi)) { throw "API not reachable on http://127.0.0.1:8000" }
    }
}

$serial = (& $Adb devices) | Select-String "emulator-\d+\s+device" | ForEach-Object { ($_ -split "\s+")[0] } | Select-Object -First 1
if (-not $serial) {
    if (-not (Test-Path $Emulator)) { throw "emulator not found at $Emulator" }
    Write-Host "No authorized emulator — starting $AvdName on port 5556..." -ForegroundColor Yellow
    $emuArgs = @("-avd", $AvdName, "-port", "5556", "-skip-adb-auth")
    $snapDir = Join-Path $env:USERPROFILE ".android\avd\Medium_Phone_API_36.1.avd\snapshots"
    if (Test-Path $snapDir) {
        $emuArgs += @("-snapshot", "bokito-dev")
    } else {
        $emuArgs += "-no-snapshot-load"
    }
    Start-Process -FilePath $Emulator -ArgumentList $emuArgs -WindowStyle Normal
    $serial = Wait-AdbDevice -TimeoutSec 180
    if (-not $serial) {
        Write-Host "Emulator still unauthorized — cold booting with -wipe-data -skip-adb-auth..." -ForegroundColor Yellow
        & $Adb emu kill 2>$null | Out-Null
        Start-Sleep -Seconds 4
        Start-Process -FilePath $Emulator -ArgumentList @(
            "-avd", $AvdName, "-port", "5556", "-wipe-data", "-skip-adb-auth", "-no-snapshot-load"
        ) -WindowStyle Normal
        $serial = Wait-AdbDevice -TimeoutSec 240
    }
}
if (-not $serial) {
    throw "No authorized emulator. Tap Allow on USB debugging, then re-run this script."
}

Write-Host "Using device $serial" -ForegroundColor Green
& $Adb -s $serial wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 2; done' 2>$null
Start-Sleep -Seconds 2
& $Adb -s $serial reverse "tcp:${MetroPort}" "tcp:${MetroPort}" | Out-Null
Write-Host "Port reverse: $MetroPort (Metro)"
if ($UseLocalApi) {
    & $Adb -s $serial reverse tcp:8000 tcp:8000 | Out-Null
    Write-Host "Port reverse: 8000 (local API)"
}

if ($ForceRebuild -or -not (Test-ApkFresh -ExpectedApiUrl $ApiUrl)) {
    Build-DebugApk -BuildApiUrl $ApiUrl
}

if ($StartMetro) {
    Start-MetroServer -MetroApiUrl $ApiUrl
}

Write-Host "Installing dev-client debug APK..." -ForegroundColor Yellow
& $Adb -s $serial install -r $Apk
$devUrl = [uri]::EscapeDataString("http://127.0.0.1:${MetroPort}")
& $Adb -s $serial shell am start -a android.intent.action.VIEW -d "exp+bokito-mobile://expo-development-client/?url=$devUrl"

Write-Host ""
if ($UseLocalApi) {
    Write-Host "Login: admin@bokito.ai / bokito-test-password" -ForegroundColor Cyan
} else {
    Write-Host "Login: trader@bokito.ai (production credentials)" -ForegroundColor Cyan
}
if (-not $StartMetro) {
    Write-Host "Start Metro: .\scripts\dev-emulator.ps1 (or pass -StartMetro)" -ForegroundColor Cyan
} else {
    Write-Host "Metro is running in a separate window. Edit TSX files to hot reload." -ForegroundColor Cyan
}
