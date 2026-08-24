# X32 Visualizer — check for and install an update.
#
# Double-click to run (or use the "Update X32 Visualizer" desktop shortcut
# install.ps1 creates). Does NOT need admin rights — install.ps1 grants the
# Users group Modify on the install folder, so a normal logged-in operator
# can run this directly.
#
# What this does:
#   1. Reads GITHUB_REPO / GITHUB_TOKEN from settings.env.
#   2. Asks the GitHub API for the latest release and its win64 zip asset.
#   3. Compares the asset's version to app\VERSION. If they match, says so
#      and exits — nothing is downloaded or touched.
#   4. Otherwise downloads the zip, stops the running app, swaps app\ and
#      node\ for the new versions (keeping the old ones as .old until the
#      swap is verified), and restarts.
#   5. On ANY failure during the swap, restores the .old folders so the
#      install is left in a working state, and says so loudly.
#
# settings.env and data\ (baseline.json, bridge.log) are never touched.

$ErrorActionPreference = "Stop"

function Fail($message) {
    Write-Host ""
    Write-Host "UPDATE FAILED: $message" -ForegroundColor Red
    Write-Host "The previous install has been left in place / restored." -ForegroundColor Yellow
    Read-Host "Press Enter to close this window"
    exit 1
}

$InstallDir = $PSScriptRoot
$SettingsPath = Join-Path $InstallDir "settings.env"
$VersionPath = Join-Path $InstallDir "app\VERSION"
$TaskName = "X32 Visualizer"

Write-Host "X32 Visualizer updater"
Write-Host "  install: $InstallDir"
Write-Host ""

if (-not (Test-Path $SettingsPath)) {
    Fail "settings.env not found at $SettingsPath — run install.ps1 first."
}

# --- 1. Read settings.env ---------------------------------------------------

$settings = @{}
foreach ($line in Get-Content $SettingsPath) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Length -eq 2) {
        $settings[$parts[0]] = $parts[1]
    }
}

$repo = $settings["GITHUB_REPO"]
$token = $settings["GITHUB_TOKEN"]
if ([string]::IsNullOrWhiteSpace($repo)) {
    Fail "GITHUB_REPO is not set in settings.env — cannot check for updates."
}

if (-not (Test-Path $VersionPath)) {
    Fail "app\VERSION not found — this install looks broken. Reinstall from a fresh zip."
}
$currentVersionRaw = (Get-Content $VersionPath -Raw).Trim()
$currentVersion = $currentVersionRaw.Split("+")[0]

# --- 2. Ask GitHub for the latest release -----------------------------------

$headers = @{ "User-Agent" = "X32Visualizer-Updater" }
if (-not [string]::IsNullOrWhiteSpace($token)) {
    $headers["Authorization"] = "token $token"
}

try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
} catch {
    Fail "Could not reach GitHub API for $repo (check internet connection / GITHUB_TOKEN): $($_.Exception.Message)"
}

$asset = $release.assets | Where-Object { $_.name -match "^x32-visualizer-win64-v.+\.zip$" } | Select-Object -First 1
if ($null -eq $asset) {
    Fail "Latest release ($($release.tag_name)) has no x32-visualizer-win64-v*.zip asset."
}

if ($asset.name -notmatch "^x32-visualizer-win64-v(?<ver>.+)\.zip$") {
    Fail "Could not parse a version out of asset name '$($asset.name)'."
}
$latestVersion = $Matches["ver"]

Write-Host "Installed version: $currentVersion"
Write-Host "Latest release:    $latestVersion"

if ($latestVersion -eq $currentVersion) {
    Write-Host ""
    Write-Host "Already up to date." -ForegroundColor Green
    Read-Host "Press Enter to close this window"
    exit 0
}

# --- 3. Download -------------------------------------------------------------

$zipPath = Join-Path $env:TEMP "x32-visualizer-win64-v$latestVersion.zip"
Write-Host "Downloading $($asset.name) ..."
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $zipPath
} catch {
    Fail "Download failed: $($_.Exception.Message)"
}

$extractDir = Join-Path $env:TEMP "x32-visualizer-update-$latestVersion"
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
try {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
} catch {
    Fail "Could not extract the downloaded zip: $($_.Exception.Message)"
}

if (-not (Test-Path (Join-Path $extractDir "app")) -or -not (Test-Path (Join-Path $extractDir "node"))) {
    Fail "Downloaded zip doesn't have the expected app\ / node\ layout — refusing to install it."
}

# --- 4. Stop the running app --------------------------------------------------

Write-Host "Stopping X32 Visualizer..."
schtasks /End /TN $TaskName 2>$null | Out-Null

$nodeExePath = (Join-Path $InstallDir "node\node.exe")
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
    $running = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -ieq $nodeExePath } catch { $false }
    }
    if ($null -eq $running -or $running.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
}
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -ieq $nodeExePath } catch { $false }
} | Stop-Process -Force -ErrorAction SilentlyContinue

# --- 5. Swap app/ and node/, restoring .old on any failure -------------------

$appDir = Join-Path $InstallDir "app"
$nodeDir = Join-Path $InstallDir "node"
$appOld = Join-Path $InstallDir "app.old"
$nodeOld = Join-Path $InstallDir "node.old"

foreach ($old in @($appOld, $nodeOld)) {
    if (Test-Path $old) { Remove-Item -Recurse -Force $old }
}

function Restore-OldDirs {
    if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir -ErrorAction SilentlyContinue }
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir -ErrorAction SilentlyContinue }
    if (Test-Path $appOld) { Rename-Item $appOld "app" -ErrorAction SilentlyContinue }
    if (Test-Path $nodeOld) { Rename-Item $nodeOld "node" -ErrorAction SilentlyContinue }
}

try {
    Rename-Item $appDir "app.old"
    Rename-Item $nodeDir "node.old"

    Move-Item (Join-Path $extractDir "app") $appDir
    Move-Item (Join-Path $extractDir "node") $nodeDir

    # Copy the new zip's scripts over the root ones, EXCEPT update.ps1 —
    # this script is currently running from disk, and PowerShell can error
    # (or silently keep running stale code) if a script overwrites itself
    # mid-execution. Instead, stage it as update.ps1.new; start.cmd applies
    # it at next startup, before running anything else.
    foreach ($script in @("start.cmd", "VENUE-README.txt")) {
        $src = Join-Path $extractDir $script
        if (Test-Path $src) {
            Copy-Item -Force $src (Join-Path $InstallDir $script)
        }
    }
    $newUpdatePs1 = Join-Path $extractDir "update.ps1"
    if (Test-Path $newUpdatePs1) {
        Copy-Item -Force $newUpdatePs1 (Join-Path $InstallDir "update.ps1.new")
    }

    Remove-Item -Recurse -Force $appOld
    Remove-Item -Recurse -Force $nodeOld
} catch {
    Write-Host "Swap step failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Restoring previous version..." -ForegroundColor Yellow
    Restore-OldDirs
    Fail "Update aborted; restored the previous install (version $currentVersion)."
}

# --- 6. Restart ---------------------------------------------------------------

schtasks /Run /TN $TaskName | Out-Null

Write-Host ""
Write-Host "Updated: $currentVersion -> $latestVersion" -ForegroundColor Green
Write-Host "Restarted X32 Visualizer."

Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue

Read-Host "Press Enter to close this window"
