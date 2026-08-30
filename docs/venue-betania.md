# The Betania installation — a worked example

This is the maintainer's own venue, kept in the repository as a **worked
example** of the schema described in [installation.md](installation.md). It is
not part of the tool's definition: nothing here is required, and none of these
device names, counts or quirks are assumed anywhere in the code (that coupling
was removed in the "Open-source readiness" milestone — the schematic now
derives its layout from whatever an installation declares).

It is kept deliberately unsanitised. A real rig has a broken socket, a plate
whose printed labels disagree with its own wiring, and a hop the console
cannot report — and those awkward facts teach the schema far better than tidy
invented data would. Where this file records a decision, the reasoning is
included, because the reasoning is the transferable part.

For the schema itself — every field, every device kind, what is derived versus
declared — see **[installation.md](installation.md)**.

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

  **Owner decision (2026-08-27, issue #12): number MK Front H by physical
  position, and show the dead first socket.** `installation.yaml` models
  this panel as **8 sockets numbered by physical position**: socket 1 is
  annotated `broken` (declared metadata, not a routing fact — see
  "`sockets` — per-socket annotations" below) and connected to nothing;
  sockets 2–8 feed Stagebox H inputs 2–8 (A18–A24), exactly as their number
  suggests. This is a deliberate divergence from the plate's own printed
  labels: a technician reading the plate's printed "1" is looking at the
  app's socket 2, and so on through the plate's "7" being the app's socket
  8. The physical position is what a technician standing at the plate can
  verify by counting holes; the printed label is the thing decided to be
  the error.
- The direct-socket stage labels match the box input numbers ("H 12" =
  Stagebox H input 12 = A28), which is what the UI's dual labels display.
- The desk also has three local inputs in use at FOH (IN 1–3: Bøyle,
  Håndholdt 1/2, → CH1–CH3). Console-local sockets are modelled as a
  `console` device (issue #2): `local:<device>:<n>` endpoints, declared with
  all 32 inputs even though only three are patched — an unused one renders
  like any other unconsumed socket. The console block sits with the mixer
  section in the schematic, not the stage areas, since it is physically at
  FOH.
- Channel assignments on the sheet (Vokal V1 → C5, …) are live mixer
  configuration, read from the console at runtime — never recorded in YAML.

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

The "Fed from" column below was **read off the console** on 2026-08-30 (the
first session in which live output routing reached the app — see issue #31),
superseding the values inferred from the patch sheet:

| Out | Name | Fed from | Emerges at |
|---|---|---|---|
| 1 | Sidesal | Matrix 3 | console XLR 1 |
| 2 | Vip Rom | Matrix 4 | console XLR 2 |
| 6 | Bak Høyre (rear right) | Bus 5 | Stagebox H out 6 |
| 7 | Piano Høyre | Bus 3 | Stagebox H out 7 |
| 8 | Front Høyre | Bus 2 | Stagebox H out 8 |
| 11 | Venstre Bak (rear left) | Bus 4 | Stagebox V out 3 |
| 12 | Piano Venstre | Bus 3 | Stagebox V out 4 |
| 13 | Front Venstre | Bus 1 | Stagebox V out 5 |
| 14 | Sub | **M/C** | Stagebox V out 6 |
| 15 | Main Left | **Matrix 5** | Stagebox V out 7 |
| 16 | Main Right | **Matrix 6** | Stagebox V out 8 |

Outputs 3, 4, 5, 9, 10 read OFF, confirming the sheet's "unused".

**The mains reach the house through Matrix 5/6, not Main L/R directly.** The
patch sheet recorded the *intent* ("15 and 16 are Main L/R"), which is how the
room is described; the desk implements it through a matrix pair, the usual way
to get zone level/EQ/delay on the mains. Both statements are true at different
levels of description, and the console's is the one this table records.

Nothing here lives in `installation.yaml`, and nothing here needed changing in
the app — the schematic reads these values from the console at runtime and was
already reporting them correctly.

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