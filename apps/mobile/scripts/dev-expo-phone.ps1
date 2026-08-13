# Start Metro for phone hot reload.
# Use -Client dev after installing the dev APK (bokito-mobile-dev.apk).
# Use -Client go only with Expo Go SDK 55 — NOT the production Bokito APK.

param(
    [string]$ApiUrl = "https://app.bokito.ai",
    [int]$Port = 8081,
    [ValidateSet("dev", "go")]
    [string]$Client = "dev"
)

function Ensure-ExpoFirewallRule {
    param([int]$MetroPort)
    $ruleName = "Expo Metro $MetroPort"
    $existing = netsh advfirewall firewall show rule name="$ruleName" 2>&1 | Out-String
    if ($existing -notmatch "Rule Name") {
        Write-Host "Adding Windows Firewall rule for TCP $MetroPort..."
        Start-Process powershell -Verb RunAs -ArgumentList @(
            "-NoProfile", "-Command",
            "netsh advfirewall firewall add rule name=`"$ruleName`" dir=in action=allow protocol=TCP localport=$MetroPort"
        ) -Wait | Out-Null
    }
}

Ensure-ExpoFirewallRule -MetroPort $Port

Set-Location $PSScriptRoot\..
Remove-Item Env:CI -ErrorAction SilentlyContinue
$env:TERM = "xterm-256color"
$env:BOKITO_API_URL = $ApiUrl

$expoArgs = @("start", "--port", "$Port", "--tunnel")

if ($Client -eq "dev") {
    $expoArgs += "--dev-client"
    Write-Host ""
    Write-Host "DEV CLIENT mode — open the Bokito DEV app (not the production APK)."
    Write-Host "Production APK cannot hot reload; it shows 'Failed to download remote update'."
    Write-Host "Install: dist/bokito-mobile-dev.apk (build via GitHub Actions > Mobile Dev APK)"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "EXPO GO mode — requires Expo Go SDK 55 (dist/Expo-Go-55.0.7.apk)."
    Write-Host "Do NOT use the production Bokito APK for hot reload."
    Write-Host ""
    $goApk = Join-Path $PSScriptRoot "..\..\..\dist\Expo-Go-55.0.7.apk"
    if (-not (Test-Path $goApk)) {
        & (Join-Path $PSScriptRoot "install-expo-go-sdk55.ps1") -DownloadOnly
    }
}

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    $devices = & $adb devices 2>&1 | Out-String
    if ($devices -match "`tdevice") {
        & $adb reverse "tcp:${Port}" "tcp:${Port}"
        Write-Host "adb reverse enabled for USB."
    }
}

Write-Host "Starting Metro with tunnel..."
npx expo @expoArgs
