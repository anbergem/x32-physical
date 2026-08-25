/**
 * Output route resolution (architecture.md §3 "Output route resolution").
 *
 * A separate index from `RouteIndex`, not a widened one — input and output
 * endpoint kinds are disjoint (`endpoints.ts`), and `SignalRoute`'s
 * `mixerChannels`/`physicalInputs` fields do not describe an output route. A
 * UI hover consults both indexes; an endpoint id never appears in both.
 *
 * Structurally this mirrors `buildRouteIndex`, but the direction of the
 * "shared source" relationship is reversed: on the input side, several mixer
 * channels can share one AES50 *endpoint* as their source, so a dynamic edge
 * from that endpoint to each channel lets one `trace()` reach every consumer.
 * On the output side there is no such node — `MixerOutputSourceRef` (bus,
 * matrix, main, …) never appears as an `EndpointRef`, since it is not a
 * physical socket. So "Bus 3 feeds Out 7 and Out 12" is detected by
 * structural equality of the two slots' `source`, and their independent
 * downstream traces are unioned into one route rather than sharing a single
 * graph anchor.
 *
 * Reuses the same generic BFS (`graph.ts`) `buildRouteIndex` is built on,
 * rather than a second traversal implementation.
 */

import type { EndpointRef } from "./endpoints";
import { cloneEndpoint, compareEndpoints, endpointId, mixerOutput } from "./endpoints";
import type { Graph, GraphNode } from "./graph";
import { addEdge, addNode, createGraph, sortAdjacency, traceFrom } from "./graph";
import type { EndpointId } from "./ids";
import { MIXER_OUTPUT_COUNT } from "./ids";
import type { MixerOutputSourceRef, MixerOutputState } from "./output-mixer";
import type { Installation } from "./topology";
import { deriveOutputEdges } from "./topology";

export interface OutputRoute {
  /**
   * Every endpoint the signal touches, ordered upstream → downstream (slot →
   * physical out → destination). Several slots sharing one source appear
   * together at the head, ascending.
   */
  endpoints: EndpointId[];
  /** Every console Out slot (1–16) sharing this source, ascending. */
  mixerOutputs: number[];
  /** The named destination(s) this route reaches. Empty when none is cabled. */
  destinations: EndpointRef[];
  /**
   * Present when the slot's source is `off`: no destinations were traced —
   * the route is just the slot itself — because there is no signal to show
   * downstream of, even though the physical XLRs the block presents still
   * exist as topology (docs/installation.md "a block is presented wholesale").
   */
  unroutedSource?: MixerOutputSourceRef;
}

export interface OutputRouteIndex {
  byMixerOutput: Map<number, OutputRoute>;
  /** Every endpoint on a route maps to the route(s) passing through it. */
  byEndpoint: Map<EndpointId, OutputRoute[]>;
}

function isValidOutputNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MIXER_OUTPUT_COUNT;
}

/** Stable string key so states with structurally equal sources group together. */
function sourceKey(source: MixerOutputSourceRef): string {
  const record = source as unknown as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .map((key) => `${key}=${String(record[key])}`)
    .join("&");
}

function register(index: OutputRouteIndex, route: OutputRoute): void {
  for (const output of route.mixerOutputs) {
    index.byMixerOutput.set(output, route);
  }
  for (const id of route.endpoints) {
    const routes = index.byEndpoint.get(id);
    if (routes === undefined) index.byEndpoint.set(id, [route]);
    else routes.push(route);
  }
}

/** Downstream-only union of every slot's trace, deduped and sorted. */
function collectDownstream(graph: Graph, outputs: number[]): GraphNode[] {
  const collected = new Map<EndpointId, GraphNode>();
  for (const output of outputs) {
    for (const node of traceFrom(graph, mixerOutput(output), ["downstream"])) {
      if (!collected.has(node.id)) collected.set(node.id, node);
    }
  }
  return [...collected.values()].sort((a, b) => compareEndpoints(a.ref, b.ref));
}

