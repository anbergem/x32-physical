# X32 Visualizer — first-time install (run once, as Administrator).
#
# Right-click this file -> "Run with PowerShell". If Windows shows a blue
# "protected your PC" screen, click "More info" -> "Run anyway" (the zip is
# unsigned; that's expected for an internal venue tool).
#
# What this does:
#   1. Refuses to continue if not running elevated.
#   2. Copies this zip's app/ and node/ folders into C:\X32Visualizer,
#      replacing any previous copy. Never touches C:\X32Visualizer\data\ —
#      that's where baseline.json and bridge.log live, and it must survive
#      both this script and update.ps1 running again later.
#   3. Grants the "Users" group Modify rights on C:\X32Visualizer, so that
#      update.ps1 (see below) can run later as a normal logged-in user
#      without needing admin rights again.
#   4. Asks for the X32 console's IP address (or the word "mock" for a
#      no-console test install) and writes C:\X32Visualizer\settings.env.
#   5. Registers a scheduled task ("X32 Visualizer") that starts start.cmd,
#      hidden, whenever ANY user logs in — and starts it immediately.
#   6. Drops a "X32 Routing.url" shortcut on the Public Desktop that opens
#      http://localhost:8765, and an "Update X32 Visualizer.lnk" shortcut
#      that runs update.ps1.
#
# This script is intentionally small and defensive: every step either
# succeeds or stops the whole install with a clear message. Nothing here
# ever writes to the mixer — it only copies files and registers a Windows
# scheduled task.

$ErrorActionPreference = "Stop"

function Fail($message) {
    Write-Host ""
    Write-Host "INSTALL FAILED: $message" -ForegroundColor Red
    Read-Host "Press Enter to close this window"
    exit 1
}

# --- 1. Require admin ------------------------------------------------------

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "This installer needs to run as Administrator." -ForegroundColor Yellow
    Write-Host "Right-click install.ps1 and choose 'Run with PowerShell' as admin," -ForegroundColor Yellow
    Write-Host "or open an elevated PowerShell window and run it from there." -ForegroundColor Yellow
    Read-Host "Press Enter to close this window"
    exit 1
}

$InstallDir = "C:\X32Visualizer"
$SourceDir = $PSScriptRoot

Write-Host "X32 Visualizer installer"
Write-Host "  source: $SourceDir"
Write-Host "  target: $InstallDir"
Write-Host ""

