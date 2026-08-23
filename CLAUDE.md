# X32 Physical Routing Visualizer

A read-only, live schematic of one venue's audio installation: physical input
sockets → stageboxes → AES50 → the 32 X32 input channels. It answers two
questions bidirectionally: *which channel(s) consume this socket?* and *which
socket does this channel come from?* It also persistently highlights the route
of whatever channel the operator has SELECTed on the physical console.

This is a debugging/documentation tool, **not** a mixer-control application.
The production app never writes to the mixer.

## Documentation

Read these before making structural changes:

- [docs/architecture.md](docs/architecture.md) — package layout, domain model,
  dependency rules, state boundaries, event flow, WebSocket protocol.
- [docs/x32-protocol.md](docs/x32-protocol.md) — the verified X32 OSC subset,
  index-translation rules, snapshot/subscribe strategy.
- [docs/installation.md](docs/installation.md) — the real venue's physical
  topology facts and the `installation.yaml` schema.
- [docs/plan.md](docs/plan.md) — build sequence and MVP acceptance criteria.

## Non-negotiable invariants

1. **Three lifecycles, never merged**: physical topology (static, from YAML),
   mixer configuration (occasional; changes rebuild the derived route index),
   runtime/UI state (fast: selected channel, hover, connection). A selection
   change must never rebuild topology or the route index.
2. **Dependency direction**: `domain` imports nothing from infrastructure
   (no React, OSC, YAML, WebSocket, fs, browser APIs). Adapters depend on
   domain/contracts, never the reverse.
3. **`MixerClient` is the substitution point**: everything depends on the
   interface; `X32MixerClient` (bridge only) and `MockMixerClient` are
   interchangeable. Only the X32 adapter module knows OSC; all X32
   0-based/1-based translation is centralized there.
4. **Mock-first**: the complete UX must work without an X32, driven by
   `MockMixerClient` and its dev-only control surface.
5. **Read-only MVP**: no mixer writes from production code paths.
6. **No coordinates in `installation.yaml`**: connectivity and visual layout
   are separate concerns; MVP layout is hard-coded in React.

## Tooling

pnpm workspace monorepo, TypeScript throughout, Vitest for tests, Zod for
config validation, React + Zustand + Vite for the web app.
