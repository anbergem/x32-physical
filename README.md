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

## Layout

pnpm workspace: `packages/domain` (pure routing model — no infrastructure),
`packages/installation` (YAML → validated topology), `packages/mixer-contracts`
(`MixerClient` + mock), `packages/protocol` (bridge↔browser messages),
`apps/web` (React schematic), `apps/x32-bridge` (OSC adapter + WS server —
the only OSC-aware module is `src/x32/`).
