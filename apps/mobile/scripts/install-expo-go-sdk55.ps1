# Install Expo Go for SDK 55 (required — Play Store Expo Go is still SDK 54).
param(
    [switch]$DownloadOnly
)

$apkUrl = "https://github.com/expo/expo-go-releases/releases/download/Expo-Go-55.0.7/Expo-Go-55.0.7.apk"
$distDir = Join-Path $PSScriptRoot "..\..\..\dist"
$apkPath = Join-Path $distDir "Expo-Go-55.0.7.apk"

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

if (-not (Test-Path $apkPath)) {
    Write-Host "Downloading Expo Go SDK 55..."
    curl.exe -L -o $apkPath $apkUrl
}

if (-not (Test-Path $apkPath)) {
    Write-Error "Download failed: $apkPath"
    exit 1
}

Write-Host "APK ready: $apkPath"
Write-Host ""
Write-Host "Project uses Expo SDK 55. Play Store Expo Go is SDK 54 — that causes"
Write-Host "'Failed to download remote update'. Install this APK instead."
Write-Host ""

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    $devices = & $adb devices 2>&1 | Out-String
    if ($devices -match "`tdevice") {
        Write-Host "Installing via adb..."
        & $adb install -r $apkPath
        exit $LASTEXITCODE
    }
}

if ($DownloadOnly) { exit 0 }

Write-Host "No adb device. Install manually on your phone:"
Write-Host "  1. Copy $apkPath to the phone (USB file transfer or cloud link)"
Write-Host "  2. Open the APK on the phone and allow install from this source"
Write-Host "  3. Open Expo Go (SDK 55), then scan the dev QR / enter the tunnel URL"
Write-Host ""
Start-Process explorer.exe "/select,`"$apkPath`""
