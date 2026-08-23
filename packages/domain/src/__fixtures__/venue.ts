/**
 * Test fixture: the real venue's topology per docs/installation.md — two
 * 16-in stageboxes daisy-chained on AES50-A (offsets 0 and 16) plus a
 * placeholder passive panel. Not exported from the package index.
 */

import { panelInput, stageboxInput } from "../endpoints";
import { deviceId } from "../ids";
import type { Installation } from "../topology";

/** A fresh copy per call, so tests can mutate it into a broken installation. */
export function venueInstallation(): Installation {
  return {
    devices: [
      {
        id: deviceId("stagebox-1"),
        kind: "stagebox",
        label: "Stagebox 1",
        inputs: 16,
        aes50: { bus: "A", offset: 0 },
      },
      {
        id: deviceId("stagebox-2"),
        kind: "stagebox",
        label: "Stagebox 2",
        inputs: 16,
        aes50: { bus: "A", offset: 16 },
      },
      {
        id: deviceId("front-left"),
        kind: "passive-panel",
        label: "Front Left",
        inputs: 8,
      },
    ],
    connections: [
      { from: panelInput("front-left", 1), to: stageboxInput("stagebox-1", 1) },
      { from: panelInput("front-left", 2), to: stageboxInput("stagebox-1", 2) },
      { from: panelInput("front-left", 8), to: stageboxInput("stagebox-2", 7) },
    ],
  };
}
