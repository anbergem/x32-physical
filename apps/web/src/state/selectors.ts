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
  Aes50Bus,
  Aes50ChainDiscrepancy,
  Aes50LinkState,
  Device,
  DeviceId,
  EndpointId,
  Installation,
  MixerChannelId,
  MixerChannelState,
  RouteIndex,
  RoutingDiscrepancy,
} from "@x32/domain";
import { endpointId, mixerChannel, mixerSourceRefEquals, parseEndpointId } from "@x32/domain";
import type { MixerConnectionState, MixerSnapshot } from "@x32/mixer-contracts";
import type { UpdateAvailable } from "@x32/protocol";

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

/**
 * How an endpoint relates to what the physical console has SELECTed:
 *
 * - `selected` — this is the mixer-channel endpoint of `selectedChannel`
 *   itself.
 * - `on-selected-route` — it is elsewhere on that channel's route (its
 *   physical source, and any sibling channel fed by the same source).
 * - `none` — unrelated, or nothing is selected.
 *
 * A separate status from `HoverStatus` on purpose (architecture.md §5):
 * selection is runtime state that arrives from the physical console and must
 * never be touched by hovering, so it gets its own selector, its own CSS
 * layer (`highlight.ts`'s `selectionModifier`) and its own set of classes —
 * an endpoint on both the hovered and the selected route carries both
 * modifier classes at once.
 */
export type SelectionStatus = "none" | "selected" | "on-selected-route";

/**
 * A primitive per endpoint, for the same rerender-discipline reason as
 * `selectHoverStatus`: only the endpoints on the (small) selected route
 * change status when `selectedChannel` changes.
 */
export function selectSelectionStatus(
  endpoint: EndpointId,
): (state: AppState) => SelectionStatus {
  return (state) => {
    const selected = state.selectedChannel;
    if (selected === null) return "none";

    if (endpointId(mixerChannel(selected)) === endpoint) return "selected";

    // Read the precomputed index; never traverse the graph here. A selected
    // channel with an unmapped source still has an entry here (its route is
    // just its own strip), so this never throws or falls through.
    const route = state.routeIndex.byMixerChannel.get(selected);
    return route !== undefined && route.endpoints.includes(endpoint)
      ? "on-selected-route"
      : "none";
  };
}

// --- diagnostics (plan step 14) ---------------------------------------------

/**
 * How an endpoint relates to the baseline diff (architecture.md §3 "Routing
 * diff"), a third highlight layer independent of hover and selection:
 *
 * - `source-mismatch` — a mixer-channel strip whose live source disagrees
 *   with the baseline (error).
 * - `shared-source` — a mixer-channel strip listed in an
 *   `unexpected-shared-source` discrepancy (its own source may still match
 *   the baseline; it is the *sharing* that is new).
 * - `expected-source` — a physical/AES50 socket that is the baseline's
 *   source for some `source-mismatch` channel — a subtle marker, never on a
 *   strip.
 * - `none` — unrelated, or there is no baseline / no discrepancies.
 *
 * `name-mismatch` never produces a status here (informational-only, tooltip
 * text only, no badge — architecture.md §3).
 */
export type DiagnosticStatus =
  | "none"
  | "source-mismatch"
  | "shared-source"
  | "expected-source";

/**
 * A primitive per endpoint, for the same rerender-discipline reason as
 * `selectHoverStatus`/`selectSelectionStatus`. Mixer-channel endpoints look
 * themselves up directly in `discrepancies`; physical/AES50 endpoints reuse
 * the precomputed `routeIndex` (never a fresh topology walk) to find the
 * expected physical socket of a `source-mismatch`: the channel, if any,
 * whose *actual* source equals the discrepancy's `expected` source.
 */
export function selectDiagnosticStatus(
  endpoint: EndpointId,
): (state: AppState) => DiagnosticStatus {
  return (state) => {
    if (state.discrepancies.length === 0) return "none";
    const ref = parseEndpointId(endpoint);

    if (ref.kind === "mixer-channel") {
      const channel = ref.channel;
      for (const discrepancy of state.discrepancies) {
        if (discrepancy.kind === "source-mismatch" && discrepancy.channel === channel) {
          return "source-mismatch";
        }
      }
      for (const discrepancy of state.discrepancies) {
        if (
          discrepancy.kind === "unexpected-shared-source" &&
          discrepancy.channels.includes(channel)
        ) {
          return "shared-source";
        }
      }
      return "none";
    }

    for (const discrepancy of state.discrepancies) {
      if (discrepancy.kind !== "source-mismatch") continue;
      for (const candidate of state.channels) {
        if (!mixerSourceRefEquals(candidate.source, discrepancy.expected)) continue;
        const route = state.routeIndex.byMixerChannel.get(candidate.channel);
        if (route !== undefined && route.endpoints.includes(endpoint)) {
          return "expected-source";
        }
      }
    }
    return "none";
  };
}

