/**
 * Selectors: the one place that knows how to read state out of the store.
 *
 * Components identify themselves by domain id and select only what they need
 * (architecture.md §5), so a rename of CH7 never rerenders CH12. Two rules keep
 * that true:
 *
 * 1. Return a value whose identity is stable when nothing relevant changed —
 *    a primitive, or an object the store itself preserved. Never build a new
 *    object or array inside a selector.
 * 2. Components never walk the topology or the route index themselves. Route
 *    lookups (`routeIndex.byEndpoint`, `byMixerChannel`) belong here — that is
 *    what `selectHoverStatus` below is, and where step 8's selection status
 *    joins it.
 */

import type {
  Device,
  DeviceId,
  EndpointId,
  Installation,
  MixerChannelId,
  MixerChannelState,
  RouteIndex,
} from "@x32/domain";
import type { MixerConnectionState } from "@x32/mixer-contracts";

import type { AppState, AppStoreState } from "./store";

// --- runtime slice ---------------------------------------------------------

export function selectConnection(state: AppState): MixerConnectionState {
  return state.connection;
}

export function selectSelectedChannel(
  state: AppState,
): MixerChannelId | null {
  return state.selectedChannel;
}

export function selectHoveredEndpoint(state: AppState): EndpointId | null {
  return state.hoveredEndpoint;
}

/** Stable action identity: subscribing to it never causes a rerender. */
export function selectSetHoveredEndpoint(
  state: AppStoreState,
): (endpoint: EndpointId | null) => void {
  return state.setHoveredEndpoint;
}

// --- highlighting ----------------------------------------------------------

/**
 * How an endpoint relates to what the pointer is on:
 *
 * - `hovered` — the pointer is on this very socket or strip.
 * - `on-route` — it is somewhere on the route(s) the hovered endpoint belongs
 *   to, upstream or downstream. One route object is shared by every endpoint on
 *   it, so hovering either end lights exactly the same set — including all
 *   consumers when one socket feeds several channels.
 * - `none` — unrelated, or nothing is hovered.
 *
 * Plan step 8 adds selection as a *separate* status with its own selector, so a
 * socket can be on the selected route and the hovered route at once and show
 * both.
 */
export type HoverStatus = "none" | "hovered" | "on-route";

/**
 * A primitive per endpoint, which is what keeps hovering cheap: ~112 sockets
 * and strips each recompute a string, and only those whose string actually
 * changed rerender. Returning a route object here would rerender everything.
 */
export function selectHoverStatus(
  endpoint: EndpointId,
): (state: AppState) => HoverStatus {
  return (state) => {
    const hovered = state.hoveredEndpoint;
    if (hovered === null) return "none";
    if (hovered === endpoint) return "hovered";

    // Read the precomputed index; never traverse the graph here.
    const routes = state.routeIndex.byEndpoint.get(hovered) ?? [];
    return routes.some((route) => route.endpoints.includes(endpoint))
      ? "on-route"
      : "none";
  };
}

// --- whole slices (stable identities, for the tooltip) ---------------------

export function selectInstallation(state: AppState): Installation {
  return state.installation;
}

export function selectRouteIndex(state: AppState): RouteIndex {
  return state.routeIndex;
}

export function selectChannels(state: AppState): MixerChannelState[] {
  return state.channels;
}

// --- structural slice ------------------------------------------------------

/**
 * The device a component was told to render. `undefined` when the hard-coded
 * layout names a device the loaded `installation.yaml` does not declare — the
 * component says so rather than crashing the whole schematic.
 */
export function selectDevice(
  device: DeviceId,
): (state: AppState) => Device | undefined {
  return (state) =>
    state.installation.devices.find((candidate) => candidate.id === device);
}

// --- configuration slice ---------------------------------------------------

/**
 * One channel strip's own state. `undefined` before the first snapshot
 * arrives, which is a normal state: topology renders without a mixer.
 */
export function selectChannelState(
  channel: MixerChannelId,
): (state: AppState) => MixerChannelState | undefined {
  return (state) =>
    state.channels.find((candidate) => candidate.channel === channel);
}
