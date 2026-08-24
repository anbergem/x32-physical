/**
 * The app store (architecture.md §5).
 *
 * Three slices with three different lifecycles, deliberately never merged:
 *
 * - `installation` — structural, set once at load, effectively immutable.
 * - `channels` / `baseline` — mixer configuration; changes occasionally. A
 *   *source* change rebuilds the derived `routeIndex`; a rename does not,
 *   because routes are derived from sources alone (architecture.md §5).
 * - `connection` / `selectedChannel` / `hoveredEndpoint` — runtime state, fast
 *   changing. Writing these must **never** rebuild the route index
 *   (CLAUDE.md invariant 1); `store.test.ts` asserts the object identity.
 *
 * `routeIndex` and `discrepancies` (step 13) are two *independent* derived
 * values with two different invalidation triggers — `routeIndex` from
 * (installation, channels' sources), `discrepancies` from (channels,
 * baseline) via `compareRouting`, which also compares names. A rename must
 * recompute `discrepancies` (it may fix or introduce a name-mismatch) without
 * touching `routeIndex` — so each action composes only the patch its own
 * change requires, never a shared "recompute everything derived" step.
 *
 * A vanilla store rather than a `create()` hook so it can be built with the
 * loaded installation in hand (no nullable structural slice) and driven from
 * plain Node tests. React reads it through `./storeContext`.
 */

import type {
  EndpointId,
  Installation,
  MixerChannelId,
  MixerChannelState,
  MixerSourceRef,
  RouteIndex,
  RoutingDiscrepancy,
} from "@x32/domain";
import { buildRouteIndex, compareRouting, mixerSourceRefEquals } from "@x32/domain";
import type { MixerConnectionState, MixerSnapshot } from "@x32/mixer-contracts";
import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";

/** The state shape of architecture.md §5, verbatim. */
export interface AppState {
  // Structural: set at load, effectively immutable.
  installation: Installation;

  // Mixer configuration: changes occasionally; updating it rebuilds routeIndex.
  channels: MixerChannelState[];

  // Blessed known-good snapshot (config lifecycle; null until first save).
  baseline: MixerSnapshot | null;

  // Derived (recomputed only when installation/channels' sources change):
  routeIndex: RouteIndex;
  // Derived (recomputed only when channels/baseline change; [] w/o baseline):
  discrepancies: RoutingDiscrepancy[];

  // Runtime: fast-changing, never triggers index rebuilds.
  connection: MixerConnectionState;
  selectedChannel: MixerChannelId | null; // from the physical console
  hoveredEndpoint: EndpointId | null; // browser-local

  // Runtime: transient UI feedback for a rejected `save-baseline` (step 14).
  // Never touches `baseline`/`discrepancies` — a rejected save changed
  // nothing about either.
  baselineSaveError: string | null;
}

/**
 * The only sanctioned writes. They are grouped by the slice they touch, and
 * nothing outside this module calls `setState` — that is what keeps the
 * "runtime writes never rebuild the index" rule checkable in one file.
 *
 * These are *store* mutations, not mixer commands: the production app stays
 * read-only towards the console (CLAUDE.md invariant 5).
 */
export interface AppActions {
  /** Configuration + runtime, as one atomic mixer snapshot. */
  applySnapshot(snapshot: MixerSnapshot, connection: MixerConnectionState): void;

  // Configuration slice — only a source change rebuilds routeIndex.
  setChannelName(channel: MixerChannelId, name: string): void;
  setChannelSource(channel: MixerChannelId, source: MixerSourceRef): void;

  // Configuration slice — recomputes discrepancies only, never routeIndex.
  setBaseline(baseline: MixerSnapshot | null): void;

  // Runtime slice — never rebuilds routeIndex.
  setConnection(connection: MixerConnectionState): void;
  setSelectedChannel(channel: MixerChannelId | null): void;
  setHoveredEndpoint(endpoint: EndpointId | null): void;
  setBaselineSaveError(reason: string | null): void;
}

export type AppStoreState = AppState & AppActions;
export type AppStore = StoreApi<AppStoreState>;

/** The configuration slice and its derived index, rebuilt together. */
type ConfigurationPatch = Pick<AppState, "channels" | "routeIndex">;

function configurationPatch(
  installation: Installation,
  channels: MixerChannelState[],
): ConfigurationPatch {
  return { channels, routeIndex: buildRouteIndex(installation, channels) };
}

/**
 * `discrepancies`' own patch, independent of `configurationPatch`: it only
 * depends on `channels` and `baseline`, never `installation`, and every
 * caller merges it as a *separate* key from `routeIndex` so the two derived
 * values invalidate independently (architecture.md §5).
 */
