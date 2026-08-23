/**
 * Static topology (architecture.md §3).
 *
 * The installation is the *static* lifecycle: it comes from
 * `config/installation.yaml` and never changes at runtime.
 */

import type { EndpointRef } from "./endpoints";
import { aes50Channel, stageboxInput } from "./endpoints";
import type { Aes50Bus, DeviceId } from "./ids";

export type DeviceKind = "passive-panel" | "stagebox";

export interface Device {
  id: DeviceId;
  kind: DeviceKind;
  label: string;
  inputs: number;
  /** Stageboxes only: where this box's inputs land on an AES50 bus. */
  aes50?: { bus: Aes50Bus; offset: number };
}

/** A directed edge of the static signal graph: `from` feeds `to`. */
export interface TopologyEdge {
  from: EndpointRef;
  to: EndpointRef;
}

export interface Installation {
  devices: Device[];
  /**
   * Explicitly cabled connections, in signal direction (panel socket →
   * stagebox input). Stagebox→AES50 edges are *not* listed here; they are
   * derived from `aes50.offset` by `deriveStaticEdges`.
   */
  connections: TopologyEdge[];
}

/**
 * The complete static edge set of an installation: the explicitly cabled
 * connections plus the stagebox→AES50 edges derived from each stagebox's
 * cascade offset (box input *n* → bus channel *offset + n*, both 1-based).
 *
 * The installation loader calls this rather than doing the arithmetic itself.
 * Assumes a validated installation — see `validateInstallation`.
 */
export function deriveStaticEdges(installation: Installation): TopologyEdge[] {
  const edges: TopologyEdge[] = [...installation.connections];

  for (const device of installation.devices) {
    if (device.kind !== "stagebox" || device.aes50 === undefined) continue;
    const { bus, offset } = device.aes50;
    for (let input = 1; input <= device.inputs; input += 1) {
      edges.push({
        from: stageboxInput(device.id, input),
        to: aes50Channel(bus, offset + input),
      });
    }
  }

  return edges;
}
