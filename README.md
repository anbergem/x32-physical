# X32 Physical Routing Visualizer

A read-only, live schematic of one venue's audio installation: physical input
sockets → stageboxes → AES50 → the 32 X32 input channels. Hover any socket or
channel strip to trace the full signal route in either direction; the channel
SELECTed on the physical console is highlighted persistently.

Docs: [architecture](docs/architecture.md) · [X32 OSC subset](docs/x32-protocol.md)
· [installation facts & YAML schema](docs/installation.md) · [build plan](docs/plan.md)

## Quick start (no mixer needed)

```sh
pnpm install
pnpm dev          # → http://localhost:5173  (mock mode, default)
```

Mock mode runs a `MockMixerClient` in the browser. The **Mock X32** panel
(bottom right) simulates console actions: select a channel, rename, change a
channel's source, drop/restore the connection.

`pnpm test` runs the full suite; `pnpm typecheck` type-checks all packages.

## Live mode (bridge)

Browsers can't speak OSC/UDP, so `apps/x32-bridge` owns the mixer connection
and serves WebSocket (port `X32_BRIDGE_PORT`, default 8765).

```sh
pnpm bridge                    # mock mixer behind the bridge
X32_DEMO=1 pnpm bridge         # + scripted demo events every ~3s
```

Then open `http://localhost:5173/?mode=live` (add `&bridge=ws://host:port` to
point elsewhere). If the bridge drops, the schematic stays rendered with a
"disconnected" status and reconnects automatically.

## Against the real console (plan step 11)

```sh
X32_MIXER=x32 pnpm bridge                      # auto-discovers the console on the LAN (step 18)
X32_MIXER=x32 X32_HOST=<console-ip> pnpm bridge # or point at it directly
```

Without `X32_HOST` the bridge broadcasts for the console (and re-discovers it
on reconnect, e.g. after a DHCP lease change) instead of needing its IP
configured; `X32_HOST`, when set, always wins. `X32_PORT` defaults to 10023.
The bridge reads a full snapshot (names,
sources, routing blocks, User In table, selected channel), then follows live
changes via `/xremote`. Pressing SELECT on an input channel highlights its
route in the browser; routing changes re-resolve without a reload.

Notes for first bring-up:

- Requires console firmware 4.0+ (`/config/userrout` + `UIN` routing blocks).
- If the console is in Playback routing (`routswitch = PLAY`), the bridge
  logs a warning and keeps showing REC/IN-block routing.
- The panel wiring in [config/installation.yaml](config/installation.yaml) is
  placeholder below the stagebox level — put the real panel→stagebox cabling
  in and restart; it's a YAML-only edit, validated on load.

## Diagnostics

Once the desk is patched correctly, press **Save as correct** in the header
(it's greyed out until the app is connected). That blesses the current
routing as the baseline. From then on, if the desk's actual routing ever
drifts from that blessed state — a channel repatched to the wrong source, two
channels ending up sharing a source they shouldn't — the affected channel
strips pick up a small badge, and the header shows a routing-issue count.
Hover a badged strip for details: what the baseline expected versus what's
actually there now. Renaming a channel never triggers a badge (only visible
in the strip's tooltip) — routing is what this tool guards, not naming.
Fix the patch, or press **Save as correct** again (it asks you to confirm
before replacing an existing baseline) to bless the new state, and the
badges clear.

## Deploying to the venue (Windows)

The venue machine runs a self-contained release — no Node.js or console
config needed on the machine itself. Releases are built by CI
(`.github/workflows/release.yml`) and published to the repo's GitHub
Releases page whenever a `v*` tag is pushed.

**First install:**

1. Download `x32-visualizer-win64-v<version>.zip` from the [Releases
   page](../../releases) and extract it.
2. Right-click `install.ps1` inside the extracted folder → **Run with
   PowerShell**, and allow it to run as Administrator when asked.
3. When prompted, enter the X32 console's IP address (or type `mock` for a
   no-console test install).

That's it — the app registers itself as a hidden background task that starts
at logon, starts immediately, and is reachable at `http://localhost:8765`
(a desktop shortcut, "X32 Routing.url", opens it directly).

**Updating:** double-click the **Update X32 Visualizer** desktop shortcut
(or run `update.ps1` from `C:\X32Visualizer` directly). No admin rights are
needed — it checks GitHub for a newer release and swaps `app\` and `node\`
in place, or reports "already up to date". `settings.env` and `data\` are
never touched by an update.

**Where things live**, all under `C:\X32Visualizer`:

- `settings.env` — console IP, update source; survives updates, editable by
  hand (Notepad) if the console's IP changes.
- `data\baseline.json` — the "known correct routing" saved via **Save as
  correct**; survives every update.
- `data\bridge.log` — background service log, rotated at ~5 MB; survives
  every update.
- `app\`, `node\` — replaced wholesale by every update.

**Changing the physical wiring:** `config/installation.yaml` is baked into
the app at build time (see the caveat in `scripts/release-build.mjs`) — it
is **not** a file to hand-edit on the venue machine. A cabling change means
editing `config/installation.yaml` in this repo, tagging a new release, and
updating the venue machine as above; there is nothing to patch locally.

Full script behavior and troubleshooting: `deploy/windows/VENUE-README.txt`
(also included in the release zip).

## Layout

pnpm workspace: `packages/domain` (pure routing model — no infrastructure),
`packages/installation` (YAML → validated topology), `packages/mixer-contracts`
(`MixerClient` + mock), `packages/protocol` (bridge↔browser messages),
`apps/web` (React schematic), `apps/x32-bridge` (OSC adapter + WS server —
the only OSC-aware module is `src/x32/`). `deploy/windows/` holds the venue
install/update/launch scripts; `scripts/release-build.mjs` and
`scripts/assemble-win-release.mjs` stage and package a release.
