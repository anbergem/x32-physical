/**
 * Static topology (architecture.md §3).
 *
 * The installation is the *static* lifecycle: it comes from
 * `config/installation.yaml` and never changes at runtime.
 */

import type { Aes50ChannelRef, EndpointRef } from "./endpoints";
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
 * The AES50 channel a stagebox input lands on: box input *n* → bus channel
 * *offset + n*, both 1-based. This cascade arithmetic is a domain fact and
 * lives only here — `deriveStaticEdges` uses it to build the graph, and the UI
 * uses it to dual-label a socket with the number the console displays.
 *
 * `undefined` when the device declares no AES50 mapping (a passive panel):
 * having none is normal, not an error.
 *
 * @throws Error if the resulting channel falls outside 1–48, which means the
 *         installation was never validated — see `validateInstallation`.
 */
export function aes50ChannelForInput(
  device: Device,
  input: number,
): Aes50ChannelRef | undefined {
  if (device.aes50 === undefined) return undefined;
  const { bus, offset } = device.aes50;
  return aes50Channel(bus, offset + input);
}

/**
 * The complete static edge set of an installation: the explicitly cabled
 * connections plus the stagebox→AES50 edges derived from each stagebox's
 * cascade offset.
 *
 * Route resolution calls this rather than doing the arithmetic itself; the
 * loader leaves `Installation` a record of the declared facts only.
 * Assumes a validated installation — see `validateInstallation`.
 */
export function deriveStaticEdges(installation: Installation): TopologyEdge[] {
  const edges: TopologyEdge[] = [...installation.connections];

  for (const device of installation.devices) {
    if (device.kind !== "stagebox") continue;
    for (let input = 1; input <= device.inputs; input += 1) {
      const busChannel = aes50ChannelForInput(device, input);
      if (busChannel === undefined) continue;
      edges.push({ from: stageboxInput(device.id, input), to: busChannel });
    }
  }

  return edges;
}
