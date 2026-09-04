# `installation.yaml` — describing your installation

This file is the schema and modelling reference. It describes how to tell the
app what is physically wired to what, so it can answer the two questions it
exists for: *which mixer channel(s) consume this socket?* and *where does this
channel come from?*

The app is hard-coded for a **Behringer X32** (32 input channels, 16 output
slots, 16 console XLR outs) — that is deliberate and not going away. What is
**not** assumed is your room: how many stageboxes you have, what your panels
are called, how they are cabled, or what your speakers are named. All of that
is declared here, and the schematic derives itself from it.

### Getting started

The live file lives in the **bridge's state directory** — the same directory
as `baseline.json`: `%ProgramData%\X32PhysicalRoutingVisualizer\installation.yaml` on
an MSI install, `apps/x32-bridge/data/installation.yaml` in dev (issue #26).
It is deliberately not inside the installed program folder, which an upgrade
replaces wholesale.

Two ways to get one:

- **Let first run seed it.** If the file is absent, the bridge copies the
  read-only copy the release ships into place, logs that it did, and carries
  on. It only ever *creates* the file — an existing one is never overwritten,
  by this or any later release, so your edits are safe across upgrades.
- **Put it there yourself.** Copy
  **[`config/installation.sample.yaml`](../config/installation.sample.yaml)**
  to that path and edit it into your own room. The sample is a small,
  deliberately unlike-anyone's installation — one stagebox on AES50-B, two
  panels (one with a dead socket), five destinations across two groups plus
  one ungrouped, and no console device — commented section by section, so
  every field below has a worked line to copy.

`X32_INSTALLATION_FILE` overrides the location outright if you want the file
somewhere else.

Nothing in the app, and nothing in the test suite, depends on what your
installation contains: describing your own room is a YAML-only edit. A venue's
own `installation.yaml` is not kept in this repository at all — only the
sample is.

A complete real example, with all its awkward real-world quirks, lives in
**[venue-betania.md](venue-betania.md)** — the maintainer's own installation.

## What belongs here, and what does not

`installation.yaml` records **physical facts the mixer cannot discover**:
cabling, which box is which, what a socket feeds. Three things deliberately do
**not** belong:

- **Live mixer state.** Channel names, channel sources and routing come from
  the console at runtime. Recording them here would create a second, silently
  stale source of truth.
- **Coordinates.** There is no `x`, `y` or `width`, ever. Connectivity and
  visual layout are separate concerns (CLAUDE.md invariant 6). The optional
  `group` field names *which part of the rig* a device belongs to — a name,
  not a position.
- **Anything derivable.** Stagebox→AES50 edges come from `aes50.offset`, and
  mixer-output→stagebox-output edges from `outputBlock.start`. Writing them by
  hand would let them contradict the thing they are derived from.

## `installation.yaml` schema (v1/v2)

Validated with Zod at load; invalid topology fails startup with a message
naming the offending device/connection. **No coordinates, ever** — visual
layout is a separate concern.

`version: 1` and `version: 2` are accepted and behave **identically**. Every
v2 addition below is optional, so a v1 file with no output content stays
valid; `2` is only a signal that the file uses output features — the sample
is `2` because it does. The parser branches on
`version` nowhere, and it is **not** bumped for each new optional field (see
"Why no version bump" under [`group`](#group--naming-a-part-of-the-installation-issue-20)).

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

  stage-left-panel:           # a passive wall plate, no AES50 of its own
    kind: passive-panel
    label: "Stage Left Panel"
    inputs: 8

connections:                  # panel socket → stagebox input (signal direction)
  - from: { device: stage-left-panel, input: 1 }
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

Stagebox sockets are dual-labelled `7 · A23` style — the box-local number and
the AES50 channel it becomes — because the AES50 number is what the X32's own
routing screens show when you are debugging against the desk.

### `sockets` — per-socket annotations (issue #12)

A device with sockets (`stagebox`, `passive-panel`, `console`) may declare an
optional `sockets` map, keyed by socket number, for the sockets that need
declared knowledge routing itself cannot know:

```yaml
stage-right-panel:
  kind: passive-panel
  label: "Stage Right Panel"
  inputs: 8
  sockets:
    1: { status: broken, note: "Faulty — do not use" }
```

- `status` is `broken` (physically faulty, do not use) or `unused`
  (deliberately spare, nothing patched here yet) — kept distinct because
  they lead a technician to different actions. `note` is free text.
- Only annotated sockets appear in the map; a socket absent from it is a
  normal socket, whether cabled or not.
- **Purely descriptive.** `buildRouteIndex` never branches on it — an
  annotated socket resolves exactly like an uncabled one (single-endpoint
  route, no consumers). The UI reads the annotation only to render a socket
  distinctly and to word its tooltip; the routing graph never sees it.
- **An annotated socket may not also be the `from` of a connection** — a
  domain rule (`validateInstallation`), not a shape one. Declaring a socket
  broken/unused and cabling it in the same file is contradictory input and
  fails to load, loudly, rather than rendering something incoherent. This is
  the rule that catches a socket declared dead and cabled in the same file.
- `input` must be within `1…inputs`; duplicate annotations for one socket
  are rejected. Both are domain rules; the schema only checks that `status`
  is one of the two known values and that the map's keys look like socket
  numbers.

### `group` — naming a part of the installation (issue #20)

Any device, of any kind, may carry an optional `group`: a free-text **name**
for the part of the installation it belongs to, the way a technician would say
it out loud.

```yaml
devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox Left"
    inputs: 16
    aes50: { bus: A, offset: 0 }
    group: "Stage left"

  main-left:
    kind: destination
    label: "Main Left"
    group: "Left"
```

- **A name, not a position.** `group` says *which part of the rig* a device
  belongs to; it says nothing about where the device is drawn, how big it is,
  or in what order groups appear. **No coordinates, ever** (CLAUDE.md
  invariant 6) still holds unchanged — the UI owns layout, and a renderer may
  arrange the groups however it likes, or ignore them entirely.
- **Optional everywhere**, including `destination`. A device with no `group`
  is ungrouped, which is an ordinary state, and a file with no groups at all
  is perfectly valid. The sample leaves one destination ungrouped on purpose,
  to show what that looks like.
- **Free text**, not an enum. Venues differ: "Balcony", "Foyer" or "Under the
  gallery" must be expressible without a schema change.
- The value is **trimmed**, and an empty or whitespace-only string
  (`group: ""`) is treated as *absent* rather than as a group named `""`, so
  a stray empty value can never produce a nameless group.
- **Shape only.** Any string is a valid group name; there is no semantic rule
  for `validateInstallation` to enforce, and no ordering meaning is attached
  to the field itself.

#### Why no version bump

`group` is optional and additive: a file without it stays valid and behaves
exactly as before, so `version` is **not** bumped for it. `version` accepts
`1` or `2` and the parser branches on neither — the number is a signal to a
human reader that a file uses output features, nothing more. Adding a version
per optional field would be a treadmill that signals nothing the code uses.

### Output additions (v2)

```yaml
devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox Left"
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
- **Console XLR outs stay addressed by number, not the console device.** The
  `console` device (issue #2) exists for the desk's own local *inputs* only
  — see "Real panel wiring" above. Console outputs remain addressed by bare
  number (`consoleOutput: <int>`): migrating them onto the device too would
  churn schema and UI that already work correctly, for no user-visible gain.
  The resulting asymmetry — inputs own a device, outputs are numbered — is
  accepted; both are truthful, and unifying them is a cosmetic refactor for
  whenever someone next touches that area.
- **Slot→physical-output is never written in YAML; it is always derived.**
  For a stagebox, from `outputBlock.start` (mirroring `aes50.offset` on the
  input side): mixer-output `start + n − 1` → the box's XLR out `n`, for its
  8 presented slots. For a console XLR, it is the console's identity default
  — Out *n* carries on console XLR *n*, the console's default — and
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

### Console input addition (issue #2)

```yaml
devices:
  console:
    kind: console
    label: "Console (FOH)"
    inputs: 32                  # declare them all; unused ones render as such

connections:
  # panel socket -> console local input (a wall panel patched into the desk)
  - from: { device: stage-left-panel, input: 4 }
    to:   { device: console, input: 7 }
```

- New device kind `console`: `label` and `inputs` like a passive panel, but
  **must not** carry `aes50` — the desk's own local inputs never reach an
  AES50 bus. At most one `console` device is a domain rule.
- A connection's `to` may reference a console device the same `{ device,
  input }` shape as a stagebox input; which domain endpoint it becomes
  (`local-input` vs `stagebox-input`) depends on the named device's declared
  `kind`, resolved by the loader, not the shape. A console input may have at
  most one feeding panel socket, mirroring the stagebox-input rule.
- `MixerSourceRef`'s `local` variant (console XLR 1–32) resolves to this
  device's `local:<device>:<n>` endpoint when the installation declares a
  console device with `n` in range; with none declared, or `n` out of range,
  the channel is unmapped exactly as before this issue — never a throw.
- **Id form `local:<device>:<n>`**, not `console:<n>`: it matches the
  `MixerSourceRef` kind it resolves from, the same convention `aes50:<bus>:<n>`
  follows for the `aes50` source kind.
- Console *outputs* are unaffected and stay addressed by bare number — see
  "Console XLR outs stay addressed by number" above.

## Editing it at the venue

**Two equal ways: in the app, or in a text editor.** Since the installation
editor (epic #25) the whole file can be built and maintained from the UI —
switch on *Edit installation*, and you can rename devices, group them,
annotate broken or spare sockets, cable and uncable, add and remove
destinations, and add or reconfigure stageboxes, panels and the console. An
installation with no devices at all is a valid starting point, so a new venue
can be built from nothing without opening a file.

This document remains the source of truth for both. The editor writes exactly
the schema described here — same fields, same rules — through surgical
operations that leave your comments, key order and quoting untouched, and it
validates the *whole resulting document* before writing anything. An edit that
would leave the installation invalid is refused with a sentence saying why,
and nothing is written.

Two values deserve particular care whichever way you edit, because they are
the ones that fail silently: **`aes50.offset`** and **`outputBlock.start`**.
Neither appears on any patch sheet, the console reports the same channels
whatever you declare, and a wrong value leaves a schematic that looks entirely
correct while pointing at the wrong socket. The editor shows the consequence
of each as you type it ("inputs 1–16 → AES50-A 17–32") and names any box whose
channels you would be claiming twice — but it will never infer either for you.
They are physical settings on the box, and only looking at the box can settle
them.

In production the bridge reads this file at startup and serves it to the web
app over `GET /api/installation`. A cabling correction is therefore a file
edit plus a service restart, not a new release — see the README's "Changing
the physical wiring" for the exact steps. Edits made *in the app* take effect
immediately and are broadcast to every connected browser; only hand-edits need
the restart.

The file to edit is the one in the state directory
(`%ProgramData%\X32PhysicalRoutingVisualizer\installation.yaml`), which needs no admin
rights and which no upgrade overwrites. The copy under `%ProgramFiles%` is a
seed, and editing it is pointless: the next upgrade deletes it.

There is **no fallback topology**. If the file is missing or invalid the app
shows a startup error naming the problem rather than rendering some other
installation — a confident wrong answer is this tool's worst failure mode.

There is deliberately no file watching: a service restart is a predictable
trigger, and reloading topology under a live service mid-event is a footgun.

## Worked example

[venue-betania.md](venue-betania.md) documents a complete real installation —
two cascaded stageboxes on one AES50 bus, passive panels, a broken socket, an
output-block assignment the console cannot report, and the console's own local
inputs — together with the reasoning behind each modelling choice.
