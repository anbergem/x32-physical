# Venue installation facts & `installation.yaml` schema

## Confirmed facts (from the owner, 2026-08-23)

- Two stageboxes, each **16 in / 8 out** (S16/SD16-class; exact model unknown
  and irrelevant to the input model — labeled generically for now). The exact
  model no longer has to be taken on faith: the console reports the detected
  chain over OSC (`/-stat/aes50/A`, docs/x32-protocol.md §Output routing
  "Two findings"), and the app cross-checks it against this file
  (`compareAes50Chain`, issue #17), surfacing a mismatch rather than
  guessing or auto-correcting.
- The boxes are **daisy-chained on AES50-A**: stagebox-1 connects to the
  console's AES50-A port, stagebox-2 cascades through stagebox-1. The console
  therefore sees one AES50-A bus with 32 active input channels:
  - **stagebox-1: offset 0** → inputs 1–16 appear as AES50-A 1–16
  - **stagebox-2: offset 16** → inputs 1–16 appear as AES50-A 17–32
- **AES50-B is unused.**
- The console's input routing **uses User In mapping** (`/config/userrout/in`),
  not only plain AES50 blocks — the adapter must resolve the User In
  indirection (see docs/x32-protocol.md).
- Output side (8 out per box) is out of scope for the read-only input MVP.

Chain-order caveat: AES50 input slots are positional in a cascade. If the
boxes are ever physically re-ordered or a third box is added, only the
`offset` values in `installation.yaml` need to change.

## Real panel wiring (captured 2026-08-24)

From the venue patch sheet "Betania Lydsystem - Inputs". Venue labels are
Norwegian: **V** = venstre (left), **H** = høyre (right).

- **Left**: passive panel "MK Front V" (8 sockets) → Stagebox V inputs 1–8
  (AES50-A 1–8). Stagebox V inputs 9–16 are direct stage sockets labelled
  "V 09"–"V 16" (A9–A16).
- **Right**: Stagebox H input 1 is the direct socket "H 01" (A17, patched to
  DI HB). The passive panel "MK Front H" is an **8-position** link box whose
  usable sockets feed Stagebox H inputs 2–8 (A18–A24). Inputs 9–16 are
  direct sockets "H 09"–"H 16" (A25–A32). Two quirks of this plate, both
  confirmed on site 2026-08-24:
  - **Physical position 1 is broken** and connected to nothing.
  - **The printed labels are shifted by one**: the label "1" is on physical
    position 2, "2" on position 3, and so on through "7" on position 8. The
    installer's convention appears to have been "1 = the first *usable*
    input at front stage right", which is defensible but means a printed
    label never matches its physical position on this plate.

  `installation.yaml` therefore models this panel as 7 sockets numbered by
  the **printed labels** (socket 1 → A18 …), which is what a tech standing
  at the plate reads and is functionally correct. It does not yet show the
  dead 8th position, so the app displays 7 holes where the wall has 8.
  How to visualise that is deliberately unresolved — see issue #12.
- The direct-socket stage labels match the box input numbers ("H 12" =
  Stagebox H input 12 = A28), which is what the UI's dual labels display.
- The desk also has three local inputs in use at FOH (IN 1–3: Bøyle,
  Håndholdt 1/2). Console-local sockets are outside the stage topology and
  surface in the UI as "Local N" sources; modeling the desk as a device is a
  possible future schema extension.
- Channel assignments on the sheet (Vokal V1 → C5, …) are live mixer
  configuration, read from the console at runtime — never recorded in YAML.

## `installation.yaml` schema (v1/v2)

Validated with Zod at load; invalid topology fails startup with a message
naming the offending device/connection. **No coordinates, ever** — visual
layout is a separate concern.

`version: 1` and `version: 2` are accepted and behave **identically**. Every
v2 addition below is optional, so a v1 file with no output content stays
valid; `2` is only a signal that the file uses output features — the repo's
own `config/installation.yaml` is `2` because it does.

```yaml
version: 1

devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  stagebox-2:
    kind: stagebox
    label: "Stagebox 2"
    inputs: 16
    aes50: { bus: A, offset: 16 }

  front-left:                 # placeholder — real panels TBD
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:                  # panel socket → stagebox input (signal direction)
  - from: { device: front-left, input: 1 }
    to:   { device: stagebox-1, input: 1 }
  # ...
```

Schema rules:

- `devices` is a map; keys are the `DeviceId`s (kebab-case).
- `kind: stagebox` requires `aes50: { bus: A|B, offset: int ≥ 0 }`;
  `kind: passive-panel` must not have `aes50`.
- `inputs` ≥ 1; `offset + inputs` ≤ 48; AES50 ranges on the same bus must not
  overlap.
- Every connection endpoint must name an existing device and an in-range
  input; `from` must be a passive-panel socket and `to` a stagebox input
  (until output routing widens this); a stagebox input may have at most one
  feeding panel socket. Stagebox inputs without a connection are valid — they
  are direct stage sockets.
- Stagebox→AES50 edges are **derived** from `aes50.offset`, never written in
  YAML.

The visual schematic for this venue shows both stagebox areas under AES50-A,
with sockets dual-labeled `Box 2 / 7 · A23` style, since the AES50 channel
number is what the X32's own routing screens display when debugging.

### Output additions (v2)

```yaml
devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox V"
    inputs: 16
    aes50: { bus: A, offset: 0 }
    outputs: 8                  # optional: physical XLR outs on the box
    outputBlock: { start: 9 }   # optional: first console Out slot it presents

  main-left:                    # a powered speaker/zone — no socket of its own
    kind: destination
    label: "Main Left"

connections:
  # stagebox XLR out → destination
  - from: { device: stagebox-1, output: 7 }
    to:   { device: main-left }
  # console XLR out → destination (no console device — addressed by number)
  - from: { consoleOutput: 1 }
    to:   { device: sidesal }
```

- New device kind `destination`: `label` only. It must **not** carry
  `inputs`, `aes50`, `outputs` or `outputBlock` — a destination is a
  device-level endpoint with no socket number of its own. `inputs: 0` is an
  internal detail the loader supplies on the way to the domain; it is never
  authored in YAML.
- A stagebox may declare `outputs: int ≥ 1` (its physical XLR out count) and
  `outputBlock: { start: int }` (the first console Out slot, 1–16, its block
  presents — Out `start` → the box's XLR out 1, and so on for 8 slots). Both
  optional, but declaring one without the other is a shape error: a box that
  presents a block must say how many outs it has, and a declared output count
  needs a block to sit in. `start`'s range and non-overlap with another box's
  block are domain rules, not shape ones.
- A connection's `from` may now also be `{ device: <stagebox>, output: <int
  ≥ 1> }` (a stagebox XLR out) or `{ consoleOutput: <int ≥ 1> }` (a console
  XLR out, by number alone — see below). A connection's `to` may now also be
  `{ device: <destination> }`, with no socket number.
- **Console XLR outs are addressed by number, not a console device.** A
  console device is deliberately deferred (it is entangled with modelling the
  console's own local inputs, a separate future extension) — see "Real panel
  wiring" above for the desk's local-input sockets.
- **Slot→physical-output is never written in YAML; it is always derived.**
  For a stagebox, from `outputBlock.start` (mirroring `aes50.offset` on the
  input side): mixer-output `start + n − 1` → the box's XLR out `n`, for its
  8 presented slots. For a console XLR, it is the console's identity default
  — Out *n* carries on console XLR *n*, which is what this venue uses — and
  the loader derives that same identity edge for every console XLR number a
  file references. If `/config/routing/OUT/*` is ever set non-default at a
  venue, resolving that is an adapter concern (issue #10), not a schema one.
- A physical output (stagebox XLR out or console XLR out) feeds **at most one
  destination**; a console Out slot appears on **at most one** console XLR.
  Both are domain rules (`validateInstallation`), not shape ones.

As on the input side, Zod validates shape only — field names, types, and
which fields each device kind may carry. Every semantic rule (output-block
bounds and overlap, in-range socket/output numbers, one destination per
physical output, one console XLR per Out slot) belongs to
`validateInstallation` in `@x32/domain` and is not restated in the schema.

## Editing this file at the venue (issue #3)

In production the bridge reads this file at startup and serves it to the web
app over `GET /api/installation`; the web app's own bundled copy is only a
fallback for when that fails. A cabling correction is a file edit plus a
service restart — see README.md's "Changing the physical wiring" for the
exact steps, including the `X32_INSTALLATION_FILE` override path (a
venue-local copy under `%ProgramData%\X32RoutingVisualizer\`) for a one-off
on-site fix that doesn't touch the release-shipped `%ProgramFiles%` copy.
There is deliberately no file watching — a service restart is the trigger,
not a live reload.

## Output topology (captured 2026-08-25)

From the venue sheet "Betania Lydsystem - Outputs", plus owner clarification.
**Now modelled in `installation.yaml`** (issue #9) — see "Output additions
(v2)" above for the schema and `config/installation.yaml` for the venue's
actual cabling. The bus/matrix sources ("Fed from" below) are live mixer
configuration, read from the console at runtime, and are not recorded in the
static topology file — only the physical-output → destination cabling is.

| Out | Name | Fed from | Emerges at |
|---|---|---|---|
| 1 | Sidesal | Matrix | console XLR 1 |
| 2 | Vip Rom | Matrix | console XLR 2 |
| 6 | Bak Høyre (rear right) | Bus 5 | Stagebox H out 6 |
| 7 | Piano Høyre | Bus 3 | Stagebox H out 7 |
| 8 | Front Høyre | Bus 2 | Stagebox H out 8 |
| 11 | Venstre Bak (rear left) | Bus 4 | Stagebox V out 3 |
| 12 | Piano Venstre | Bus 3 | Stagebox V out 4 |
| 13 | Front Venstre | Bus 1 | Stagebox V out 5 |
| 14 | Sub | **M/C** | Stagebox V out 6 |
| 15 | Main Left | **Main L** | Stagebox V out 7 |
| 16 | Main Right | **Main R** | Stagebox V out 8 |

Outputs 3, 4, 5, 9, 10 are unused.

### The output-block assignment — the hop OSC cannot see

docs/x32-protocol.md §Output routing records that a stagebox's choice of
*which block of 8* AES50 output channels it presents on its XLRs is set on the
box and is **not** readable over OSC. The venue sheet reveals it directly:

- **Stagebox H presents `OUT1-8`** — console Out *n* → its XLR out *n*.
- **Stagebox V presents `OUT9-16`** — console Out *n* → its XLR out *n − 8*
  (so Out 13 "Front Venstre" is physically that box's 5th XLR out).

This is the output-side analogue of `aes50.offset` and belongs in the schema
(#9) as a per-stagebox fact, with the same silent-invalidation risk: change a
box's setting and every output label is wrong with nothing to detect it.

### Two consequences for the domain model

1. **A block is presented wholesale, but only some sockets are patched.**
   Stagebox H presents all of `OUT1-8`, so Out 1 "Sidesal" and Out 2 "Vip Rom"
   are physically present on its XLR outs 1–2 as well as on the console's own
   XLRs — the sheet lists the console because that is where they are actually
   *used*. "Signal is present here" and "something is plugged in here" are
   different facts, exactly as an unconnected stagebox input is on the input
   side.
2. **One source can feed several outputs.** Bus 3 feeds *both* Out 7 "Piano
   Høyre" and Out 12 "Piano Venstre". This is the output mirror of one input
   source feeding several mixer channels, which the route index already models
   as a single shared route — the same treatment should apply.

### Answered 2026-08-25

- **The cabinets are powered** — there are no amplifiers between a stagebox
  output and a speaker. A box output therefore feeds a named destination
  directly, and the schema (#9) needs **no amplifier device kind**.
- **No console XLR outs beyond 1–2 are in use**, with two caveats below.
- **P16/Ultranet is in use** and will need modelling eventually. It is a
  different class of destination from the room speakers — 16 channels feeding
  musicians' personal mixers, addressed via `/outputs/p16/[01…16]/src` — so it
  is deliberately deferred rather than folded into the first output pass.

### Deliberately not modelled

- **The legacy recording path.** An aux L/R pair carried Matrix 1/2 into a
  computer's mic input. It has been superseded by an X-Live card taking all 32
  inputs over USB-B. Neither is a route through the venue's speakers, so
  modelling them would add devices that answer no question a technician asks.
- **A possible third output for the hearing loop** ("teleslynge" — an
  induction loop for hearing aids). Unconfirmed; to be captured later.

### Consequence of the X-Live card worth knowing

With an X-Live card fitted, **virtual soundcheck** is possible: every channel
re-sourced from `Card` instead of AES50 to rehearse against a recording. The
app already handles card sources correctly — they resolve as unmapped, which
is truthful — but two things would look alarming and are worth deciding on
before it happens for real:

1. Every channel would read "No mapped physical input" at once.
2. Against a blessed baseline, all 32 channels would report a
   `source-mismatch`, filling the header with routing issues, even though
   nothing is wrong.

A future refinement could recognise "all channels on Card" as a playback mode
and say so, rather than reporting it 32 times. Not built; noted so the first
virtual soundcheck is not a surprise.

### On physical placement

Speaker positions (Main L on the left, Main R on the right, Sub to the left of
Main L) are deliberately **not** recorded here and will not enter the schema.
The names already carry the spatial meaning a technician needs, and the
question the tool answers is "where does this come from?", not "where is it in
the room". Screen arrangement mirrors physical reality through hard-coded
layout, exactly as the stage-left/stage-right input areas already do —
CLAUDE.md invariant 6 (no coordinates in `installation.yaml`) stands.
