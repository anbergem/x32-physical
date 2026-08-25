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

## `installation.yaml` schema (v1)

Validated with Zod at load; invalid topology fails startup with a message
naming the offending device/connection. **No coordinates, ever** — visual
layout is a separate concern.

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
