/**
 * Route resolution (architecture.md §3 "Route resolution").
 *
 * `buildRouteIndex` answers the product's two questions in both directions:
 * *which channel(s) consume this socket?* and *which socket does this channel
 * come from?* It is a **full rebuild** on every call — the graph is tiny
 * (< 200 nodes), so any topology or routing change just rebuilds it. There is
 * no incremental engine (architecture.md §3).
 *
 * Two design points worth keeping:
 *
 * - Traversal is generic over directed edges, not hardcoded to the
 *   panel → stagebox → aes50 → mixer shape, so output routing can reuse it.
 * - Given a **validated** installation it never throws, whatever the channel
 *   data says. Sources with no physical mapping (card, off, an AES50 channel no
 *   stagebox occupies) yield a route with `physicalInputs: []` and
 *   `unmappedSource` set; malformed channel values are skipped rather than
 *   fatal, because a stray value from an adapter must not blank the whole
 *   schematic. The installation itself is the caller's responsibility: an
 *   invalid one (say an AES50 range running past channel 48) throws while its
 *   edges are derived, before any route is built. Load installations through
 *   the installation loader, or `assertValidInstallation`.
 */

import type { Aes50ChannelRef, EndpointRef } from "./endpoints";
import {
  aes50Channel,
  cloneEndpoint,
  compareEndpoints,
  endpointId,
  mixerChannel,
  panelInput,
} from "./endpoints";
import type { Graph, GraphNode } from "./graph";
import { addEdge, addNode, createGraph, sortAdjacency, traceFrom } from "./graph";
import type { Aes50Bus, EndpointId, MixerChannelId } from "./ids";
import {
  AES50_CHANNEL_COUNT,
  MIXER_CHANNEL_COUNT,
  mixerChannelId,
} from "./ids";
import type { MixerChannelState, MixerSourceRef } from "./mixer";
import type { Installation } from "./topology";
import { deriveStaticEdges } from "./topology";

export interface SignalRoute {
  /**
   * Every endpoint the signal touches, ordered upstream → downstream
   * (panel → stagebox → aes50 → mixer channels), including *all* consuming
   * mixer channels.
   */
  endpoints: EndpointId[];
  /** All consumers of this signal, ascending. Empty for an unconsumed chain. */
  mixerChannels: MixerChannelId[];
  /**
   * The most-upstream physical endpoint(s): the panel socket when the stagebox
   * input is cabled from one, otherwise the stagebox input itself (an uncabled
   * stagebox input is a direct stage socket — docs/installation.md). Empty when
   * the source has no physical mapping.
   */
  physicalInputs: EndpointRef[];
  /**
   * Present when the mixer channel's source has no physical mapping
   * (local/card/usb/… or an AES50 channel no stagebox occupies).
   */
  unmappedSource?: MixerSourceRef;
}

export interface RouteIndex {
  byMixerChannel: Map<MixerChannelId, SignalRoute>;
  /** Every endpoint on a route maps to the route(s) passing through it. */
  byEndpoint: Map<EndpointId, SignalRoute[]>;
}

function isPhysical(ref: EndpointRef): boolean {
  return ref.kind === "panel-input" || ref.kind === "stagebox-input";
}

/**
 * The static graph: every derived topology edge (the domain owns the
 * `deriveStaticEdges` call — architecture.md §3), plus a node for every
 * declared panel socket so that an uncabled one still resolves to something.
 */
function buildStaticGraph(installation: Installation): Graph {
  const graph: Graph = createGraph();

  for (const device of installation.devices) {
    if (device.kind !== "passive-panel") continue;
    // A bound on this loop, not a validation substitute: an unvalidated
    // installation has already thrown by the time its stagebox edges are
    // derived below. `validateInstallation` is what rejects a bad input count.
    if (!Number.isInteger(device.inputs) || device.inputs < 1) continue;
    for (let input = 1; input <= device.inputs; input += 1) {
      addNode(graph, panelInput(device.id, input));
    }
  }

  for (const edge of deriveStaticEdges(installation)) {
    addEdge(graph, edge.from, edge.to);
  }

  return graph;
}

/**
 * Everything the signal through `anchor` touches: its ancestors, itself and its
 * descendants, ordered upstream → downstream. Endpoints at the same distance
 * are ordered by `compareEndpoints`, so two channels consuming one source
 * always appear in ascending channel order.
 */
function trace(graph: Graph, anchor: EndpointRef): GraphNode[] {
  return traceFrom(graph, anchor, ["upstream", "downstream"]).sort(
    (a, b) => a.depth - b.depth || compareEndpoints(a.ref, b.ref),
  );
}

function makeRoute(
  graph: Graph,
  nodes: GraphNode[],
  mixerChannels: MixerChannelId[],
): SignalRoute {
  // A physical endpoint nothing feeds is where the signal enters the
  // installation: a panel socket, or a stagebox input used as a direct stage
  // socket. Nodes are already upstream-first, so the order carries over.
  const physicalInputs = nodes
    .filter(
      (node) =>
        isPhysical(node.ref) &&
        (graph.incoming.get(node.id) ?? []).length === 0,
    )
    .map((node) => cloneEndpoint(node.ref));

  return {
    endpoints: nodes.map((node) => node.id),
    mixerChannels: [...mixerChannels].sort((a, b) => a - b),
    physicalInputs,
  };
}

