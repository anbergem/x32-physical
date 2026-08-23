# Venue installation facts & `installation.yaml` schema

## Confirmed facts (from the owner, 2026-08-23)

- Two stageboxes, each **16 in / 8 out** (S16/SD16-class; exact model unknown
  and irrelevant to the input model — labeled generically for now).
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

## Still to be captured (placeholder until then)

The passive panel inventory and the permanent panel→stagebox cabling have not
been provided yet. `installation.yaml` starts with plausible placeholder
panels/wiring so mock-driven development can proceed; replacing them with the
real wiring is a YAML-only edit.

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
