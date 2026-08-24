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
- [x] **7. Hover highlighting** — hover any endpoint → full route highlight in
      both directions, including multi-consumer fan-out; tooltip with
      CH name/source/physical path; unmapped sources render "no mapped
      physical input".
- [x] **8. Selected-channel highlighting** — persistent, visually distinct
      from hover; driven via mock control surface (select, rename, re-route,
      disconnect). *MVP criteria 1–6 verifiable here.*
- [x] **9. Bridge + WS protocol** (`apps/x32-bridge`, `packages/protocol`) —
      WS server, snapshot-on-connect, event fan-out, resync;
      `WebSocketMixerGateway` in the web app; bridge initially hosts the mock.
- [x] **10. X32 adapter** (`apps/x32-bridge/src/x32/`) — OSC codec (fixture
      tests), snapshot reads, `/xremote` loop, resolution algorithm per
      docs/x32-protocol.md, reconnect + resync. Unit-test resolution against
      recorded message fixtures.
- [ ] **11. Test against the real console** — MVP criteria 7–10; verify
      User-In-mapped channels resolve correctly on real hardware.

Post-MVP: routing diagnostics (baseline diff — design in architecture.md §3
"Routing diff", §5, §7; background in x32-protocol.md "Scenes and stored
state"). Steps 12–14 do not depend on step 11 — everything is verifiable in
mock mode. The one ordering rule: do not bless a **production** baseline until
step 11 has validated resolution on real hardware (a baseline captured through
an unvalidated adapter would enshrine any bug on both sides of the diff);
re-saving after step 11 is one button press.

- [x] **12. Routing diff (domain)** — `compareRouting(expected, actual)` →
      typed discrepancies: `source-mismatch` (error), `name-mismatch`
      (informational), `unexpected-shared-source` (shared in actual but not
      expected). Pure, unit-tested, order-stable.
- [x] **13. Baseline capture + persistence** — bridge stores the blessed
      snapshot: `save-baseline` client message → resolved snapshot written as
      JSON on bridge disk (`X32_BASELINE_FILE`, default `data/baseline.json`,
      gitignored) → `baseline-changed` broadcast to all clients; snapshot
      message carries the current baseline. Save rejected while the mixer is
      disconnected or the snapshot incomplete. Mock mode persists via
      localStorage behind a small `BaselineStore` seam.
- [x] **14. Diagnostics UI** — discrepancy badges on affected strips/sockets
      (mapped to endpoints via the route index) + unobtrusive header count;
      one "Save as correct" action (disabled unless connected and synced;
      confirm before overwrite). Name mismatches surface in tooltips only.
      With no baseline, the UI is unchanged from MVP.
- [x] **15. Live channel meters** — adapter subscribes
      `/meters ,si /meters/1 [time_factor]` (verified: ~10 s lifetime, renewed
      like `/xremote`; `time_factor` ≈ 4–5 → ~200–250 ms cadence set by the
      console; reply blob = 96 floats, first 32 = input channel levels;
      floats are **little-endian**, unlike OSC ints — decode in `src/x32/`
      with byte fixtures; record the format in x32-protocol.md). Compact
      `meters` WS message; a fourth, fastest store path that never touches
      channels/routeIndex/discrepancies; thin level bar on each strip's right
      edge; mock simulates levels behind a control-surface toggle.
- [x] **16. Production serve mode** — the bridge serves the built web app
      (hand-rolled static handler, path-traversal safe, index fallback) over
      HTTP on the same port as the WS, so the venue URL is one origin
      (`http://localhost:8765`). Web built with `VITE_DEFAULT_MODE=live`
      defaults to live mode + same-origin bridge URL (dev stays mock/Vite).
      `pnpm release:build` stages `dist/release/`: esbuild-bundled
      `server.mjs`, web dist, `config/installation.yaml`, VERSION. Verified
      locally by running the staged server with the mock mixer.
- [x] **17. Windows venue distribution — SUPERSEDED by 18–20.** The
      PowerShell + scheduled-task + self-update-zip approach shipped
      (`deploy/windows/`, `scripts/assemble-win-release.mjs`) but is replaced
      by the MSI route below and removed in step 19. Reason: PowerShell
      scripts cannot be executed or tested anywhere in the build environment
      (their first run would be on the venue machine), whereas an MSI is
      installable, verifiable, and uninstallable inside CI on a Windows
      runner. MSI also brings real upgrade/rollback/uninstall semantics and
      an Add/Remove Programs entry instead of hand-rolled directory swaps.

- [ ] **18. X32 auto-discovery** — the bridge finds the console itself:
      broadcast `/info` (no args) to 255.255.255.255:10023 from an
      SO_BROADCAST socket, collect replies (`,ssss` — ip, name, model, fw),
      pick the single responder (log and pick the first, deterministically,
      if several). `X32_HOST` still wins when set; discovery runs when it is
      absent, and re-runs as part of the reconnect path. Lives in
      `apps/x32-bridge/src/x32/` (it is OSC knowledge); fake-transport
      tested. Removes IP configuration from the venue install entirely, and
      the console's model/firmware from the reply feeds the status line.
      Record the discovery mechanism in x32-protocol.md.
- [ ] **19. MSI installer (WiX)** — replaces step 17's scripts entirely
      (delete `deploy/windows/`, `scripts/assemble-win-release.mjs`, and the
      zip job). WiX v5 `.wxs` authoring an MSI that: installs to
      `%ProgramFiles%\X32 Routing Visualizer\` (bundled `server.mjs`, web
      dist, portable `node.exe`, WinSW service host + its XML); runs the
      bridge as a real Windows **service** (auto-start at boot, no logon
      required) via `ServiceInstall`/`ServiceControl`; keeps state in
      `%ProgramData%\X32RoutingVisualizer\` (baseline.json, logs, optional
      `settings.env` override) so upgrades never touch it; Start-Menu +
      Desktop shortcut to `http://localhost:8765`; `MajorUpgrade` so a newer
      MSI upgrades in place; clean uninstall (service removed, ProgramData
      left). No console-IP dialog — step 18 makes it unnecessary.
      **CI must prove it**: a `windows-latest` job installs the MSI silently,
      polls `http://localhost:8765` until it serves the app, asserts the
      service is Running, then uninstalls and asserts the service is gone.
      Release workflow triggers on `release: [published]` (not tag push) and
      uploads the MSI to that release.
- [ ] **20. In-app update notice** — the bridge checks the GitHub Releases
      API at most once every few hours (failures silent; never blocks
      startup), compares to its own VERSION, and exposes the result on the
      existing snapshot/protocol path; the header shows an unobtrusive
      "Update available (v0.2.0)" link to the release page, where the tech
      downloads and double-clicks the new MSI. No self-updating code.

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
