X32 Visualizer — venue machine notes
=====================================

What is this?
--------------
A read-only screen showing how the X32's 32 input channels are patched to
physical stage sockets. It runs quietly in the background and opens in a
web browser at:

    http://localhost:8765

You'll find a shortcut to that address on the desktop: "X32 Routing.url".

First install
--------------
1. Extract the zip you downloaded from the GitHub Releases page.
2. Right-click "install.ps1" inside the extracted folder and choose
   "Run with PowerShell". If Windows warns that the file is unrecognized
   ("Windows protected your PC"), click "More info" -> "Run anyway" — this
   is expected for an internal tool that isn't code-signed.
3. If asked, allow the script to run as Administrator (it needs this once,
   to register itself as a background service and write to C:\).
4. When prompted, type the X32 console's IP address (found on the console
   under Setup -> Network), or type "mock" to install without a console
   for testing.
5. Wait for "Install complete." and press Enter.

The app now starts automatically every time the machine is turned on or
someone logs in, running invisibly in the background — no window, no icon
in the taskbar. Nothing needs to be started by hand.

Updating
--------
When a new version is released, double-click the "Update X32 Visualizer"
shortcut on the desktop (or run update.ps1 directly from
C:\X32Visualizer). No admin rights are needed for this — a normal Windows
user account can run it. It checks GitHub for a newer release, and either
says "Already up to date" or downloads and installs the new version and
restarts the app. This takes a few seconds and the browser page will
briefly go blank and reload.

Where things live
------------------
Everything is under C:\X32Visualizer:

    app\            the application itself — replaced by every update
    node\           the bundled Node.js runtime — replaced by every update
    data\
      baseline.json   the "known correct routing" you saved with the
                      "Save as correct" button in the app — survives
                      every update
      bridge.log      running log of the background service — survives
                      every update, automatically trimmed once it grows
                      past ~5 MB
    settings.env    console IP and update settings — survives every
                    update; edit by hand if the console's IP address
                    changes (open in Notepad, no restart needed, the
                    change takes effect next time the app starts)

Changing the physical wiring (installation.yaml)
--------------------------------------------------
The map of which panel socket goes to which stagebox input, and which
stagebox feeds which AES50 channel, is baked into the app when it's built
— it is NOT a file you can edit on this machine. If the physical cabling
changes (a socket gets rewired to a different stagebox input, etc.), that
requires cutting a new release from the project's source repository (edit
config/installation.yaml there, tag a new version, wait for the release to
build) and then updating this machine as above. There is nothing in
C:\X32Visualizer to hand-edit for this.

Troubleshooting
-----------------
- Nothing loads at http://localhost:8765: open Task Scheduler, find the
  "X32 Visualizer" task, and check its last run result. You can also just
  double-click C:\X32Visualizer\start.cmd to run it in the foreground and
  see any error directly.
- Check C:\X32Visualizer\data\bridge.log for what the background service
  has been doing / any errors connecting to the console.
- To fully reinstall, just run install.ps1 again from a fresh zip — it
  replaces app\ and node\ but leaves data\ (your saved baseline) alone.
