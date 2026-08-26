# X32 OSC protocol — verified subset

The MVP subset of the X32 OSC protocol, verified against Patrick-Gilles
Maillot's *Unofficial X32/M32 OSC Remote Protocol* (fetched 2026-08-23 from
<https://x32ram.com/wp-content/uploads/download-files/X32-OSC.pdf>; see also
<https://github.com/pmaillot/X32-Behringer>). Values below were read from that
document, not guessed. Firmware note: `/config/userrout/*` and the `UIN`
routing blocks require FW 4.0+.

Transport: OSC 1.0 messages over **UDP port 10023**. No bundles required for
our subset. Argument types used: `i` (int32), `s` (string), `f` (float32).

**Only `apps/x32-bridge/src/x32/` may contain any of the knowledge in this
file.** All 0-based/1-based translation happens there and nowhere else.

## Reading values

Sending an address with **no arguments** is a read; the console replies with
the same address plus the current value (identical wire format to an
`/xremote` change echo — so one decoder handles snapshot reads and live
updates). `/node ,s <path>` (no leading `/` in the argument) returns a whole
config node as one plain-text line; optional optimization, not needed for MVP.

## Subscribing to changes

- `/xremote` (no args): console pushes all parameter changes to the client
  for **10 seconds**; renew it on an interval (we use ~8 s).
- Changes arrive as ordinary messages: address + new value, e.g.
  `/-stat/selidx ,i 11`.
- Liveness: any decoded datagram from the console — a read reply, a pushed
  `/xremote` change, a `/meters/1` blob — counts as proof of life. The
  liveness-poll tick only falls back to an explicit `/xinfo` (no args) probe
  once the console has been silent for a full poll interval; a missed reply
  to *that* probe ⇒ mark disconnected, keep retrying, and perform a **full
  resync** (snapshot re-read) on reconnect. Requiring a fresh `/xinfo` reply
  on every tick regardless of other traffic caused false disconnects under
  load even while `/xremote`/meter data was flowing continuously — see
  §Discovery below for the matching discovery-side fix from the same
  incident.

## The messages we track