function register(index: RouteIndex, route: SignalRoute): void {
  for (const channel of route.mixerChannels) {
    index.byMixerChannel.set(channel, route);
  }
  for (const id of route.endpoints) {
    const routes = index.byEndpoint.get(id);
    if (routes === undefined) index.byEndpoint.set(id, [route]);
    else routes.push(route);
  }
}

function isValidChannelId(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 1 && value <= MIXER_CHANNEL_COUNT
  );
}

/**
 * The AES50 endpoint a source maps to, or `undefined` when the source is not an
 * AES50 one (card, off, …) or names a channel outside the bus range — both are
 * handled as "no physical mapping" rather than as an error.
 */
function aes50EndpointOf(source: MixerSourceRef): Aes50ChannelRef | undefined {
  if (source.kind !== "aes50") return undefined;
  if (source.bus !== "A" && source.bus !== "B") return undefined;
  if (
    !Number.isInteger(source.channel) ||
    source.channel < 1 ||
    source.channel > AES50_CHANNEL_COUNT
  ) {
    return undefined;
  }
  return aes50Channel(source.bus, source.channel);
}

interface Aes50Group {
  ref: Aes50ChannelRef;
  bus: Aes50Bus;
  channel: number;
  consumers: MixerChannelId[];
}

/**
 * Resolves every mixer channel to the physical inputs feeding it, and every
 * endpoint to the route(s) passing through it.
 *
 * Beyond the consuming routes, chains that no channel consumes are indexed too
 * (`mixerChannels: []`, no `unmappedSource`): this is a debugging tool, so
 * hovering a stage socket must always show where its signal goes, patched or
 * not. All 32 mixer channels are always present in `byMixerChannel`.
 *
 * @throws Error if `installation` is not a valid topology — validate it at load
 *         (`assertValidInstallation`), not here.
 */
export function buildRouteIndex(
  installation: Installation,
  channels: MixerChannelState[],
): RouteIndex {
  const graph = buildStaticGraph(installation);

  // Last state wins for a repeated channel, so a channel resolves to exactly
  // one route; ascending order keeps the rest of the build deterministic.
  const states = new Map<MixerChannelId, MixerChannelState>();
  for (const state of channels) {
    if (!isValidChannelId(state.channel)) continue;
    states.set(state.channel, state);
  }
  const ordered = [...states.values()].sort((a, b) => a.channel - b.channel);

  // Dynamic edges: aes50 → mixer channel, one group per distinct AES50 source.
  //
  // Only AES50 consumers are grouped into a shared route; two channels off the
  // same card input stay two routes. Sharing exists so that hovering an
  // endpoint on a path co-highlights every channel reachable from it — and a
  // non-AES50 source has no such endpoint to hover. Whether two channels
  // happen to share a mixer-internal source is a question about the mixer, not
  // about this venue's physical wiring, and is out of this tool's scope.
  const groups = new Map<EndpointId, Aes50Group>();
  const unmapped: MixerChannelState[] = [];

  for (const state of ordered) {
    const ref = aes50EndpointOf(state.source);
    if (ref === undefined) {
      unmapped.push(state);
      continue;
    }
    const id = endpointId(ref);
    const group = groups.get(id) ?? {
      ref,
      bus: ref.bus,
      channel: ref.channel,
      consumers: [],
    };
    group.consumers.push(state.channel);
    groups.set(id, group);
    addEdge(graph, ref, mixerChannel(state.channel));
  }

  sortAdjacency(graph, compareEndpoints);

  const index: RouteIndex = {
    byMixerChannel: new Map(),
    byEndpoint: new Map(),
  };

  // 1. Consumed AES50 sources: one shared route per distinct bus channel.
  const sortedGroups = [...groups.values()].sort((a, b) =>
    compareEndpoints(a.ref, b.ref),
  );
  for (const group of sortedGroups) {
    const route = makeRoute(graph, trace(graph, group.ref), group.consumers);
    // No stagebox occupies this bus channel: the mixer pulls from a source
    // that reaches no physical socket.
    if (route.physicalInputs.length === 0) {
      route.unmappedSource = {
        kind: "aes50",
        bus: group.bus,
        channel: group.channel,
      };
    }
    register(index, route);
  }

  // 2. Sources with no physical mapping at all — the channel alone.
  for (const state of unmapped) {
    const route = makeRoute(
      graph,
      trace(graph, mixerChannel(state.channel)),
      [state.channel],
    );
    route.unmappedSource = state.source;
    register(index, route);
  }

  // 3. Static chains no channel consumes, anchored at their most-upstream
  //    endpoint (nodes are visited upstream-first, so a chain is only ever
  //    anchored at its head).
  const staticNodes = [...graph.nodes.values()]
    .filter((ref) => ref.kind !== "mixer-channel")
    .sort(compareEndpoints);
  for (const ref of staticNodes) {
    if (index.byEndpoint.has(endpointId(ref))) continue;
    register(index, makeRoute(graph, trace(graph, ref), []));
  }

  // 4. Channels the caller did not describe still resolve, so all 32 strips
  //    can look themselves up. Nothing is known about them, so they carry no
  //    `unmappedSource` — that would claim a source they were never given.
  for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
    const id = mixerChannelId(channel);
    if (index.byMixerChannel.has(id)) continue;
    register(index, makeRoute(graph, trace(graph, mixerChannel(channel)), [id]));
  }

  return index;
}
