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
 *    lookups (`routeIndex.byEndpoint`, `byMixerChannel`) belong here, which is
 *    where plan steps 7–8 add the hover/selection highlight selectors.
 */

import type {
  Device,
  DeviceId,
  EndpointId,
  MixerChannelId,
  MixerChannelState,
} from "@x32/domain";
import type { MixerConnectionState } from "@x32/mixer-contracts";

import type { AppState } from "./store";

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