| Address | Type | Meaning |
|---|---|---|
| `/-stat/selidx` | int 0–71 | Currently selected strip. **0–31 = Ch 1–32**; 32–39 Aux in 1–8; 40–47 FX return; 48–63 Bus; 64–69 Matrix; 70 L/R; 71 M/C. Values ≥ 32 → `selectedChannel = null` in our model. |
| `/ch/[01…32]/config/name` | string | Channel name, max 12 chars. |
| `/ch/[01…32]/config/source` | int 0–64 | Channel input source: 0 = OFF; **1–32 = In 01–32**; 33–38 = Aux 1–6; 39 = USB L; 40 = USB R; 41–48 = FX 1L–4R; 49–64 = Bus 01–16. |
| `/config/routing/IN/1-8`, `/9-16`, `/17-24`, `/25-32` | int 0–23 | Which physical block feeds input slots In 1–32. Enum order: 0–3 `AN1-8…AN25-32` (local), 4–9 `A1-8…A41-48` (AES50-A), 10–15 `B1-8…B41-48`, 16–19 `CARD1-8…CARD25-32`, 20–23 `UIN1-8…UIN25-32` (User In). |
| `/config/routing/IN/AUX` | int 0–15 | Aux-remap block; not needed for CH 1–32 MVP, ignored. |
| `/config/routing/routswitch` | int 0/1 | 0 = REC (the `IN` blocks are active), 1 = PLAY (the `PLAY` blocks are active). MVP: bridge logs a clear warning when PLAY is active and keeps resolving IN/REC blocks; an operator-visible UI notice is deferred (needs a protocol field). |
| `/config/userrout/in/[01…32]` | int 0–168 | User In slot mapping: 0 = OFF; 1–32 = Local In; **33–80 = AES50-A 1–48**; 81–128 = AES50-B 1–48; 129–160 = Card In 1–32; 161–166 = Aux In 1–6; 167 = TB Internal; 168 = TB External. |
| `/xinfo` | 4 strings | Liveness + console model/firmware for the status display. |
| `/-stat/aes50/[A,B]` | string | Detected box chain and preamps (issue #17): `string[4]` of device letters (`A`…`Z`, `a`), one per chain position, followed by 6 chars of preamp type. Device letters: `A` S16, `B` X32C, `C` X32, `D` DL251, `E` DL251HA, `F` S16B, `G` Z32, `H` T8, `I` X32P, `J` X32RACK, `K` X32CORE, `L` M32, `M` M32R, `N` DL16, `O` DL16B, `P` SD16, `Q` SD16B, `R` SD8, `S` SD8B, `T` DL15X, `U` DL15XHA, `V` DL231, `W` S32, `X` S32B, `Y` DL32, `Z` DL32B, `a` M32C. Preamp types (parsed and kept, not yet surfaced): `0` digital, `1` 8chin_A, `2` 8chin_C, `3` DL251, `4` Z32. Parsed defensively (`apps/x32-bridge/src/x32/aes50.ts`): a character that *is* a letter but isn't in this table is a real, undercatalogued box (kept as `model: null`, `rawLetter` retained); a character that isn't a letter at all — the doc does not say what the console pads an empty chain position with — is filler and the position is omitted. The raw string is logged once per snapshot (`x32MixerClient.ts`) so the real filler format can eventually be read off the venue console. |
| `/-stat/aes50/state` | int bitfield | Audio/aux error + lock (issue #17): bit 0 A audio error, bit 1 B audio error, bit 2 A aux error, bit 3 B aux error, bit 4 lock. Valid range 0–31; anything else (including negative) is out of spec and ignored with one logged warning, never guessed at. |
| `/outputs/main/[01…16]/src` | int 0–76 | What feeds console XLR out 1–16 (issue #10): 0 = OFF; 1–3 Main L, Main R, M/C; 4–19 MixBus 01–16; 20–25 Matrix 1–6; 26–57 DirectOut Ch 01–32; 58–65 DirectOut Aux 1–8; 66–73 DirectOut FX 1L–4R; 74/75 Monitor L/R; 76 Talkback. Out-of-range or non-integer values degrade to `{ off }` with one logged warning, never thrown — the input side's stance on hostile wire data. |
| `/config/routing/OUT/{1-4,5-8,9-12,13-16}` | int 0–35 | Block routing for the console's own XLR outs, in groups of four (issue #10). **Read and logged at snapshot only — nothing in resolution depends on it.** `installation.yaml` assumes console XLR *n* carries Out *n* (the console default); the actual default value is not known from the protocol document, so a warning here would risk a false alarm rather than a real finding. A follow-up can add one once the default is verified at the venue. |

Doc footnote worth remembering: with `/-prefs/autosel` ON the console
generates `/-stat/selidx` for all strips except L/R on its own (fader-touch
auto-select); harmless for us — we treat every selidx the same.

## Resolution algorithm (adapter-side)

The adapter resolves each channel's *effective* source to a flat
`MixerSourceRef` before anything leaves the bridge:

```text
source = /ch/NN/config/source
1. source == 0            → { off }
2. source in 33..64       → aux/usb/fx/bus (mixer-internal, unmapped)
3. source in 1..32        → input slot m = source
   block = IN block covering m   (1-8 | 9-16 | 17-24 | 25-32)
   k = m - blockStart            (0-based position within the block)
   switch (block value):
     AN x-y   → { local,  input:  anBase  + k }
     A x-y    → { aes50,  bus: A, channel: aBase + k }
     B x-y    → { aes50,  bus: B, channel: bBase + k }
     CARD x-y → { card,   input:  cardBase + k }
     UIN x-y  → u = uinBase + k        (User In slot 1–32)
                indirect via /config/userrout/in/u:
                  0 → off; 1–32 local; 33–80 aes50-A (v−32);
                  81–128 aes50-B (v−80); 129–160 card (v−128);
                  161–166 aux; 167/168 talkback
```

Recomputation triggers: a `/ch/NN/config/source` change affects one channel;
a `/config/routing/IN/*` change affects up to 8 channels; a
`/config/userrout/in/NN` change affects every channel whose slot resolves
through that user-in entry. In each case the adapter re-resolves the affected
channels and emits one `channel-source-changed` per changed channel.

## Initial snapshot

On (re)connect, in order:

1. `/xinfo` — liveness + model info.
2. `/config/routing/routswitch`, `/config/routing/IN/{1-8,9-16,17-24,25-32}`.
3. `/config/userrout/in/01…32` (32 reads).
4. `/ch/01…32/config/name` and `/ch/01…32/config/source` (64 reads).
5. `/outputs/main/01…16/src` (16 reads) and `/config/routing/OUT/{1-4,5-8,9-12,13-16}`
   (4 reads, gathered/logged only — issue #10).
6. `/-stat/selidx`.
7. `/-stat/aes50/A`, `/-stat/aes50/B`, `/-stat/aes50/state` (issue #17 — same
   family as `/-stat/selidx`; both buses are read even though the venue only
   uses AES50-A, so the adapter can tell "B genuinely has no boxes" from "we
   never asked").
8. Start the `/xremote` renewal loop.

~125 small UDP request/replies; replies are decoded by the same handler as
live updates, then the resolved snapshot is normalized into `MixerSnapshot`.
UDP is lossy: snapshot reads need per-request timeout + retry, and the
periodic `/xinfo` poll doubles as the disconnect detector.

## Index translation (bridge-internal, never leaks)

| X32 wire | Domain |
|---|---|
| `selidx` 0–31 | `MixerChannelId` 1–32 |
| `selidx` 32–71 | `null` (non-input strip) |
| `/ch/NN/...` address path | already 1-based (`01`–`32`) — use as-is |
| `config/source` 1–32 | input slot 1–32 |
| routing block enums | offsets per the tables above (1-based results) |
| `userrout/in` values | per the table above (1-based results) |

## OSC codec

The subset needs only: encode/decode of address + `,i`/`,s`/`,f` argument
lists with 4-byte alignment. A small hand-rolled codec (~100 lines) with
byte-level fixture tests is preferred over pulling in an OSC dependency;
revisit if needs grow.

## Meters (step 15, corrected #13)

Verified against the real console (fw 4.06, 2026-08-24). Subscribing:

```text
/meters ,siii "/meters/1" 0 0 <time_factor>
```

- The string argument is the reply address the console will push blobs to
  (`/meters/1` — the "block 1" input-channel meters).
- **`time_factor` is the FOURTH argument**, not the second. The Maillot
  document's `,si` form (`["/meters/1", time_factor]`) was tried first and is
  **silently ignored by the console** — it falls back to its 50ms (~20Hz)
  default regardless of the value sent, 5x the intended traffic. `,sii`
  (3 args) is likewise ignored. Only `,siii "/meters/1" 0 0 <time_factor>`
  actually paces the reply rate; measured over 2s at `time_factor = 5`:
  **4.0Hz (250ms)**, matching the doc's intent. The two integer zeros ahead
  of `time_factor` are the unused `chn_meter_id`/`grp_meter_id` slots.
- `time_factor` paces the reply rate; we use **5** (~250ms cadence — the doc's
  range is roughly 4–5 for ~200–250ms). Set console-side, not something the
  client throttles.
- Like `/xremote`, the subscription lives about **10 seconds** on the
  console and must be renewed — we renew it on the exact same tick as
  `/xremote`'s renewal loop (comfortably inside the 10s window; see
  `X32MixerClient`'s `#startXremoteRenewal`).

Reply, unsolicited once subscribed:

```text
/meters/1 ,b <blob>
```

`<blob>` is a plain OSC 1.0 blob envelope — **int32 big-endian** byte count,
then that many bytes, zero-padded to a 4-byte boundary (`osc.ts`'s generic `,b`
support). Its *contents* are a separate, smaller format with the **opposite**
endianness from the rest of this protocol:

```text
int32  <float count>   -- LITTLE-endian (unlike every other int on the wire)
float  x <count>        -- LITTLE-endian (unlike every other float on the wire)
```

The block 1 reply carries **96 floats**; the adapter takes only the **first
32** as the input channel levels (1-based: index 0 = channel 1), decoded by
`decodeMeterBlob` in `apps/x32-bridge/src/x32/meters.ts` — kept separate from
the generic OSC blob envelope in `osc.ts` precisely because of that
endianness flip.

Values are **linear amplitude in 0.0–1.0**, where **1.0 = full scale** —
verified against the real console (fw 4.06, 2026-08-24): a channel driven to
peak read exactly `1.0`; a live mic in a quiet room read `0.001–0.004`
(≈ −60…−50 dBFS, consistent with linear amplitude). The web app converts to a
visual bar height with a dB mapping and a −60 dBFS floor
(`apps/web/src/format/meter.ts`), not a plain linear or power-curve scale.

Meters intentionally never touch `MixerEvent`/the WebSocket `event` message
(architecture.md §4/§7): they update several times a second, which would make
every other event consumer pay for traffic it doesn't care about. They ride
their own `MixerClient.subscribeMeters` capability and their own `meters` WS
message instead.

## Discovery (step 18)

X32-Edit's own LAN discovery is exactly what the bridge implements: broadcast
`/info` (no args) to `255.255.255.255:10023` from a UDP socket with
`SO_BROADCAST` enabled, then collect whatever replies arrive within a short
window. Each reply's *source IP* (`rinfo.address`, not anything in the
payload) is the console's address.

Reply shape — `,ssss` (4 strings), same wire shape as `/xinfo` but different
addressee and semantics:

```text
/info ,ssss <server version> <server name> <console model> <console firmware>
```

e.g. `"V2.05", "osc-server", "X32C", "2.08"`.

Implementation (`apps/x32-bridge/src/x32/discovery.ts`):

- `discoverX32` — one-shot: collects replies for **1500ms** by default, then
  resolves with whatever was found — an empty array if nothing replied.
  Never throws: a machine that forbids broadcast (permission error enabling
  `SO_BROADCAST`, no usable interface, etc.) must not crash the bridge, just
  find nothing.
- Dedupes by source IP.
- Selection when the bridge picks a host to connect to
  (`apps/x32-bridge/src/config.ts`): one responder → use it; several → log
  all of them and use the lowest IP, deterministically; none → log an
  actionable message (`set X32_HOST=<ip>`) and still start the bridge
  disconnected (architecture.md §7 — the schematic and last-known baseline
  render regardless).
- `X32_HOST`, when set, is an explicit override and skips discovery entirely
  (unchanged fixed-host behaviour).

**The console tolerates only a few subscribed clients at a time** (`/xremote`
max four, per the doc above) — the client table is small enough that other
consumers of it (X32-Edit elsewhere in the building, another bridge) are
affected too, not just this one. Opening a fresh UDP socket per discovery
attempt presents the console with a *new* client identity every time, and a
bridge that can't reach the console retries that constantly: confirmed
operationally on 2026-08-24, probe sockets crowding the desk made an
unrelated, otherwise-healthy bridge flap, and killing them restored 0
disconnects/0 resyncs over 50s. So the reconnect path does **not** call
`discoverX32` repeatedly. Instead:

- `createX32Discoverer()` returns an `X32Discoverer` that owns **one** socket
  across every `discover()` call for its whole lifetime — repeated discovery
  presents the console with one identity, not one per attempt. `config.ts`
  constructs one per `X32MixerClient` in discovery mode and wires its
  `discover()` into `resolveTransport`, called on the bridge's first connect
  attempt and on every later reconnect attempt while disconnected (the
  `/xinfo`-liveness-poll cadence, docs §Subscribing) — this is what recovers
  from a DHCP lease change on the venue's console, not just "console was off
  at bridge startup".
- The discoverer also owns an internal **backoff**, escalating 2s → 4s → 8s →
  16s → 30s (capped) on each failed attempt and resetting to the base on
  success. A call made inside the backoff window touches the network not at
  all and resolves `[]` immediately, so the 5s poll loop can keep calling it
  on every tick without hammering the console during a genuine outage.
  Failures are logged once per backoff escalation (distinguishing "no console
  replied", "could not open/bind the socket", and "broadcast not permitted"),
  not once per attempt — the strict per-attempt-socket version of this logged
  the same line 26 times in one session.
- `X32Discoverer.close()` releases the socket; `X32MixerClient.disconnect()`
  calls it (via the `closeTransportResolver` constructor option) — no
  discovery socket outlives the client.
- `discoverX32` itself is unchanged and still fine for one-shot use; it's
  simply no longer what the reconnect path calls repeatedly.

`UdpTransport` (the seam `X32MixerClient` reads/writes through) doesn't fit
discovery: it's unicast to one fixed remote and never exposes a reply's
sender address. Discovery instead defines its own narrow `DiscoverySocket`
seam, confined to `discovery.ts` — `node:dgram` still never leaks outside
`apps/x32-bridge/src/x32/`. Reusing the *main* `UdpTransport` socket for the
broadcast (one identity for everything, not just discovery) was considered
and left for a future consolidation — `UdpTransport` is a unicast seam with
no sender-address exposure, and widening it was a bigger change than this
fix needed.

## Scenes and stored state (investigated 2026-08-24)

The console stores **scenes** (full console state, 100 internal slots, saved
as ~2,105-line `.scn` text files, exportable to USB) and **snippets**
(partial). Verified against the Maillot document: OSC exposes only scene
*metadata* (`/showdump`, `/-show/showfile/scene/NNN/name`, safes flags) — a
stored slot's **contents** cannot be read remotely. The only way to get a
stored scene into OSC-readable state is `/load scene N`, which recalls it
into the audio engine and **mutates the live desk** — off-limits for this
read-only tool (Maillot's own `X32GetScene` builds `.scn` files from the
*live* state for the same reason).

Consequence: the diagnostics baseline (architecture.md §7) is **captured from
the live state** and stored by the bridge, not read from a scene slot.
Parsing a `.scn` USB/X32-Edit export as an alternative expected-state source
is possible (the file contains exactly our node subset as text lines) but
deferred — it reintroduces a manual file-handling step the capture workflow
exists to avoid.

## Output routing (issue #6 — research; issue #10 implemented `/outputs/main/*/src`)

Verified against the same Maillot document as the input subset (fetched
2026-08-23). This research underpins the output milestone (#8–#11). Three
pieces are now implemented, per §The messages we track above:

- `/outputs/main/[01…16]/src` — read at snapshot and tracked live (issue #10).
- `/config/routing/OUT/{1-4,5-8,9-12,13-16}` — read at snapshot and logged
  only; nothing resolves from it yet (issue #10 scope item 5 — the console's
  actual default is not known from the document, and building a warning on a
  guessed default would risk a false alarm at the venue).
- `/-stat/aes50/[A,B]` and `/-stat/aes50/state` — input-side diagnostics, not
  output routing strictly speaking, implemented by issue #17.

Everything else below (`AES50A`/`AES50B` block routing, the aux/P16/AES/rec
output addresses, `userrout/out`, and the OSC-invisible stagebox hop) remains
research only — no code reads it yet.

### The chain

An output signal leaves the console by one of two independent paths:

```text
bus / matrix / main / direct-out
   │
   ├─► console XLR out N        /outputs/main/[01…16]/src        (0…76 enum)
   │
   └─► AES50 output channels    /config/routing/AES50A/<block>   (0…35 enum)
             │
             ▼
       stagebox picks ONE block of 8 for its physical XLR outs
             │                  ✗ NOT OSC-VISIBLE — see below
             ▼
       amp / wedge / zone       ✗ installation.yaml fact
```

### Tracked addresses

| Address | Type | Meaning |
|---|---|---|
| `/outputs/main/[01…16]/src` | int 0–76 | What feeds console XLR out 1–16: 0 = OFF; Main L; Main R; M/C; MixBus 01–16; Matrix 1–6; DirectOut Ch 01–32; DirectOut Aux 1–8; DirectOut FX 1L–4R; Monitor L; Monitor R; Talkback. |
| `/outputs/main/[01…16]/pos` | int 0–8 | Tap point: `IN/LC, IN/LC+M, <-EQ, <-EQ+M, EQ->, EQ->+M, PRE, PRE+M, POST`. Affects *what* the signal is, not *where* it goes — informational for a routing schematic. |
| `/outputs/aux/[01…06]/src`, `/outputs/p16/[01…16]/src`, `/outputs/aes/[01…02]/src`, `/outputs/rec/[01…02]/src` | int 0–76 | Same enum, for the aux / P16 (Ultranet) / AES / recorder outputs. |
| `/config/routing/AES50A/{1-8,9-16,17-24,25-32,33-40,41-48}` (and `AES50B/…`) | int 0–35 | Which internal block of 8 the console **transmits** on those AES50 output channels. Enum: 0–3 `AN1-8…AN25-32`; 4–9 `A1-8…A41-48`; 10–15 `B1-8…B41-48`; 16–19 `CARD1-8…CARD25-32`; 20–21 `OUT1-8, OUT9-16`; 22–23 `P161-8, P169-16`; 24 `AUX1-6/Mon`; 25 `AuxIN1-6/TB`; 26–31 `UOUT1-8…UOUT41-48`; 32–35 `UIN1-8…UIN25-32`. |
| `/config/routing/OUT/{1-4,5-8,9-12,13-16}` | int 0–35 | Block routing for the console's own XLR outs, in groups of **four** (not eight). Same enum shape but quartered, e.g. `AN1-4, A1-4, …`. Note this coexists with the per-output `/outputs/main/NN/src` patch. |
| `/config/userrout/out/[01…48]` | int 0–208 | User Out table: 0 = OFF; 1–32 Local In; 33–80 AES50-A 1–48; 81–128 AES50-B 1–48; 129–160 Card In; 161–166 Aux In; 167/168 TB int/ext; **169–184 Outputs 1–16; 185–200 P16 1–16; 201–206 AUX 1–6; 207/208 Monitor L/R**. The output-side analogue of `userrout/in`, reached when a block above is set to a `UOUT…` value. |

### The hop OSC cannot see

An S16/SD16-class box has 16 inputs but only **8 analog outputs**, while the
AES50 link carries 48 output channels. Which block of 8 a given box presents
on its XLRs is selected **on the box itself** (DIP switch / panel), and a
search of the protocol document found **no OSC address that reports or sets
it**. It is therefore a static physical fact and belongs in
`installation.yaml`, exactly like the input-side cascade offsets — with the
same caveat that re-ordering or re-configuring a box invalidates it silently.

Confirming each box's setting at the venue is a prerequisite for the output
milestone (issue #7).

### Two findings, now implemented independently of outputs (issue #17)

1. **`/-stat/aes50/A` identifies the cascade.** It reports which boxes are
   detected and in what order, so the console can confirm what
   `installation.yaml` asserts — the two 16-in boxes, their models (previously
   recorded as "exact model unknown" in docs/installation.md — now readable
   from the console), and their chain order. `compareAes50Chain`
   (`packages/domain/src/aes50.ts`) cross-checks the detected chain against
   the declared stageboxes and surfaces a mismatch in the UI as "Stage boxes
   differ from configuration"; it never auto-corrects `installation.yaml`.
2. **`/-stat/aes50/state` is a real diagnostic.** Audio-error and lock bits on
   each AES50 port are precisely the kind of fault this tool exists to surface
   — a dead snake link previously looked identical to "no signal patched".
   The bridge tracks it and the web app shows a prominent warning
   ("AES50-A: link error — check the stage boxes") when there's an audio
   error on a bus the installation actually declares stageboxes on; an error
   on an unused bus (this venue's AES50-B) is deliberately silent.

### Open questions for the venue (issue #7)

- Each box's output-block setting (the invisible hop above).
- Whether the console's own XLR outs are in use, and what they feed.
- Whether P16/Ultranet is in use.
- Whether output routing goes through `userrout/out` at all, as the input side
  does through `userrout/in`.
