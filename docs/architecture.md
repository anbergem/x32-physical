# Architecture

This document is the contract for the codebase structure. It corresponds to
the "first task" deliverable of the project spec: package structure, domain
models, dependency direction, interfaces, and event flow.

## 1. Repository layout

```text
/
├── apps/
│   ├── web/                  # React app (Vite). Schematic UI + Zustand store.
│   │   └── src/
│   │       ├── state/        # store, selectors, gateway wiring
│   │       ├── components/   # PhysicalInputPanel, Stagebox, Mixer, ...
│   │       ├── gateway/      # MixerGateway: WebSocket impl + local-mock impl
│   │       └── devtools/     # mock control surface (dev/mock mode only)
│   │
│   └── x32-bridge/           # Node app. Owns the MixerClient, serves WebSocket.
│       └── src/
│           ├── x32/          # X32MixerClient + OSC codec. The ONLY place
│           │                 # that knows OSC / UDP / X32 semantics.
│           └── server/       # WebSocket server, snapshot + event fan-out
│
├── packages/
│   ├── domain/               # Pure TS. Topology graph, IDs, route resolution,
│   │                         # route index. Zero infrastructure imports.
│   ├── mixer-contracts/      # MixerClient interface, MixerSnapshot, MixerEvent
│   │                         # + MockMixerClient (pure TS).
│   ├── installation/         # Zod schema + YAML loader → domain topology.
│   └── protocol/             # WebSocket message types shared bridge ↔ web.
│
├── config/
│   └── installation.yaml     # One installation's physical topology.
│                             # No coordinates: see docs/installation.md.
│
├── docs/
└── package.json              # pnpm workspace root
```

Notes vs. the original spec sketch: `x32-contracts` is named
`mixer-contracts` (it is mixer-agnostic by design; the X32 is one
implementation), and the X32 adapter lives inside `apps/x32-bridge/src/x32/`
rather than its own package — nothing else may import it, and workspace
boundaries enforce that for the web app automatically.

## 2. Dependency direction

```text
                 domain
                   ▲
        ┌──────────┼──────────────┐
        │          │              │
  installation  mixer-contracts  protocol
        ▲          ▲              ▲
        │          │              │
   YAML/Zod    x32 adapter    bridge + web
               (bridge only)
```

Rules, enforced by workspace dependencies and review:

- `domain` imports **nothing** (no React, OSC, YAML, WS, fs, browser, Zustand).
- `mixer-contracts` imports `domain` types only. `MockMixerClient` lives here
  and is pure TS (usable in Node *and* the browser).
- `installation` depends on `domain` (+ Zod, yaml). Topology model does not
  know YAML exists.
- `protocol` depends on `domain` + `mixer-contracts` types. No hand-duplicated
  JSON shapes between bridge and web.
- `apps/x32-bridge` depends on all packages; only its `src/x32/` module may
  contain OSC/UDP code.
- `apps/web` depends on `domain`, `mixer-contracts`, `protocol`, and
  `installation` (the browser-safe parse entry point only — never the `/node`
  subpath). It must never import bridge code.

## 3. Domain model (`packages/domain`)

### Identifiers

Branded types so unrelated IDs cannot be mixed accidentally:

```ts
type DeviceId = string & { __brand: "DeviceId" };
type MixerChannelId = number & { __brand: "MixerChannelId" }; // 1–32, 1-based
type EndpointId = string & { __brand: "EndpointId" };         // canonical encoding
```

Endpoints are structured objects internally; `EndpointId` is the canonical
string encoding used for map keys and wire transfer:

```text
panel:front-left:3        # physical panel socket
stagebox:stagebox-1:3     # stagebox input socket
local:console:3           # console XLR local input socket
aes50:A:19                # AES50 bus channel (bus-level, box-agnostic)
mixer:12                  # X32 input channel
out:13                    # X32 output slot (console Out N, 1–16)
console-out:1             # console XLR out socket
stagebox-out:stagebox-1:5 # stagebox XLR out socket
dest:main-left            # destination device (powered speaker/zone)
```