type DiscrepancyPatch = Pick<AppState, "discrepancies">;

function discrepancyPatch(
  channels: MixerChannelState[],
  baseline: MixerSnapshot | null,
): DiscrepancyPatch {
  return {
    discrepancies: baseline === null ? [] : compareRouting(baseline.channels, channels),
  };
}

/**
 * Replaces one channel, leaving every other entry's object identity intact so
 * that a strip subscribed to its own channel does not rerender when a
 * neighbour changes (architecture.md §5). Returns `null` when there is nothing
 * to do, so an unchanged store never notifies listeners.
 *
 * Whether the route index needs rebuilding is the caller's call: routes are
 * derived from *sources*, so a rename leaves them intact.
 */
function replaceChannel(
  state: AppState,
  channel: MixerChannelId,
  update: (current: MixerChannelState) => MixerChannelState,
): MixerChannelState[] | null {
  const index = state.channels.findIndex(
    (candidate) => candidate.channel === channel,
  );
  const current = index === -1 ? undefined : state.channels[index];
  if (current === undefined) return null;

  const next = update(current);
  if (next === current) return null;

  const channels = [...state.channels];
  channels[index] = next;
  return channels;
}

/**
 * Structural equality of two sources — `@x32/domain`'s `mixerSourceRefEquals`.
 *
 * This matters on real hardware: the X32 adapter expands one input-block
 * change into eight `channel-source-changed` events, most of which carry the
 * source the channel already had. Without this guard each of them would
 * rebuild the route index and invalidate every highlight lookup.
 */
const sameSource: (a: MixerSourceRef, b: MixerSourceRef) => boolean =
  mixerSourceRefEquals;

function cloneChannel(channel: MixerChannelState): MixerChannelState {
  return {
    channel: channel.channel,
    name: channel.name,
    source: { ...channel.source },
  };
}

/**
 * @param installation the loaded topology — structural, never replaced.
 * @param channels     initial mixer configuration; empty until the gateway
 *                     delivers the first snapshot. The schematic renders fine
 *                     without it (topology alone), which is exactly what has to
 *                     happen while the mixer is unreachable.
 */
export function createAppStore(
  installation: Installation,
  channels: MixerChannelState[] = [],
): AppStore {
  return createStore<AppStoreState>()((set, get) => ({
    installation,
    ...configurationPatch(installation, channels),
    baseline: null,
    ...discrepancyPatch(channels, null),
    connection: "disconnected",
    selectedChannel: null,
    hoveredEndpoint: null,
    baselineSaveError: null,

    applySnapshot(snapshot, connection) {
      const state = get();
      const nextChannels = snapshot.channels.map(cloneChannel);
      set({
        ...configurationPatch(state.installation, nextChannels),
        ...discrepancyPatch(nextChannels, state.baseline),
        selectedChannel: snapshot.selectedChannel,
        connection,
      });
    },

    /** Names are not part of a route: no index rebuild — but discrepancies
     * compare names too, so they do recompute. */
    setChannelName(channel, name) {
      const state = get();
      const channels = replaceChannel(state, channel, (current) =>
        current.name === name ? current : { ...current, name },
      );
      if (channels !== null) {
        set({ channels, ...discrepancyPatch(channels, state.baseline) });
      }
    },

    setChannelSource(channel, source) {
      const state = get();
      const channels = replaceChannel(state, channel, (current) =>
        sameSource(current.source, source)
          ? current
          : { ...current, source: { ...source } },
      );
      if (channels !== null) {
        set({
          ...configurationPatch(state.installation, channels),
          ...discrepancyPatch(channels, state.baseline),
        });
      }
    },

    /** Only `discrepancies` recomputes — `routeIndex` depends on installation
     * + channels' sources alone, untouched by a baseline change. */
    setBaseline(baseline) {
      const state = get();
      if (state.baseline === baseline) return;
      set({ baseline, ...discrepancyPatch(state.channels, baseline) });
    },

    setConnection(connection) {
      if (get().connection !== connection) set({ connection });
    },

    setSelectedChannel(channel) {
      if (get().selectedChannel !== channel) set({ selectedChannel: channel });
    },

    setHoveredEndpoint(endpoint) {
      if (get().hoveredEndpoint !== endpoint) set({ hoveredEndpoint: endpoint });
    },

    setBaselineSaveError(reason) {
      if (get().baselineSaveError !== reason) set({ baselineSaveError: reason });
    },
  }));
}