try {
    # --- 2. Copy app/ and node/, leave data/ alone -------------------------

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    foreach ($folder in @("app", "node")) {
        $src = Join-Path $SourceDir $folder
        if (-not (Test-Path $src)) {
            Fail "Expected folder '$folder' next to install.ps1 but it's missing (source: $SourceDir). Re-download the release zip."
        }
        $dst = Join-Path $InstallDir $folder
        if (Test-Path $dst) {
            Remove-Item -Recurse -Force $dst
        }
        Copy-Item -Recurse -Force $src $dst
    }

    $dataDir = Join-Path $InstallDir "data"
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        Write-Host "Created $dataDir (baseline + logs will live here)."
    } else {
        Write-Host "$dataDir already exists — left untouched."
    }

    foreach ($script in @("start.cmd", "update.ps1", "VENUE-README.txt")) {
        Copy-Item -Force (Join-Path $SourceDir $script) (Join-Path $InstallDir $script)
    }

    # --- 3. Let a standard user run update.ps1 later without admin --------
    #
    # update.ps1 needs to overwrite app\ and node\ and write settings.env.
    # Granting the built-in "Users" group Modify on the install folder now
    # means a venue operator can double-click update.ps1 later without an
    # elevation prompt. icacls is used instead of Set-Acl because it's
    # simpler to get right non-interactively and ships on every Windows
    # version we target.
    icacls $InstallDir /grant "Users:(OI)(CI)M" /T | Out-Null

    # --- 4. Ask for console IP, write settings.env -------------------------

    Write-Host ""
    Write-Host "Enter the X32 console's IP address (e.g. 192.168.1.10)."
    Write-Host "Type 'mock' instead to install without a console for testing."
    $consoleInput = Read-Host "Console IP (or 'mock')"
    $consoleInput = $consoleInput.Trim()

    if ($consoleInput.Length -eq 0) {
        Fail "No value entered for the console IP."
    }

    $repoFile = Join-Path $SourceDir "repo.txt"
    $repoSlug = ""
    if (Test-Path $repoFile) {
        $repoSlug = (Get-Content $repoFile -Raw).Trim()
    }
    if ($repoSlug.Length -eq 0) {
        Write-Host "Warning: repo.txt missing or empty next to install.ps1 — update.ps1 won't know where to check for updates until GITHUB_REPO is set by hand in settings.env." -ForegroundColor Yellow
    }

    $settingsLines = New-Object System.Collections.Generic.List[string]
    if ($consoleInput -ieq "mock") {
        $settingsLines.Add("X32_MIXER=mock")
        Write-Host "Installing in MOCK mode (no real console)." -ForegroundColor Yellow
    } else {
        $settingsLines.Add("X32_MIXER=x32")
        $settingsLines.Add("X32_HOST=$consoleInput")
    }
    $settingsLines.Add("GITHUB_REPO=$repoSlug")
    $settingsLines.Add("# Set GITHUB_TOKEN=<personal access token> below only if")
    $settingsLines.Add("# GITHUB_REPO above is a private repository. Leave blank for a public repo.")
    $settingsLines.Add("GITHUB_TOKEN=")

    $settingsPath = Join-Path $InstallDir "settings.env"
    Set-Content -Path $settingsPath -Value $settingsLines -Encoding UTF8
    Write-Host "Wrote $settingsPath"

    # --- 5. Scheduled task: run start.cmd hidden at any logon --------------
    #
    # schtasks can't launch a window "hidden" on its own — it just runs the
    # program, and cmd.exe normally shows a console window. The standard fix
    # is to have the scheduled task launch a tiny VBScript wrapper that uses
    # WScript.Shell.Run(..., 0, False) — the "0" is what suppresses the
    # window. wscript.exe is present on every Windows install, so no extra
    # tooling is needed.

    $startCmdPath = Join-Path $InstallDir "start.cmd"
    $vbsPath = Join-Path $InstallDir "run-hidden.vbs"
    $vbsContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run """$startCmdPath""", 0, False
"@
    Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

    $taskName = "X32 Visualizer"
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null

    $action = "wscript.exe `"$vbsPath`""
    schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL LIMITED /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "schtasks failed to register the '$taskName' scheduled task (exit code $LASTEXITCODE)."
    }
    Write-Host "Registered scheduled task '$taskName' (runs hidden at logon)."

    schtasks /Run /TN $taskName | Out-Null
    Write-Host "Started X32 Visualizer."

    # --- 6. Desktop shortcuts ------------------------------------------------

    $publicDesktop = "C:\Users\Public\Desktop"
    if (Test-Path $publicDesktop) {
        $urlShortcutPath = Join-Path $publicDesktop "X32 Routing.url"
        Set-Content -Path $urlShortcutPath -Value @(
            "[InternetShortcut]",
            "URL=http://localhost:8765"
        ) -Encoding ASCII
        Write-Host "Created desktop shortcut: X32 Routing.url"

        $wshShell = New-Object -ComObject WScript.Shell
        $updateShortcut = $wshShell.CreateShortcut((Join-Path $publicDesktop "Update X32 Visualizer.lnk"))
        $updateShortcut.TargetPath = "powershell.exe"
        $updateShortcut.Arguments = "-NoLogo -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`""
        $updateShortcut.WorkingDirectory = $InstallDir
        $updateShortcut.Description = "Check for and install X32 Visualizer updates"
        $updateShortcut.Save()
        Write-Host "Created desktop shortcut: Update X32 Visualizer.lnk"
    } else {
        Write-Host "Public desktop ($publicDesktop) not found — skipping desktop shortcuts." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Install complete. Open http://localhost:8765 (or the desktop shortcut)." -ForegroundColor Green
} catch {
    Fail $_.Exception.Message
}

Read-Host "Press Enter to close this window"
