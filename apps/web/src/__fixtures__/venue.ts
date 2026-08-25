/**
 * Test fixture: the venue's topology as `config/installation.yaml` declares it
 * — two 16-in stageboxes daisy-chained on AES50-A (offsets 0 and 16) plus the
 * placeholder panel, `front-left` cabled 1:1 into stagebox-1 inputs 1–8.
 *
 * Output topology (issue #11) mirrors the real venue exactly, mapped onto
 * this fixture's generic device ids: `stagebox-1` presents `OUT9-16`
 * (Stagebox V's real block), `stagebox-2` presents `OUT1-8` (Stagebox H's).
 * Out 1 "Sidesal" is declared on the console XLR only — nothing is cabled to
 * `stagebox-2`'s own out 1, even though the block wholesale-presents it
 * there too, which is exactly the case `stagebox-out:stagebox-2:1` exists to
 * exercise (docs/installation.md "a block is presented wholesale").
 *
 * Built with the domain constructors rather than parsed from YAML: these tests
 * are about the store and the gateway, and the loader has its own suite.
 */

import type { Installation } from "@x32/domain";
import {
  consoleOutput,
  deviceId,
  destination,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "@x32/domain";

/** A fresh copy per call, so a test may mutate it freely. */
export function venueInstallation(): Installation {
  return {
    devices: [
      {
        id: deviceId("stagebox-1"),
        kind: "stagebox",
        label: "Stagebox 1",
        inputs: 16,
        aes50: { bus: "A", offset: 0 },
        outputs: 8,
        outputBlock: { start: 9 },
      },
      {
        id: deviceId("stagebox-2"),
        kind: "stagebox",
        label: "Stagebox 2",
        inputs: 16,
        aes50: { bus: "A", offset: 16 },
        outputs: 8,
        outputBlock: { start: 1 },
      },
      {
        id: deviceId("front-left"),
        kind: "passive-panel",
        label: "Front Left",
        inputs: 8,
      },
      { id: deviceId("sidesal"), kind: "destination", label: "Sidesal", inputs: 0 },
      { id: deviceId("vip-rom"), kind: "destination", label: "Vip Rom", inputs: 0 },
      { id: deviceId("bak-hoyre"), kind: "destination", label: "Bak Høyre", inputs: 0 },
      { id: deviceId("piano-hoyre"), kind: "destination", label: "Piano Høyre", inputs: 0 },
      { id: deviceId("front-hoyre"), kind: "destination", label: "Front Høyre", inputs: 0 },
      { id: deviceId("venstre-bak"), kind: "destination", label: "Venstre Bak", inputs: 0 },
      { id: deviceId("piano-venstre"), kind: "destination", label: "Piano Venstre", inputs: 0 },
      { id: deviceId("front-venstre"), kind: "destination", label: "Front Venstre", inputs: 0 },
      { id: deviceId("sub"), kind: "destination", label: "Sub", inputs: 0 },
      { id: deviceId("main-left"), kind: "destination", label: "Main Left", inputs: 0 },
      { id: deviceId("main-right"), kind: "destination", label: "Main Right", inputs: 0 },
    ],
    connections: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((socket) => ({
        from: panelInput("front-left", socket),
        to: stageboxInput("stagebox-1", socket),
      })),

      // Console XLR outs — declared, not derived. Only 1–2 are in use. The
      // mixer-output -> console-output identity edge is normally added by
      // the YAML loader (`packages/installation/src/parse.ts`, "Console XLR
      // outs are addressed by number alone"); this fixture bypasses the
      // loader, so it is added here explicitly, matching what a real
      // `Installation` carries.
      { from: mixerOutput(1), to: consoleOutput(1) },
      { from: mixerOutput(2), to: consoleOutput(2) },
      { from: consoleOutput(1), to: destination("sidesal") },
      { from: consoleOutput(2), to: destination("vip-rom") },

      // Stagebox 2 (OUT1-8) outs 6-8 — outs 1-5 carry the block wholesale
      // but nothing is cabled to them (stagebox-out:stagebox-2:1 included).
      { from: stageboxOutput("stagebox-2", 6), to: destination("bak-hoyre") },
      { from: stageboxOutput("stagebox-2", 7), to: destination("piano-hoyre") },
      { from: stageboxOutput("stagebox-2", 8), to: destination("front-hoyre") },

      // Stagebox 1 (OUT9-16) outs 3-8.
      { from: stageboxOutput("stagebox-1", 3), to: destination("venstre-bak") },
      { from: stageboxOutput("stagebox-1", 4), to: destination("piano-venstre") },
      { from: stageboxOutput("stagebox-1", 5), to: destination("front-venstre") },
      { from: stageboxOutput("stagebox-1", 6), to: destination("sub") },
      { from: stageboxOutput("stagebox-1", 7), to: destination("main-left") },
      { from: stageboxOutput("stagebox-1", 8), to: destination("main-right") },
    ],
  };
}
