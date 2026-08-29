# X32 Physical Routing Visualizer

A read-only, live schematic of a venue's audio installation: physical input
sockets → stageboxes → AES50 → the 32 X32 input channels, and back out through
the output slots to the speakers. Hover or tap any socket, channel or
destination to trace the full signal path in either direction; the channel
SELECTed on the physical console stays highlighted.

It answers the two questions people actually ask in a tech booth — *which
channel is this socket on?* and *where does this channel come from?* — and it
compares the desk's live routing against a blessed baseline, so accidental
drift shows up as a badge rather than a mystery mid-service.

Built for a **Behringer X32**; that part is deliberate and hard-coded. Your
room is not: stageboxes, panels, cabling, speakers and how they group are all
declared in an `installation.yaml`, and the schematic derives itself from
whatever you declare. Start from
[`config/installation.sample.yaml`](config/installation.sample.yaml) — a
venue's own file is deliberately not kept in this repository.

Docs: [architecture](docs/architecture.md) · [X32 OSC subset](docs/x32-protocol.md)
· [installation schema](docs/installation.md) · [example venue](docs/venue-betania.md)
· [build plan](docs/plan.md)

## Quick start (no mixer needed)

```sh
pnpm install
mkdir -p apps/x32-bridge/data
cp config/installation.sample.yaml apps/x32-bridge/data/installation.yaml
pnpm bridge       # terminal 1 — serves the topology (mock mixer, no X32)
pnpm dev          # terminal 2 — → http://localhost:5173  (mock mode, default)
```

The bridge owns the venue topology and serves it at `GET /api/installation`;
the dev server proxies `/api` to it (`apps/web/vite.config.ts`). The app
deliberately bundles no installation of its own — rendering someone else's
wiring when the real one is unavailable would be worse than saying so, and
this is what keeps any venue's file out of the repository. If the bridge
isn't up, or has no usable file, the page says exactly that instead of
showing a room that isn't yours.

`apps/x32-bridge/data/` is the bridge's state directory in dev (gitignored),
the same place `baseline.json` lands; the copy step above is a one-off.

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
- The panel wiring in your `installation.yaml` is real cabling, captured from
  a patch sheet and confirmed on site — see
  [docs/venue-betania.md](docs/venue-betania.md) for how one real venue was
  captured, quirks and all.
