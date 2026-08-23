/**
 * Test fixture: the venue's topology as `config/installation.yaml` declares it
 * — two 16-in stageboxes daisy-chained on AES50-A (offsets 0 and 16) plus the
 * placeholder panels, `front-left` cabled 1:1 into stagebox-1 inputs 1–8.
 *
 * Built with the domain constructors rather than parsed from YAML: these tests
 * are about the store and the gateway, and the loader has its own suite.
 */

import type { Installation } from "@x32/domain";
import { deviceId, panelInput, stageboxInput } from "@x32/domain";

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
    connections: [1, 2, 3, 4, 5, 6, 7, 8].map((socket) => ({
      from: panelInput("front-left", socket),
      to: stageboxInput("stagebox-1", socket),
    })),
  };
}