```ts
type EndpointRef =
  | { kind: "panel-input";     device: DeviceId; input: number }
  | { kind: "stagebox-input";  device: DeviceId; input: number }
  | { kind: "local-input";     device: DeviceId; input: number } // console XLR 1–32
  | { kind: "aes50-channel";   bus: "A" | "B";   channel: number } // 1–48
  | { kind: "mixer-channel";   channel: MixerChannelId }
  | { kind: "mixer-output";    output: number }                   // 1–16
  | { kind: "console-output";  output: number }                   // 1–16
  | { kind: "stagebox-output"; device: DeviceId; output: number }
  | { kind: "destination";     device: DeviceId };
```

`aes50-channel` is deliberately distinct from `stagebox-input`: the mixer only
ever sees bus+channel; which physical box that channel belongs to is a static
topology fact (cascade offsets), expressed as graph edges.

`local-input` (issue #2) is the console's own local XLR input socket, owned by
the `console` device kind below — distinct from `stagebox-input` the same way:
it belongs to no AES50 bus, and route resolution maps `MixerSourceRef`'s
`local` variant onto it directly rather than through the AES50 cascade.

The output-side kinds (issue #8) mirror this: `mixer-output` is the console Out
slot the mixer sees (`/outputs/main/[01…16]/src`), distinct from where it
physically emerges — a `console-output` (no device; console XLRs are
addressed by number alone until a console device kind exists) or a
`stagebox-output` (which box's XLR presents it, from the stagebox's
`outputBlock`). `destination` is a device-level endpoint with no socket
number: a powered speaker or zone is one thing, not a socket on a thing.

**The input-side and output-side kinds are disjoint** — an `EndpointId` never
means both an input and an output endpoint, and `RouteIndex` and
`OutputRouteIndex` (below) each only ever contain nodes of their own side. A UI
hover consults both indexes and shows whichever one has an entry for the
endpoint under the cursor.

### Topology (static)

```ts
interface Device {
  id: DeviceId;
  kind: "passive-panel" | "stagebox" | "destination" | "console";
  label: string;
  inputs: number;                                   // unused by "destination"
  aes50?: { bus: "A" | "B"; offset: number };        // stageboxes only
  outputs?: number;                                  // stageboxes only
  outputBlock?: { start: number };                   // stageboxes only, 1–16
  sockets?: SocketAnnotation[];                      // declared per-socket metadata
}

interface SocketAnnotation {
  input: number;                                     // 1-based, within 1…inputs
  status: "broken" | "unused";
  note?: string;
}

interface Installation {
  devices: Device[];
  connections: Array<{ from: EndpointRef; to: EndpointRef }>; // signal direction
}
```

`sockets` (issue #12) is **descriptive metadata that route resolution
ignores** — `buildRouteIndex` never branches on it, so an annotated socket
resolves exactly like an uncabled one (single-endpoint route, no consumers).
The UI reads it only to render a socket distinctly and word its tooltip.
`validateInstallation` does enforce one thing about it: an annotated socket
must not also be the `from` of a connection — declaring a socket broken/unused
and cabling it is contradictory input, rejected at load rather than rendered.

`"destination"` (issue #8) is a powered speaker or zone. There is no
amplifier device kind: the example venue's cabinets are powered, and no case
has yet required modelling an amp as its own hop. It carries no
`inputs`/`aes50`/`outputs`/`outputBlock`; the device itself is the endpoint.

`outputBlock.start` names the first console Out slot (1–16) a stagebox
presents on its XLR outs — Out `start` → the box's out 1, through Out
`start + 7` → its out 8. Like `aes50.offset`, it is **not** readable over OSC
(docs/x32-protocol.md §"Output routing"): it is a static physical fact
(DIP switch / panel setting) that YAML must assert, with the same
silent-invalidation risk if the box is reconfigured. Console XLR outs are
**declared, not derived**: which Out slot appears on which console XLR is an
ordinary `connections` entry (`mixer-output → console-output`), exactly like
panel→stagebox cabling.

`"console"` (issue #2) exists for the desk's own local *inputs*
(`MixerSourceRef`'s `local` variant, console XLR 1–32) — `label` and `inputs`
like a passive panel, but no `aes50`: local inputs never reach an AES50 bus.
At most one `console` device is a domain rule. Console *outputs* deliberately
stay on the bare-number `console-output` scheme above, unmigrated: the two
sides of the console are addressed asymmetrically on purpose — see
docs/installation.md "Console input addition".

The domain derives the stagebox→AES50 edges from `aes50.offset` (box input *n*
→ bus channel *offset + n*) in `deriveStaticEdges`, which route resolution
(`buildRouteIndex`) calls. It derives the stagebox→output edges from
`outputBlock.start` in `deriveOutputEdges`, which `buildOutputRouteIndex`
calls — kept as a separate function so the two functions' edges feed disjoint
graphs rather than leaking output-only nodes into `deriveStaticEdges`'s input
graph or vice versa (`installation.connections` is one shared list; each
function filters it to its own side's `from` kinds). `Installation` therefore
stays a record of the *declared* facts, and YAML only declares the
panel→stagebox and output-side cabling explicitly.

### Mixer routing model (`packages/domain`)

`MixerSourceRef` and `MixerChannelState` are **domain types** (the spec's
"mixer-routing model" responsibility): `buildRouteIndex` consumes them, and
`mixer-contracts` imports them from domain — never the reverse. The domain
resolves routes from this normalized state and never sees OSC:

```ts
/** Where a mixer input slot or channel ultimately pulls signal from. */
type MixerSourceRef =
  | { kind: "aes50"; bus: "A" | "B"; channel: number } // 1–48
  | { kind: "local"; input: number }                   // console XLR 1–32
  | { kind: "card"; input: number }
  | { kind: "aux"; input: number }
  | { kind: "usb"; side: "L" | "R" }
  | { kind: "fx"; ret: number }
  | { kind: "bus"; bus: number }
  | { kind: "talkback"; which: "int" | "ext" }
  | { kind: "off" };

interface MixerChannelState {
  channel: MixerChannelId;
  name: string;
  /** Fully resolved source (input-block + user-in indirection already applied
      by the adapter/mock — see docs/x32-protocol.md §Resolution). */
  source: MixerSourceRef;
}
```

Design choice: the *adapter* (X32 or mock) resolves the X32's two-level
indirection (channel source → IN block routing → optional User In slot) down
to a flat `MixerSourceRef` per channel, and re-emits `channel-source-changed`
for every affected channel when a block or user-in mapping changes. The domain
then only maps `MixerSourceRef` → topology endpoints. This keeps every X32
semantic (blocks of 8, user-in tables, REC/PLAY switch) inside the adapter,
per the centralization rule. The mock produces the same flat form directly.

### Route resolution

```ts
interface SignalRoute {
  /** Upstream → downstream, e.g. panel → stagebox → aes50 → mixer(s). */
  endpoints: EndpointId[];
  mixerChannels: MixerChannelId[];      // all consumers of this source
  physicalInputs: EndpointRef[];        // [] when source is unmapped
  /** Present when the mixer channel's source has no physical mapping
      (local/card/usb/... or an AES50 channel no stagebox occupies). */
  unmappedSource?: MixerSourceRef;
}

interface RouteIndex {
  byMixerChannel: Map<MixerChannelId, SignalRoute>;
  byEndpoint: Map<EndpointId, SignalRoute[]>;
}

function buildRouteIndex(installation: Installation,
                         channels: MixerChannelState[]): RouteIndex;
```

- Not one-to-one: one source feeding CH12 and CH28 yields one shared route
  whose `mixerChannels` is `[12, 28]`, indexed under both channels and every
  endpoint on the path.
- Unmapped sources (Card 5, unoccupied AES50 channel, OFF) yield a route with
  `physicalInputs: []` and `unmappedSource` set — never a throw.
- The graph is tiny (< 200 nodes); `buildRouteIndex` is a full rebuild on any
  routing/config change. No incremental graph engine.
- Traversal is generic over directed edges, not hardcoded to the
  panel→stagebox→aes50→mixer shape, so output routing can reuse it later.

### Mixer output routing model (issue #8)

`MixerOutputSourceRef` is a **separate union from `MixerSourceRef`**, not an
extension of it: "Bus 3 feeds an output" and "a channel is sourced from Bus 3"
are different relationships in different semantic spaces, and conflating them
would let a route resolve nonsense.

```ts
/** Where a console Out slot (1–16) pulls its signal from. */
type MixerOutputSourceRef =
  | { kind: "main"; side: "L" | "R" | "C" }
  | { kind: "bus"; bus: number }                    // 1–16
  | { kind: "matrix"; matrix: number }               // 1–6
  | { kind: "direct-out-channel"; channel: MixerChannelId }
  | { kind: "direct-out-aux"; aux: number }          // 1–8
  | { kind: "direct-out-fx"; ret: number }
  | { kind: "monitor"; side: "L" | "R" }
  | { kind: "talkback" }
  | { kind: "off" };

interface MixerOutputState {
  output: number;      // 1–16
  name?: string;
  source: MixerOutputSourceRef;
}
```

Unlike `MixerSourceRef`'s `aes50` variant, no `MixerOutputSourceRef` variant
names a physical endpoint — bus/matrix/main are console-internal, not sockets.
So route resolution cannot detect "one source feeds several outputs" via a
shared graph node the way the input side does; it compares `source` values
structurally instead (see below).

### Output route resolution (issue #8)

A **separate `OutputRouteIndex`, not a widened `RouteIndex`**: the two
endpoint-kind spaces are disjoint (see "Identifiers" above), so nothing is
ambiguous, and `SignalRoute`'s `mixerChannels`/`physicalInputs` fields do not
describe an output route. Forcing one type would either bloat it with
optional fields or churn the input side's 700+ passing tests for no benefit.

```ts
interface OutputRoute {
  /** Upstream → downstream: slot(s) → physical out(s) → destination(s). */
  endpoints: EndpointId[];
  mixerOutputs: number[];           // every Out slot sharing this source, ascending
  destinations: EndpointRef[];      // [] when nothing is cabled downstream
  /** Present when the slot's source is "off": no destinations were traced. */
  unroutedSource?: MixerOutputSourceRef;
}

interface OutputRouteIndex {
  byMixerOutput: Map<number, OutputRoute>;
  byEndpoint: Map<EndpointId, OutputRoute[]>;
}

function buildOutputRouteIndex(installation: Installation,
                               outputs: MixerOutputState[]): OutputRouteIndex;
```

- **Reuses the same generic BFS** (`graph.ts`) `buildRouteIndex` is built on
  — one traversal implementation, not two.
- Not one-to-one, mirroring the input side: Bus 3 feeding Out 7 and Out 12
  yields one shared route with `mixerOutputs: [7, 12]`. But the *mechanism*
  differs: since no endpoint represents "Bus 3", grouping is by **structural
  equality of `source`**, and the group's route is the union of each slot's
  independent downstream trace — not one trace from a shared upstream node.
- A block is presented **wholesale**: a stagebox's XLR outs carry its full
  8-slot block regardless of which slots are actually patched
  (docs/venue-betania.md "a block is presented wholesale, but only some
  sockets are patched"), so the static `mixer-output → stagebox-output` edge
  exists independent of the slot's source.
- A slot sourced `off` is the one deliberate exception to that: its route is
  just the slot itself, no downstream trace, even though the physical XLR
  still exists as topology — there is no signal to show a path for. That
  physical endpoint remains hoverable regardless (a static chain no active
  route claims yet, mirroring the input side's uncabled-panel-socket
  handling), so a technician can still see the block's wiring.
- A physical out reaching no declared destination still appears in
  `byEndpoint` (`destinations: []`) — signal present, nothing plugged in,
  exactly like an unconnected stagebox input. Never throws.

### Routing diff (steps 12–14)

Diagnostics compare a **baseline** (the blessed known-good snapshot, see §7)
against the live state, entirely in the domain:

```ts
type RoutingDiscrepancy =
  | { kind: "source-mismatch"; channel: MixerChannelId;
      expected: MixerSourceRef; actual: MixerSourceRef }            // error
  | { kind: "name-mismatch"; channel: MixerChannelId;
      expected: string; actual: string }                            // informational
  | { kind: "unexpected-shared-source"; source: MixerSourceRef;
      channels: MixerChannelId[] };  // shared in actual but not in expected

function compareRouting(expected: MixerChannelState[],
                        actual: MixerChannelState[]): RoutingDiscrepancy[];
```

Pure, order-stable, never throws. Name mismatches are informational only —
renames are routine; routing is what the tool guards. The UI maps
discrepancies to endpoints via the route index and renders badges; the diff is
computed client-side (works identically in mock mode; the bridge only stores
and serves the baseline).

### Validation (in `installation` package, rules in domain)

Fail fast at load with actionable messages: unique device ids; connection
endpoints must reference existing devices and in-range inputs; a stagebox
input has at most one feeding panel socket; AES50 ranges (`offset`,
`offset + inputs`) must not overlap per bus and must fit in 1–48.

Output-side rules (issue #8), additive: `destination` devices carry no
`inputs`/`aes50`/`outputs`/`outputBlock`; a stagebox's `outputBlock.start`
must be 1–16 with its 8 slots fitting in 1–16; two stageboxes must not present
overlapping output blocks; a console Out slot may appear on at most one
console XLR; a physical output feeds at most one destination. Connections now
come in five shapes — `panel-input → stagebox-input`,
`panel-input → local-input`, `mixer-output → console-output`,
`stagebox-output → destination`, `console-output → destination` — dispatched
by each connection's `from`/`to` kind pair; every shape still checks its
endpoints reference existing devices (where the shape has one) with in-range
numbers.

Console device rules (issue #2), additive: at most one `console` device; a
`console` device must not carry `aes50`; a `local-input` connection endpoint
must reference the console device with an in-range input; a console input has
at most one feeding panel socket, mirroring the stagebox-input rule.

## 4. `MixerClient` (`packages/mixer-contracts`)

```ts
type MixerConnectionState = "connecting" | "connected" | "disconnected";

interface MixerSnapshot {
  channels: MixerChannelState[];       // exactly 32; channel types from domain
  selectedChannel: MixerChannelId | null;
}

type MixerEvent =
  | { type: "selected-channel-changed"; channel: MixerChannelId | null }
  | { type: "channel-name-changed"; channel: MixerChannelId; name: string }
  | { type: "channel-source-changed"; channel: MixerChannelId; source: MixerSourceRef }
  | { type: "connection-state-changed"; state: MixerConnectionState };

interface MixerClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): Promise<MixerSnapshot>;
  subscribe(listener: (event: MixerEvent) => void): () => void;
  getConnectionState(): MixerConnectionState;
}
```

There is no separate `routing-changed` wire event: block/user-in changes are
expanded by the adapter into per-channel `channel-source-changed` events
(possibly many at once), so consumers have exactly one code path for "a
channel's effective source changed". Commands (writes) are deliberately
absent; the mock exposes mutation via its own wider interface
(`MockMixerClient extends MixerClient` with `simulate*` methods), which
production code never sees.

### Meters (step 15)

Live per-channel levels are an optional `MixerClient` capability, deliberately
kept off the `MixerEvent` union:

```ts
interface MixerClient {
  // ...
  subscribeMeters?(listener: (levels: number[]) => void): Unsubscribe;
}
```

`levels` is always exactly 32 entries (1-based index 0 = channel 1). This is
its own delivery path because it is far too chatty (several updates a second)
for the same fan-out as occasional routing/selection changes — folding it
into `MixerEvent` would make every other event consumer pay for traffic it
never asked for. `X32MixerClient` implements it over `/meters` (see
docs/x32-protocol.md "Meters"); `MockMixerClient` implements it with its own
dev-only `simulateMetersStart()`/`simulateMetersStop()` generator. Optional
because a `MixerClient` consumer that doesn't care about meters simply never
calls it.

### `MockMixerClient` behavior

Pure TS, runs in Node and browser. Constructed from an initial
`MixerSnapshot` (a realistic default matching `installation.yaml`). Simulation
API (dev-only): `simulateSelect(ch | null)`, `simulateRename(ch, name)`,
`simulateSourceChange(ch, source)`, `simulateConnecting()`,
`simulateConnectionLoss()`, `simulateReconnect()`. Each mutates the mock's internal snapshot and emits the
corresponding `MixerEvent`, so mock and real adapter exercise identical
consumer code. The default snapshot matches the venue's real patch sheet
exactly (docs/venue-betania.md) — no synthetic edge cases; a shared source, an
unmapped (Card) source, or an OFF channel are produced via `simulate*` or a
test-local snapshot, not baked into the default.

## 5. State boundaries (web app)

Zustand store with three distinct slices — different lifecycles, never merged:

```ts
interface AppState {
  // Structural: set at load, effectively immutable.
  installation: Installation;

  // Mixer configuration: changes occasionally; updating it rebuilds routeIndex
  // (source changes; renames don't invalidate routes).
  channels: MixerChannelState[];

  // Blessed known-good snapshot (config lifecycle; null until first save).
  baseline: MixerSnapshot | null;

  // Derived (recomputed only when installation/channels change):
  routeIndex: RouteIndex;
  // Derived (recomputed only when channels/baseline change; [] w/o baseline):
  discrepancies: RoutingDiscrepancy[];

  // Mixer configuration (issue #11): the 16 console Out slots — the
  // output-side mirror of `channels`, same lifecycle.
  outputs: MixerOutputState[];
  // Derived (issue #11; recomputed only when installation/outputs change).
  // A separate index from `routeIndex` — the input and output endpoint-kind
  // spaces are disjoint (§3), so an outputs change never rebuilds
  // `routeIndex`/`discrepancies`, and vice versa.
  outputRouteIndex: OutputRouteIndex;

  // Runtime: fast-changing, never triggers index rebuilds.
  connection: MixerConnectionState;
  selectedChannel: MixerChannelId | null;   // from the physical console
  hoveredEndpoint: EndpointId | null;       // browser-local
  hoverPinned: boolean;                     // browser-local

  // Fourth path (step 15): fastest of all, updates several times a second.
  // `null` until the first tick. Its own slice — a meters update never
  // touches any of the above, and none of the above ever touch it.
  meterLevels: number[] | null;
}
```

Selection and hover are independent: hovering must never clear or overwrite
the physically-selected route, and both can be active at once with distinct
visual treatments. Components subscribe via selectors keyed by their own
domain ID (e.g. a channel strip selects a precomputed highlight status for
`mixer:12`), so a rename of CH7 does not rerender CH12.

`meterLevels` (step 15) is deliberately a fourth path rather than folded into
the runtime slice above: it changes far faster than selection/hover/
connection ever do, and every strip subscribes to it through its own
primitive selector (one channel's own level, `state.meterLevels?.[ch - 1] ??
null`) so a meter tick only rerenders the 32 strips, never anything that
reads `routeIndex`/`channels`/`discrepancies`/`baseline`.

`hoverPinned` is the touch half of the same slice: a click or tap makes the
hovered endpoint *stick*, so the route stays lit and the tooltip stays up
after the pointer has gone. Touch devices have no hover at all, and the
schematic's primary interaction is hover — so without this the tool's whole
point is unreachable on a tablet. It is one extra bit on the existing slice
rather than a second slice, which keeps the per-endpoint status a single
primitive (`HoverStatus` gains a `pinned` value, and `hoverModifier` maps it
to the hovered class plus a `--pinned` cue). A real hover always beats a pin,
so nothing a mouse user does can get stuck. It stays independent of
`selectedChannel` in both directions: what the operator is inspecting and what
the desk has SELECTed are different facts, shown in different colour families,
and both can be true of one strip at once.

`hoveredEndpoint` (issue #11) is one slice covering *both* graphs: input and
output endpoint ids are disjoint (§3 "Identifiers"), so `selectHoverStatus`
consults `routeIndex.byEndpoint` first and falls back to
`outputRouteIndex.byEndpoint` — exactly one of the two can ever hold an entry
for a given hovered id. There is no output selection layer: the console's
SELECT reports input strips only, so `selectedChannel` and its highlight stay
input-only, unchanged by this issue.

The wholesale-block distinction (docs/venue-betania.md "a block is presented
wholesale, but only some sockets are patched") is **not** read off
`OutputRouteIndex` — a shared route's `destinations` reads identically for
every physical socket on it, wholesale-uncabled siblings included (§3
"Output route resolution"). Two small memoized helpers under
`apps/web/src/installation/` answer the two questions this needs, both keyed
off `installation` alone (never the route index): `outputSlotsFor` (which
console Out slot a physical socket carries — a structural fact, true even for
an `off` slot) and `physicalOutputDestinationsFor` (whether *this exact*
socket is declared cabled to a destination). `format/tooltip.ts` and the
`OutputPort`/`ConsoleOutputs` components both read these directly, the same
way `Stagebox.tsx` already reads `aes50LabelsFor`.

## 6. Gateway: how the web app gets mixer data

The web app talks to a narrow `MixerGateway` (same event shapes as
`MixerClient`, minus connect lifecycle details):

- **Live mode**: `WebSocketMixerGateway` — connects to the bridge, receives a
  `snapshot` message then incremental events (types from `packages/protocol`).
- **Mock mode** (default for dev): `LocalMockGateway` — wraps a
  `MockMixerClient` instance running *in the browser*; no bridge process
  needed. The dev control surface (visible only in this mode, clearly labeled
  "simulated data") drives the mock directly.

Mode is chosen at startup (env/query param). Nothing outside the gateway
module knows which mode is active.

## 7. Bridge protocol (`packages/protocol`)

WebSocket, JSON messages, discriminated unions shared as TS types:

```ts
type ServerMessage =
  | { type: "snapshot"; snapshot: MixerSnapshot; mixerConnection: MixerConnectionState;
      baseline: MixerSnapshot | null }       // baseline added in step 13
  | { type: "event"; event: MixerEvent }     // re-uses mixer-contracts types
  | { type: "baseline-changed"; baseline: MixerSnapshot }
  | { type: "baseline-save-rejected"; reason: string }   // save couldn't be honoured
  | { type: "meters"; levels: number[] };                // step 15, see below

type ClientMessage =
  | { type: "resync" }                       // explicit full-snapshot request
  | { type: "save-baseline" };               // bless the current live snapshot
```

`MixerSnapshot` gains `outputs?: MixerOutputState[]` (issue #11, 16 entries)
and `MixerEvent` gains `{ type: "output-source-changed"; output: number;
source: MixerOutputSourceRef }` — the output-side mirror of `channels` and
`channel-source-changed`. Both are guarded tolerant of a peer that omits them
entirely (mirroring the `updateAvailable` compatibility pattern): an absent
`outputs` field parses as `undefined`, not `[]` — unlike `aes50Chain`, which
normalizes absence to `[]` — so a snapshot from a bridge that predates this
field round-trips unchanged rather than gaining a phantom empty array. The web
app's `applySnapshot` treats `snapshot.outputs ?? []` the same way it already
treats `snapshot.aes50Chain ?? []`.

On WS connect the bridge sends `snapshot` immediately (from its cached state,
even if the X32 is currently unreachable — the topology and last-known config
still render, with `connection: "disconnected"`). All subsequent changes are
`event` messages. If the bridge itself resyncs with the X32 (reconnection), it
pushes a fresh `snapshot` to all clients.

### Baseline persistence (step 13)

`save-baseline` is the only client message with a side effect, and the side
effect is confined to the bridge's own disk — it **never** writes to the
mixer (invariant 5 untouched). The bridge persists the current resolved
snapshot as JSON (`X32_BASELINE_FILE`, default `data/baseline.json`,
gitignored), reloads it on startup, and answers a successful save with a
`baseline-changed` broadcast to every client. Saves are rejected while the
mixer is disconnected or the snapshot incomplete — nobody blesses a half-read
state. Mock mode (no bridge) persists via localStorage behind a small
`BaselineStore` seam in the web gateway module. A golden-scene alternative
(parsing a console `.scn` export) was considered and deferred — see
docs/x32-protocol.md "Scenes and stored state".

### Meters (step 15)

`meters` is forwarded straight from the adapter's `subscribeMeters` callback
(no extra throttling — the console's `time_factor` already paces it, see
docs/x32-protocol.md "Meters") to every connected client, rounded to 3
decimals to keep frames small; the bridge skips sending entirely when no
client is connected. Like `save-baseline`'s side effect, this stays confined
to relaying already-read-only data — no mixer write is involved. In mock mode
`LocalMockGateway` wires `MockMixerClient.subscribeMeters` the same way,
straight to the store's `meterLevels` slice.

### Installation topology at runtime (issue #3)

`GET /api/installation` — plain HTTP, same port as the WS API and the static
web app, matched before any static file resolution. The bridge reads
`installation.yaml` once at startup (`X32_INSTALLATION_FILE`, default
`installation.yaml` in the state directory — see "Where the installation file
lives" below) via `@x32/installation/node`, and serves it back **as raw YAML
text**
(`Content-Type: text/yaml`, `Cache-Control: no-cache`) — never parsed JSON.
Keeping `parseInstallationYaml` the only thing that turns text into an
`Installation` means the bridge and the browser can never disagree about what
a file means.

A missing or invalid file is logged once and the route answers `404` — never
an empty `200`, and never fatal to startup; the WS API and any configured
static serving come up regardless. The web app's `loadInstallation`
(`apps/web/src/installation/loadInstallation.ts`) has **this endpoint as its
only source**: a rejected fetch, a non-2xx status or an unparseable body all
raise, and `main.tsx` renders the full-page startup error. There is no bundled
`?raw` fallback (removed in issue #26): a fallback can only ever render *some
other* installation, and a schematic that answers "which socket is this
channel on?" confidently and wrongly is a worse outcome than one that says it
has nothing to show. It is also what let a venue's `installation.yaml` leave
the repository entirely (issue #24) — the build no longer needs one to exist.
One code path serves dev and production alike; under the Vite dev server the
`/api` proxy in `apps/web/vite.config.ts` forwards the same request to the
bridge's own port.

#### Where the installation file lives (issue #26)

Two files, and the distinction is the whole point:

| | Path | Lifecycle |
| --- | --- | --- |
| **Live** | `<state dir>/installation.yaml` — the same directory as `baseline.json`; `%ProgramData%\X32RoutingVisualizer\` under the MSI, `data/` in dev | Venue data. Created once; never removed or overwritten by any upgrade or uninstall. `Users` has Modify, so a tech edits it without admin rights. |
| **Seed** | `config/installation.yaml` next to the server module, i.e. inside `%ProgramFiles%` | Program data. Removed and reinstalled wholesale by `MajorUpgrade`. |

`config.ts`'s `resolveStateDirectory` derives the state directory from
`resolveBaselineFilePath` rather than taking a second setting, so the two
things that must live together cannot drift apart.
`resolveInstallationFilePath` is then `X32_INSTALLATION_FILE ?? <state
dir>/installation.yaml`.

On startup `seedInstallationFile` (`installationFile.ts`) copies the seed into
the live path **only when the live path does not exist**, via the same
temp-file + `rename` the baseline uses. Before this, the live file *was* the
`%ProgramFiles%` copy, so every venue edit was silently destroyed by the next
MSI upgrade — the kind of failure that surfaces months later, at a venue, to
someone who did not make the edits. Seeding never replaces an existing file
for the same reason a release never replaces `baseline.json`.

This turns a cabling correction at the venue into a file edit plus a service
restart — no rebuilt release, no MSI reinstall. There is deliberately no file
watching: a service restart is the trigger a tech will reach for anyway after
editing (see docs/installation.md for the location and procedure).

## 8. End-to-end event flow (live mode)

```text
Operator presses SELECT on CH12
  → X32 sends UDP OSC: /-stat/selidx ,i 11          (0-based)
  → x32 adapter decodes, translates index (+1), emits
      { type: "selected-channel-changed", channel: 12 }
  → bridge fans out over WS: { type: "event", event: ... }
  → web gateway dispatches to store: selectedChannel = 12   (runtime slice only;
      routeIndex untouched)
  → selectors: routeIndex.byMixerChannel.get(12) → route endpoints
  → components with matching endpoint IDs re-render with the
      "selected-on-console" highlight
```

A `channel-source-changed` event instead updates the `channels` slice and
recomputes `routeIndex`; hover state changes touch only `hoveredEndpoint`.

## 9. Future boundaries (design for, don't build)

- `InstallationRepository` can later replace the static YAML load; the web
  app already fetches topology at runtime (§7). The schematic's *membership
  and grouping* are already data-driven — devices are partitioned by their
  optional `group`, and no device id appears in component code — so a
  `LayoutRepository` would only need to own the remaining hard-coded part:
  the order of the sections themselves.
- Diagnostics: implemented as the baseline diff (§3 "Routing diff", §7
  "Baseline persistence"). Possible later extension: parse a console `.scn`
  scene export as an alternative expected-state source (deferred).
- Output routing adds new `EndpointRef` kinds and edges to the same graph.
- Write support adds command methods to `MixerClient` — kept conceptually
  separate from the read path.

## 10. Explicitly out of scope

No databases, CQRS/event sourcing, Redux, message brokers, React Flow/canvas,
generic graph editors, draggable nodes, multi-tenant support, settings
screens, or mixer write operations.