- **Auto-discovery is currently unreliable** — it finds the console once and
  then stops (issue #14). Until that is fixed, pass `X32_HOST` explicitly;
  with it the bridge is rock solid.
- Don't run X32-Edit or other OSC tools against the console at the same time
  as the bridge: the desk only tracks a few subscribed clients, and crowding
  that table degrades otherwise-healthy connections (issue #14).

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
Fix the patch, or press **Save as correct** again to bless the new state and
clear the badges. Either way, a confirmation dialog opens first — explaining
either that this becomes the reference the app compares against, or, when a
baseline already exists, that it will be discarded in favour of the new one.
Nothing saves until you confirm in the dialog.

## Deploying to the venue (Windows)

The venue machine runs a real Windows **service** installed from a single
MSI — no Node.js, no console IP configuration, nothing to patch by hand.
Releases are built and verified by CI (`.github/workflows/release.yml`) on a
`windows-latest` runner and attached to the repo's GitHub Releases page
whenever a release is published there.

**First install:**

1. Download `X32RoutingVisualizer-<version>.msi` from the [Releases
   page](../../releases).
2. Double-click it. That's it — no prompts to answer (there's no console IP
   to ask for: the bridge finds the X32 on the LAN itself, plan step 18).

The installer registers "X32 Routing Visualizer" as a Windows service
(auto-start at boot, no one needs to be logged in) and drops an "X32
Routing" shortcut on the Start Menu and Desktop pointing at
`http://localhost:8765`. Silent installs work too: `msiexec /i
X32RoutingVisualizer-<version>.msi /quiet`.

**Updating:** download the newer `.msi` and double-click it. The MSI's fixed
`UpgradeCode` (see `deploy/msi/Product.wxs`) makes this an in-place upgrade —
the old version is removed and the new one installed, service included; the
blessed baseline and any `settings.env` override survive untouched (see
below). There is no separate update mechanism to run — the app itself shows
an unobtrusive "Update available (vX.Y.Z)" link in the header when the
bridge's periodic GitHub Releases check finds something newer than the
running build (plan step 20); it is only a notice, never a downloader — the
tech still downloads and double-clicks the new MSI by hand.

**Uninstalling:** use *Add or Remove Programs*, or `msiexec /x
X32RoutingVisualizer-<version>.msi /quiet`. The service is stopped and
removed and the install directory deleted; the `%ProgramData%` state
directory is deliberately left behind (see below).

**Where things live:**

- `%ProgramFiles%\X32 Routing Visualizer\` — the app itself (`server.mjs`,
  `web\`, `config\`, portable `node.exe`, the WinSW service host). Replaced
  wholesale by every upgrade; removed by uninstall. The
  `config\installation.yaml` in there is only a **seed** — never edit it, an
  upgrade throws it away.
- `%ProgramData%\X32RoutingVisualizer\` — venue state: `installation.yaml`
  (your room's wiring — the file the app actually reads), `baseline.json`
  (the "known correct routing" saved via **Save as correct**), the service's
  rotated logs, and an *optional* `settings.env`. **The MSI never removes or
  overwrites this directory**, on upgrade or uninstall — this is venue data
  captured by hand on-site, not program data that ships with a release.

**Overriding auto-discovery:** if the console is on an unusual network (or
there are several X32s and the wrong one gets picked), create
`%ProgramData%\X32RoutingVisualizer\settings.env` by hand (Notepad; the
`Users` group has write access, no admin needed) with lines like:

```
X32_HOST=192.168.1.10
X32_BRIDGE_PORT=8765
```

Restart the "X32 Routing Visualizer" service (Services app, or `net stop` /
`net start`) for it to take effect. Any variable actually set in the
service's own environment always wins over this file — it only fills gaps.

**Changing the physical wiring:** edit
`%ProgramData%\X32RoutingVisualizer\installation.yaml` in Notepad (the
`Users` group has write access — **no admin rights needed**), then restart
the "X32 Routing Visualizer" service (Services app, or `net stop` /
`net start`). The bridge reads that file at startup and serves it to the web
app over `GET /api/installation`, so a cabling correction is a file edit plus
a restart, never a new release.

That file is created on first run by copying the seed the release ships
(`%ProgramFiles%\...\config\installation.yaml`), and **only when it does not
already exist**. Once it is there, no upgrade ever touches it again — which is
the point: `%ProgramFiles%` is wiped and reinstalled by every upgrade, so
edits made there would vanish silently, discovered months later by whoever
next looks at the schematic. Edit the `%ProgramData%` copy, always.

*Upgrading from a version that kept the topology in `%ProgramFiles%`*: copy
that file to `%ProgramData%\X32RoutingVisualizer\installation.yaml` **before**
installing the new MSI. First run only seeds when nothing is there, so your
own wiring stays; without it, the venue gets whatever wiring the release
shipped.

If the file is missing or invalid, the bridge logs the reason (see the
service log in the same directory) and the app shows a startup error naming
the problem. It deliberately does **not** fall back to some other
installation: a schematic confidently showing the wrong room is worse than
one that admits it has nothing to show.

`X32_INSTALLATION_FILE` (in `settings.env`, alongside `X32_HOST` above) still
overrides the location entirely, if you want the file somewhere else.

## Layout

pnpm workspace: `packages/domain` (pure routing model — no infrastructure),
`packages/installation` (YAML → validated topology), `packages/mixer-contracts`
(`MixerClient` + mock), `packages/protocol` (bridge↔browser messages),
`apps/web` (React schematic), `apps/x32-bridge` (OSC adapter + WS server —
the only OSC-aware module is `src/x32/`). `scripts/release-build.mjs` stages
a production release; `deploy/msi/` holds the WiX v5 MSI authoring
(`Product.wxs`, the WinSW service config) and `scripts/build-msi.mjs` +
`scripts/generate-msi-harvest.mjs` build the installer from that staged
release on Windows CI (`.github/workflows/release.yml`).