function destinationsOf(nodes: GraphNode[]): EndpointRef[] {
  return nodes
    .filter((node) => node.ref.kind === "destination")
    .map((node) => cloneEndpoint(node.ref));
}

/**
 * Resolves every console Out slot to the physical outs and destinations it
 * reaches, and every endpoint on the way to the route(s) passing through it.
 *
 * Mirrors the input side's semantics: outputs sharing one source form a
 * single shared route (`mixerOutputs` ascending); a slot sourced `off` yields
 * a route of just that slot with no destinations; a physical out that
 * reaches no declared destination still appears in `byEndpoint`
 * (`destinations: []`) — signal present, nothing plugged in, exactly like an
 * unconnected stagebox input. Never throws.
 *
 * @throws Error if `installation` is not a valid topology — validate it at
 *         load (`assertValidInstallation`), not here.
 */
export function buildOutputRouteIndex(
  installation: Installation,
  outputs: MixerOutputState[],
): OutputRouteIndex {
  const graph = createGraph();
  for (let output = 1; output <= MIXER_OUTPUT_COUNT; output += 1) {
    addNode(graph, mixerOutput(output));
  }
  for (const edge of deriveOutputEdges(installation)) {
    addEdge(graph, edge.from, edge.to);
  }
  sortAdjacency(graph, compareEndpoints);

  // Last state wins for a repeated output number; ascending order keeps the
  // rest of the build deterministic regardless of the caller's array order.
  const states = new Map<number, MixerOutputState>();
  for (const state of outputs) {
    if (!isValidOutputNumber(state.output)) continue;
    states.set(state.output, state);
  }
  const ordered = [...states.values()].sort((a, b) => a.output - b.output);

  const index: OutputRouteIndex = {
    byMixerOutput: new Map(),
    byEndpoint: new Map(),
  };

  // Group real (non-"off") sources by structural equality; "off" never
  // groups, even with another "off" slot — each is its own route.
  const groups = new Map<
    string,
    { source: MixerOutputSourceRef; outputs: number[] }
  >();

  for (const state of ordered) {
    if (state.source.kind === "off") {
      const id = endpointId(mixerOutput(state.output));
      register(index, {
        endpoints: [id],
        mixerOutputs: [state.output],
        destinations: [],
        unroutedSource: state.source,
      });
      continue;
    }
    const key = sourceKey(state.source);
    const group = groups.get(key) ?? { source: state.source, outputs: [] };
    group.outputs.push(state.output);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const nodes = collectDownstream(graph, group.outputs);
    register(index, {
      endpoints: nodes.map((node) => node.id),
      mixerOutputs: [...group.outputs].sort((a, b) => a - b),
      destinations: destinationsOf(nodes),
    });
  }

  // Slots the caller did not describe still resolve (their static physical
  // presentation, if any), so all 16 strips can be looked up. Nothing is
  // known about their source, so no `unroutedSource`.
  for (let output = 1; output <= MIXER_OUTPUT_COUNT; output += 1) {
    if (index.byMixerOutput.has(output)) continue;
    const nodes = collectDownstream(graph, [output]);
    register(index, {
      endpoints: nodes.map((node) => node.id),
      mixerOutputs: [output],
      destinations: destinationsOf(nodes),
    });
  }

  // Static chains no active (non-"off", non-undescribed) route claimed yet:
  // a physical out or destination downstream of an "off" slot still exists
  // as topology (the block is presented wholesale) and must resolve when
  // hovered directly, anchored at its own most-upstream unclaimed node.
  const staticNodes = [...graph.nodes.values()]
    .filter((ref) => ref.kind !== "mixer-output")
    .sort(compareEndpoints);
  for (const ref of staticNodes) {
    const id = endpointId(ref);
    if (index.byEndpoint.has(id)) continue;
    const nodes = traceFrom(graph, ref, ["downstream"]).sort((a, b) =>
      compareEndpoints(a.ref, b.ref),
    );
    register(index, {
      endpoints: nodes.map((node) => node.id),
      mixerOutputs: [],
      destinations: destinationsOf(nodes),
    });
  }

  return index;
}
