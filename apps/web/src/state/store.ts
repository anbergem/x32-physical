/**
 * The app store (architecture.md §5).
 *
 * Three slices with three different lifecycles, deliberately never merged:
 *
 * - `installation` — structural, set once at load, effectively immutable.
 * - `channels` — mixer configuration; changes occasionally, and every write
 *   rebuilds the derived `routeIndex`.
 * - `connection` / `selectedChannel` / `hoveredEndpoint` — runtime state, fast
 *   changing. Writing these must **never** rebuild the route index
 *   (CLAUDE.md invariant 1); `store.test.ts` asserts the object identity.
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
} from "@x32/domain";
import { buildRouteIndex } from "@x32/domain";
import type { MixerConnectionState, MixerSnapshot } from "@x32/mixer-contracts";
import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";

/** The state shape of architecture.md §5, verbatim. */
export interface AppState {
  // Structural: set at load, effectively immutable.
  installation: Installation;

  // Mixer configuration: changes occasionally; updating it rebuilds routeIndex.
  channels: MixerChannelState[];

  // Derived (recomputed only when installation/channels change):
  routeIndex: RouteIndex;

  // Runtime: fast-changing, never triggers index rebuilds.
  connection: MixerConnectionState;
  selectedChannel: MixerChannelId | null; // from the physical console
  hoveredEndpoint: EndpointId | null; // browser-local
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

  // Configuration slice — each rebuilds routeIndex.
  setChannelName(channel: MixerChannelId, name: string): void;
  setChannelSource(channel: MixerChannelId, source: MixerSourceRef): void;

  // Runtime slice — never rebuilds routeIndex.
  setConnection(connection: MixerConnectionState): void;
  setSelectedChannel(channel: MixerChannelId | null): void;
  setHoveredEndpoint(endpoint: EndpointId | null): void;
}

export type AppStoreState = AppState & AppActions;
export type AppStore = StoreApi<AppStoreState>;

/** The configuration slice and its derived index always move together. */
type ConfigurationPatch = Pick<AppState, "channels" | "routeIndex">;

function configurationPatch(
  installation: Installation,
  channels: MixerChannelState[],
): ConfigurationPatch {
  return { channels, routeIndex: buildRouteIndex(installation, channels) };
}

/**
 * Replaces one channel, leaving every other entry's object identity intact so
 * that a strip subscribed to its own channel does not rerender when a
 * neighbour changes (architecture.md §5). Returns `null` when there is nothing
 * to do, so an unchanged store never notifies listeners.
 */
function patchChannel(
  state: AppState,
  channel: MixerChannelId,
  update: (current: MixerChannelState) => MixerChannelState,
): ConfigurationPatch | null {
  const index = state.channels.findIndex(
    (candidate) => candidate.channel === channel,
  );
  const current = index === -1 ? undefined : state.channels[index];
  if (current === undefined) return null;

  const next = update(current);
  if (next === current) return null;

  const channels = [...state.channels];
  channels[index] = next;
  return configurationPatch(state.installation, channels);
}

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
    connection: "disconnected",
    selectedChannel: null,
    hoveredEndpoint: null,

    applySnapshot(snapshot, connection) {
      const state = get();
      set({
        ...configurationPatch(
          state.installation,
          snapshot.channels.map(cloneChannel),
        ),
        selectedChannel: snapshot.selectedChannel,
        connection,
      });
    },

    setChannelName(channel, name) {
      const patch = patchChannel(get(), channel, (current) =>
        current.name === name ? current : { ...current, name },
      );
      if (patch !== null) set(patch);
    },

    setChannelSource(channel, source) {
      const patch = patchChannel(get(), channel, (current) => ({
        ...current,
        source: { ...source },
      }));
      if (patch !== null) set(patch);
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
  }));
}
