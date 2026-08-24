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
X32_MIXER=x32 X32_HOST=<console-ip> pnpm bridge
```

`X32_PORT` defaults to 10023. The bridge reads a full snapshot (names,
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

## Layout

pnpm workspace: `packages/domain` (pure routing model — no infrastructure),
`packages/installation` (YAML → validated topology), `packages/mixer-contracts`
(`MixerClient` + mock), `packages/protocol` (bridge↔browser messages),
`apps/web` (React schematic), `apps/x32-bridge` (OSC adapter + WS server —
the only OSC-aware module is `src/x32/`).