export function selectDiscrepancies(state: AppState): RoutingDiscrepancy[] {
  return state.discrepancies;
}

export function selectBaseline(state: AppState): MixerSnapshot | null {
  return state.baseline;
}

/** The bridge's GitHub Releases check result (step 20) — `null` in mock mode always. */
export function selectUpdateAvailable(state: AppState): UpdateAvailable | null {
  return state.updateAvailable;
}

export function selectBaselineSaveError(state: AppState): string | null {
  return state.baselineSaveError;
}

// --- AES50 link + chain (issue #17) -----------------------------------------

export function selectAes50LinkState(state: AppState): Aes50LinkState | null {
  return state.aes50LinkState;
}

export function selectAes50ChainDiscrepancies(state: AppState): Aes50ChainDiscrepancy[] {
  return state.aes50ChainDiscrepancies;
}

/**
 * The set of AES50 buses `installation` actually declares stageboxes on.
 * Computed fresh per call — a `Set` isn't stable-identity output, but every
 * caller below only ever asks membership questions, never renders it, so
 * that's fine.
 */
function busesInUse(installation: Installation): ReadonlySet<Aes50Bus> {
  const buses = new Set<Aes50Bus>();
  for (const device of installation.devices) {
    if (device.kind === "stagebox" && device.aes50 !== undefined) {
      buses.add(device.aes50.bus);
    }
  }
  return buses;
}

/**
 * The headline warning (issue #17): the bus with an active audio error, but
 * only when the installation actually declares stageboxes on it — an error
 * on an unused bus (this venue's AES50-B) must never surface, or a
 * permanently-red indicator would train operators to ignore it. Returns a
 * primitive (`Aes50Bus | null`), matching this file's per-value selector
 * discipline: no data yet (`aes50LinkState === null`) or a healthy link both
 * read as `null` here — deliberately indistinguishable, since neither is
 * "something to warn about".
 */
export function selectAes50LinkWarningBus(state: AppState): Aes50Bus | null {
  const link = state.aes50LinkState;
  if (link === null) return null;
  const used = busesInUse(state.installation);
  for (const busState of link.buses) {
    if (used.has(busState.bus) && busState.audioError) return busState.bus;
  }
  return null;
}

/** The quieter warning (issue #17): the detected AES50 chain disagrees with `installation.yaml`. */
export function selectAes50ChainWarning(state: AppState): boolean {
  return state.aes50ChainDiscrepancies.length > 0;
}

/** Stable action identity: subscribing to it never causes a rerender. */
export function selectSetBaselineSaveError(
  state: AppStoreState,
): (reason: string | null) => void {
  return state.setBaselineSaveError;
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

// --- meters (fourth, fastest path — step 15) --------------------------------

/**
 * One channel's own level, and nothing else — the primitive-per-endpoint
 * discipline of `selectHoverStatus`/`selectSelectionStatus` applies here too,
 * only more so: a strip must never rerender because some *other* channel's
 * level ticked. `null` before the first `meters` message/mock tick, or
 * whenever meters aren't flowing at all (mock mode with the toggle off, or a
 * bridge whose adapter has no meters capability) — a strip with no data shows
 * no bar (architecture.md §5).
 */
export function selectMeterLevel(
  channel: MixerChannelId,
): (state: AppState) => number | null {
  return (state) => state.meterLevels?.[channel - 1] ?? null;
}

/**
 * One physical/AES50 socket's own level: the console cannot meter a point
 * upstream of its own input stage, so this is the *maximum* level among the
 * mixer channels consuming the socket (routeIndex.byEndpoint -> its route(s)
 * -> mixerChannels -> meterLevels) — an honest approximation, not a true
 * socket measurement, since what's actually read is the consuming channel's
 * post-preamp meter. A socket no channel consumes returns `null` rather than
 * a zero bar: the console cannot meter a socket nobody listens to, and a zero
 * bar would wrongly imply silence rather than "not monitored". Primitive per
 * endpoint, for the same rerender-discipline reason as `selectMeterLevel`.
 */
export function selectSocketMeterLevel(
  endpoint: EndpointId,
): (state: AppState) => number | null {
  return (state) => {
    if (state.meterLevels === null) return null;
    const levels = state.meterLevels;
    const routes = state.routeIndex.byEndpoint.get(endpoint);
    if (routes === undefined) return null;

    let max: number | null = null;
    for (const route of routes) {
      for (const channel of route.mixerChannels) {
        const level = levels[channel - 1];
        if (level === undefined) continue;
        if (max === null || level > max) max = level;
      }
    }
    return max;
  };
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
