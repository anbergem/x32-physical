/**
 * The shared example installation: an entirely invented rig, used wherever a
 * test needs a *realistic* topology rather than a two-device stub (issue #24).
 *
 * Nothing here describes any real room — no test may assert a fact about
 * `config/installation.yaml`, so that whoever clones this repo can put their
 * own installation in that file (or delete it) without turning the suite red.
 *
 * It is built out of the domain constructors rather than parsed from YAML on
 * purpose: no test that uses it may depend on anything being on disk.
 *
 * It deliberately exercises every shape the tests need:
 *
 * - a **cascade**: two 16-in stageboxes on AES50-A, `snake-a` at offset 0 and
 *   `snake-b` at offset 16, so `snake-b` input 7 is AES50-A 23;
 * - a panel cabled **1:1** (`dsl-plate` sockets 1–8 → `snake-a` inputs 1–8);
 * - a panel cabled with an **offset** (`usr-box` sockets 2–6 → `snake-b`
 *   inputs 1–5, so socket 3 resolves to AES50-A 18) — the renumbering case;
 * - a **broken socket** (`usr-box` socket 1), annotated and cabled to nothing;
 * - a **console** device with its own local XLR inputs;
 * - destinations in **named groups** (House, Balcony) interleaved in
 *   declaration order, plus one **ungrouped** destination;
 * - **output blocks**: `snake-a` presents OUT9–16 and `snake-b` OUT1–8, with
 *   one console XLR out declared cabled while the block `snake-b` presents
 *   wholesale is not.
 *
 * Extend this fixture if a test needs a shape it cannot express. Never soften
 * an assertion to fit it.
 */

import {
  consoleOutput,
  destination,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "../endpoints";
import { deviceId } from "../ids";
import type { Installation } from "../topology";

/** A fresh copy per call, so a test may mutate it freely. */
export function exampleInstallation(): Installation {
  return {
    devices: [
      {
        id: deviceId("snake-a"),
        kind: "stagebox",
        label: "Snake A",
        inputs: 16,
        aes50: { bus: "A", offset: 0 },
        outputs: 8,
        outputBlock: { start: 9 },
        group: "Downstage",
      },
      {
        id: deviceId("dsl-plate"),
        kind: "passive-panel",
        label: "DSL Wall Plate",
        inputs: 8,
        group: "Downstage",
      },
      {
        id: deviceId("snake-b"),
        kind: "stagebox",
        label: "Snake B",
        inputs: 16,
        aes50: { bus: "A", offset: 16 },
        outputs: 8,
        outputBlock: { start: 1 },
        group: "Upstage",
      },
      {
        id: deviceId("usr-box"),
        kind: "passive-panel",
        label: "USR Floor Box",
        inputs: 6,
        group: "Upstage",
        // Position 1 is dead and cabled to nothing; the remaining sockets are
        // cabled one lower into the box, which is what makes this panel's
        // renumbering worth testing.
        sockets: [{ input: 1, status: "broken", note: "Damaged - not in use" }],
      },
      {
        id: deviceId("console"),
        kind: "console",
        label: "Front of House Desk",
        inputs: 32,
        // Deliberately ungrouped: the desk belongs to no stage area.
      },
      {
        id: deviceId("house-left"),
        kind: "destination",
        label: "House Left",
        inputs: 0,
        group: "House",
      },
      {
        id: deviceId("house-right"),
        kind: "destination",
        label: "House Right",
        inputs: 0,
        group: "House",
      },
      {
        id: deviceId("balcony-fill"),
        kind: "destination",
        label: "Balcony Fill",
        inputs: 0,
        group: "Balcony",
      },
      {
        // Declared after a Balcony device, so "House" is not contiguous: group
        // order is first appearance, membership is the name.
        id: deviceId("foyer-feed"),
        kind: "destination",
        label: "Foyer Feed",
        inputs: 0,
        group: "House",
      },
      {
        // Deliberately ungrouped: ungrouped devices collect on their own.
        id: deviceId("green-room"),
        kind: "destination",
        label: "Green Room",
        inputs: 0,
      },
    ],
    connections: [
      // The 1:1 panel.
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((socket) => ({
        from: panelInput("dsl-plate", socket),
        to: stageboxInput("snake-a", socket),
      })),

      // The offset panel: socket n feeds box input n - 1 (socket 1 is broken
      // and uncabled), so socket 3 -> snake-b 2 -> AES50-A 18.
      ...[2, 3, 4, 5, 6].map((socket) => ({
        from: panelInput("usr-box", socket),
        to: stageboxInput("snake-b", socket - 1),
      })),

      // Console XLR outs are declared, not derived. The mixer-output ->
      // console-output identity edge is normally added by the YAML loader
      // (`packages/installation/src/parse.ts`); this fixture bypasses the
      // loader, so it is written out here, matching what a loaded
      // `Installation` carries.
      { from: mixerOutput(1), to: consoleOutput(1) },
      { from: mixerOutput(2), to: consoleOutput(2) },
      { from: consoleOutput(1), to: destination("green-room") },
      { from: consoleOutput(2), to: destination("foyer-feed") },

      // Snake A presents OUT9-16: out 5 is Out 13, out 6 is Out 14.
      { from: stageboxOutput("snake-a", 5), to: destination("house-left") },
      { from: stageboxOutput("snake-a", 6), to: destination("house-right") },

      // Snake B presents OUT1-8. Only out 4 is cabled; the rest of the block
      // is still presented wholesale on its XLRs, out 1 included.
      { from: stageboxOutput("snake-b", 4), to: destination("balcony-fill") },
    ],
  };
}
