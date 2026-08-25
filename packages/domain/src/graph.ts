/**
 * The generic directed-graph engine route resolution is built on
 * (architecture.md §3 "Route resolution").
 *
 * Deliberately not hardcoded to the panel → stagebox → aes50 → mixer shape:
 * `routing.ts` (input routes) and the output route index both build a
 * `Graph` of their own edges and walk it with the same BFS, so there is one
 * traversal implementation, not two.
 */

import type { EndpointRef } from "./endpoints";
import { endpointId } from "./endpoints";
import type { EndpointId } from "./ids";

/** Directed graph over endpoints: nodes plus adjacency in both directions. */
export interface Graph {
  nodes: Map<EndpointId, EndpointRef>;
  outgoing: Map<EndpointId, EndpointRef[]>;
  incoming: Map<EndpointId, EndpointRef[]>;
}

export interface GraphNode {
  id: EndpointId;
  ref: EndpointRef;
  /** Hops from the anchor `traceFrom` was called with: negative upstream,
   *  0 anchor, positive downstream. */
  depth: number;
}

export function createGraph(): Graph {
  return { nodes: new Map(), outgoing: new Map(), incoming: new Map() };
}

function adjacencyOf(
  map: Map<EndpointId, EndpointRef[]>,
  id: EndpointId,
): EndpointRef[] {
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const created: EndpointRef[] = [];
  map.set(id, created);
  return created;
}

export function addNode(graph: Graph, ref: EndpointRef): EndpointId {
  const id = endpointId(ref);
  if (!graph.nodes.has(id)) graph.nodes.set(id, ref);
  return id;
}

export function addEdge(graph: Graph, from: EndpointRef, to: EndpointRef): void {
  const fromId = addNode(graph, from);
  const toId = addNode(graph, to);
  adjacencyOf(graph.outgoing, fromId).push(to);
  adjacencyOf(graph.incoming, toId).push(from);
}

/** Sorts every adjacency list so BFS visits neighbours in a fixed order. */
export function sortAdjacency(
  graph: Graph,
  compare: (a: EndpointRef, b: EndpointRef) => number,
): void {
  for (const neighbours of graph.outgoing.values()) {
    neighbours.sort(compare);
  }
  for (const neighbours of graph.incoming.values()) {
    neighbours.sort(compare);
  }
}

/** Breadth-first walk in one direction, recording hop distance per node. */
function walk(
  graph: Graph,
  anchorId: EndpointId,
  direction: "upstream" | "downstream",
  collected: Map<EndpointId, GraphNode>,
): void {
  const adjacency = direction === "upstream" ? graph.incoming : graph.outgoing;
  const step = direction === "upstream" ? -1 : 1;

  let frontier: EndpointId[] = [anchorId];
  let hops = 0;

  while (frontier.length > 0) {
    hops += 1;
    const next: EndpointId[] = [];
    for (const id of frontier) {
      for (const ref of adjacency.get(id) ?? []) {
        const neighbourId = endpointId(ref);
        if (collected.has(neighbourId)) continue;
        collected.set(neighbourId, {
          id: neighbourId,
          ref,
          depth: hops * step,
        });
        next.push(neighbourId);
      }
    }
    frontier = next;
  }
}

/**
 * Everything reachable from `anchor` in the requested directions: itself plus
 * its ancestors and/or descendants. Unordered — callers sort with whatever
 * total order fits their endpoint kinds.
 */
export function traceFrom(
  graph: Graph,
  anchor: EndpointRef,
  directions: ReadonlyArray<"upstream" | "downstream">,
): GraphNode[] {
  const anchorId = endpointId(anchor);
  const collected = new Map<EndpointId, GraphNode>([
    [anchorId, { id: anchorId, ref: anchor, depth: 0 }],
  ]);
  for (const direction of directions) walk(graph, anchorId, direction, collected);
  return [...collected.values()];
}
