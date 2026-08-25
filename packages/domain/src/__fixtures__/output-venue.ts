/**
 * Test fixture: the real venue's output chain per docs/installation.md
 * §"Output topology" — Stagebox H presents OUT1-8, Stagebox V presents
 * OUT9-16, one console XLR (Out 1 "Sidesal") is also in use, and Out 13
 * "Front Venstre" is the fully-verified end-to-end chain
 * (Bus 1 → Out 13 → Stagebox V out 5 → destination). Not exported from the
 * package index.
 */

import {
  consoleOutput,
  destination,
  mixerOutput,
  stageboxOutput,
} from "../endpoints";
import { deviceId } from "../ids";
import type { Installation } from "../topology";

/** A fresh copy per call, so tests can mutate it into a broken installation. */
export function outputVenueInstallation(): Installation {
  return {
    devices: [
      {
        id: deviceId("stagebox-h"),
        kind: "stagebox",
        label: "Stagebox H",
        inputs: 8,
        aes50: { bus: "A", offset: 0 },
        outputs: 8,
        outputBlock: { start: 1 },
      },
      {
        id: deviceId("stagebox-v"),
        kind: "stagebox",
        label: "Stagebox V",
        inputs: 8,
        aes50: { bus: "A", offset: 8 },
        outputs: 8,
        outputBlock: { start: 9 },
      },
      {
        id: deviceId("front-venstre"),
        kind: "destination",
        label: "Front Venstre",
        inputs: 0,
      },
      {
        id: deviceId("sidesal"),
        kind: "destination",
        label: "Sidesal",
        inputs: 0,
      },
    ],
    connections: [
      // Out 13 "Front Venstre": Bus 1 → Out 13 → Stagebox V out 5 (derived
      // from outputBlock.start = 9) → this cabling.
      { from: stageboxOutput("stagebox-v", 5), to: destination("front-venstre") },
      // Out 1 "Sidesal": Matrix → Out 1 → console XLR 1 (declared, not
      // derived) → this cabling.
      { from: mixerOutput(1), to: consoleOutput(1) },
      { from: consoleOutput(1), to: destination("sidesal") },
    ],
  };
}
