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
- Liveness: `/xinfo` (no args) → reply contains network address/name, model,
  firmware. Poll it periodically; missing replies ⇒ mark disconnected, keep
  retrying, and perform a **full resync** (snapshot re-read) on reconnect.

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
5. `/-stat/selidx`.
6. Start the `/xremote` renewal loop.

~100 small UDP request/replies; replies are decoded by the same handler as
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
