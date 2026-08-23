# Build plan

Vertical slices, mock-first. The complete UX (steps 1–7) must work with
simulated data before any OSC code is written; the real X32 integration is an
adapter swap at the end.

## Sequence

- [x] **1. Workspace scaffolding** — pnpm workspace, shared strict tsconfig
      with by-source workspace consumption, Vitest; empty packages wired with
      correct dependency direction.
- [x] **2. Domain topology model** (`packages/domain`) — IDs, `EndpointRef`,
      `Installation`, graph edges, validation rules. Unit tests.
- [x] **3. Installation loader** (`packages/installation`) — Zod schema, YAML
      parse, derived stagebox→AES50 edges, fail-fast errors. Placeholder
      `config/installation.yaml` per docs/installation.md.
- [x] **4. Mixer contracts + mock** (`packages/mixer-contracts`) —
      `MixerClient`, `MixerSnapshot`, `MixerEvent` (source/channel-state
      types come from domain);
      `MockMixerClient` with simulation API and realistic default snapshot
      (incl. one dual-consumer source, one Card-sourced channel, one OFF).
- [x] **5. Route resolution** (`packages/domain`) — `buildRouteIndex`,
      `SignalRoute`, bidirectional trace. Unit tests (see below).
- [x] **6. Static web layout** (`apps/web`) — hard-coded schematic: panel
      areas, two stagebox areas (dual-labeled AES50-A numbering), 32 channel
      strips in two rows, connection status. Zustand store slices per
      docs/architecture.md §5; local mock gateway.
- [ ] **7. Hover highlighting** — hover any endpoint → full route highlight in
      both directions, including multi-consumer fan-out; tooltip with
      CH name/source/physical path; unmapped sources render "no mapped
      physical input".
- [ ] **8. Selected-channel highlighting** — persistent, visually distinct
      from hover; driven via mock control surface (select, rename, re-route,
      disconnect). *MVP criteria 1–6 verifiable here.*
- [ ] **9. Bridge + WS protocol** (`apps/x32-bridge`, `packages/protocol`) —
      WS server, snapshot-on-connect, event fan-out, resync;
      `WebSocketMixerGateway` in the web app; bridge initially hosts the mock.
- [ ] **10. X32 adapter** (`apps/x32-bridge/src/x32/`) — OSC codec (fixture
      tests), snapshot reads, `/xremote` loop, resolution algorithm per
      docs/x32-protocol.md, reconnect + resync. Unit-test resolution against
      recorded message fixtures.
- [ ] **11. Test against the real console** — MVP criteria 7–10; verify
      User-In-mapped channels resolve correctly on real hardware.

## Domain test checklist (step 5)

- Simple route: panel 3 → stagebox 3 → AES50-A 3 → CH12, traced from both
  ends, identical result.
- Dual consumer: AES50-A 3 → CH12 + CH28; endpoint hover yields both.
- Unmapped: CH5 ← Card 5 → `physicalInputs: []`, no throw.
- Cascade offset: AES50-A 23 → stagebox-2 input 7.
- User In indirection (adapter-level test): IN block `UIN1-8`, slot → userrout
  → AES50-A channel.
- Routing change: CH12 A3 → A8 rebuilds index correctly.
- Selection change mutates runtime state only (topology/index object
  identity unchanged).
- Connection loss/reconnect state transitions.

## MVP acceptance criteria (from spec §32)

1. Start without an X32 in mock mode.
2. See the physical input areas.
3. See all 32 channels in two rows.
4. Hover a physical input → consuming channel(s) highlighted.
5. Hover a channel → physical source highlighted.
6. Mock-select a channel → persistent route highlight.
7. Connect to the real X32.
8. Press SELECT on the console →
9. …immediate highlight of strip + stage socket in browser.
10. Routing changes on the console update the view without reload.
