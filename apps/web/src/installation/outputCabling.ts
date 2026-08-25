/**
 * Per-installation memo of which physical output sockets are actually
 * declared cabled to a destination (issue #11), independent of
 * `OutputRouteIndex`.
 *
 * This exists because `OutputRouteIndex.byEndpoint` cannot answer "is *this*
 * specific socket cabled?" — a shared route's `endpoints`/`destinations` are
 * a flat set, not a linear path (architecture.md §3 "Output route
 * resolution"): a block presented wholesale puts every physical socket the
 * block touches on the same route object as whichever socket actually is
 * cabled, so `route.destinations` for `stagebox-out:stagebox-2:1` (Out 1's
 * block, uncabled) reads identically to `console-out:1` (Out 1's cabled XLR)
 * — both are on Out 1's one shared route. Trusting that field here would
 * tell a technician Stagebox H out 1 feeds Sidesal, which it does not
 * (docs/installation.md "a block is presented wholesale, but only some
 * sockets are patched").
 *
 * The fix reads `installation.connections` directly: a physical output
 * (`console-output`/`stagebox-output`) is "connected" if and only if it is
 * the `from` of a declared `→ destination` connection — a plain one-hop
 * fact, no route/BFS involved.
 *
 * `installation` is structural (CLAUDE.md invariant 1), so this is memoized
 * per installation object exactly like `aes50Labels.ts`.
 */

import type { DestinationRef, EndpointId, Installation } from "@x32/domain";
import { cloneEndpoint, endpointId } from "@x32/domain";

const cache = new WeakMap<Installation, Map<EndpointId, DestinationRef>>();

function computePhysicalOutputDestinations(
  installation: Installation,
): Map<EndpointId, DestinationRef> {
  const map = new Map<EndpointId, DestinationRef>();
  for (const connection of installation.connections) {
    if (connection.to.kind !== "destination") continue;
    if (
      connection.from.kind !== "console-output" &&
      connection.from.kind !== "stagebox-output"
    ) {
      continue;
    }
    map.set(
      endpointId(connection.from),
      cloneEndpoint(connection.to) as DestinationRef,
    );
  }
  return map;
}

/**
 * Every physical output socket the installation declares cabled to a
 * destination, keyed by its own `EndpointId` (`console-out:N` or
 * `stagebox-out:<device>:N`). A socket absent from this map carries signal
 * (if its block is sourced) but has nothing plugged into it — the wholesale-
 * block case.
 */
export function physicalOutputDestinationsFor(
  installation: Installation,
): Map<EndpointId, DestinationRef> {
  const cached = cache.get(installation);
  if (cached !== undefined) return cached;

  const computed = computePhysicalOutputDestinations(installation);
  cache.set(installation, computed);
  return computed;
}
