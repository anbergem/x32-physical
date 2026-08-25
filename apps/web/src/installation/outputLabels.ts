/**
 * Per-installation memo of which console Out slot (1–16) a physical output
 * socket carries (issue #11) — the output-side mirror of `aes50Labels.ts`.
 *
 * This is a structural fact, independent of `OutputRouteIndex`: a stagebox
 * output socket carries its block's slot *regardless* of whether that slot's
 * source is `off` or whether anything is cabled to the socket
 * (docs/installation.md "a block is presented wholesale, but only some
 * sockets are patched") — exactly the fact a dual label (`5` / `Out 13`)
 * needs, and exactly the fact `OutputRouteIndex.byEndpoint` cannot supply on
 * its own for an `off`-sourced slot's physical outs (its route does no
 * downstream trace at all — architecture.md §3 "Output route resolution").
 *
 * Reuses `deriveOutputEdges` (`@x32/domain`) rather than re-deriving the
 * `outputBlock.start` arithmetic here: a mixer-output → physical-output edge
 * (derived for a stagebox block, declared for a console XLR) is exactly
 * "this socket carries that slot", read in reverse.
 */

import type { EndpointId, Installation } from "@x32/domain";
import { deriveOutputEdges, endpointId } from "@x32/domain";

const cache = new WeakMap<Installation, Map<EndpointId, number>>();

function computeOutputSlots(installation: Installation): Map<EndpointId, number> {
  const map = new Map<EndpointId, number>();
  for (const edge of deriveOutputEdges(installation)) {
    if (edge.from.kind !== "mixer-output") continue;
    map.set(endpointId(edge.to), edge.from.output);
  }
  return map;
}

/**
 * Every physical output socket (`console-out:N` or `stagebox-out:<device>:N`)
 * mapped to the console Out slot (1–16) it carries. A socket absent from
 * this map declares no `outputBlock`/console mapping at all — never happens
 * for a socket the layout actually renders, since every rendered socket
 * comes from a device that declares one.
 */
export function outputSlotsFor(installation: Installation): Map<EndpointId, number> {
  const cached = cache.get(installation);
  if (cached !== undefined) return cached;

  const computed = computeOutputSlots(installation);
  cache.set(installation, computed);
  return computed;
}
