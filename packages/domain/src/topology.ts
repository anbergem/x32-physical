/**
 * Static topology (architecture.md §3).
 *
 * The installation is the *static* lifecycle: it comes from
 * `config/installation.yaml` and never changes at runtime.
 */

import type { Aes50ChannelRef, EndpointRef } from "./endpoints";
import { aes50Channel, endpointId, panelInput, stageboxInput } from "./endpoints";
import type { Aes50Bus, DeviceId, EndpointId } from "./ids";

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

/**
 * Every panel and stagebox input endpoint mapped to the AES50 channel it
 * ultimately reaches, following the static edges downstream (panel → stagebox
 * → aes50, or stagebox → aes50 directly for a direct stage socket). One pass
 * over `deriveStaticEdges`.
 *
 * A socket that reaches no AES50 channel (an uncabled panel socket) is simply
 * absent from the map — having none is normal, not an error.
 *
 * This is the single source both the panel and stagebox UI dual-labels read
 * from, so a socket's printed AES50 number can never disagree with the graph
 * `deriveStaticEdges` builds routes from — docs/installation.md "Real panel
 * wiring" is exactly the case this guards: the venue's right side is cabled
 * offset by one, so a label derived from the socket's own index instead of
 * the cabling would be wrong precisely where the venue is asymmetric.
 */
export function aes50ChannelsByEndpoint(
  installation: Installation,
): Map<EndpointId, Aes50ChannelRef> {
  const nextHop = new Map<EndpointId, EndpointRef>();
  const edges = deriveStaticEdges(installation);
  for (const edge of edges) {
    nextHop.set(endpointId(edge.from), edge.to);
  }

  /** Walks downstream edges until an AES50 channel or a dead end. */
  function resolve(start: EndpointRef): Aes50ChannelRef | undefined {
    let current = start;
    // Bounded by the edge count so a malformed (cyclic) graph cannot loop
    // forever; the real graph is at most two hops deep (panel -> stagebox ->
    // aes50), but this walks generically rather than hardcoding that depth.
    for (let hops = 0; hops <= edges.length; hops += 1) {
      if (current.kind === "aes50-channel") return current;
      const next = nextHop.get(endpointId(current));
      if (next === undefined) return undefined;
      current = next;
    }
    return undefined;
  }

  const result = new Map<EndpointId, Aes50ChannelRef>();
  for (const device of installation.devices) {
    if (!Number.isInteger(device.inputs) || device.inputs < 1) continue;
    for (let input = 1; input <= device.inputs; input += 1) {
      const ref: EndpointRef =
        device.kind === "passive-panel"
          ? panelInput(device.id, input)
          : stageboxInput(device.id, input);
      const channel = resolve(ref);
      if (channel !== undefined) result.set(endpointId(ref), channel);
    }
  }

  return result;
}
