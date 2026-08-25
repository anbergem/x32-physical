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
  Aes50Chain,
  Aes50ChainDiscrepancy,
  Aes50LinkState,
  EndpointId,
  Installation,
  MixerChannelId,
  MixerChannelState,
  MixerOutputSourceRef,
  MixerOutputState,
  MixerSourceRef,
  OutputRouteIndex,
  RouteIndex,
  RoutingDiscrepancy,
} from "@x32/domain";
import {
  aes50LinkStateEquals,
  buildOutputRouteIndex,
  buildRouteIndex,
  compareAes50Chain,
  compareRouting,
  mixerOutputSourceRefEquals,
  mixerSourceRefEquals,
} from "@x32/domain";
import type { MixerConnectionState, MixerSnapshot } from "@x32/mixer-contracts";
import type { UpdateAvailable } from "@x32/protocol";
import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";

/** The state shape of architecture.md §5, verbatim. */
export interface AppState {
  // Structural: set at load, effectively immutable.
  installation: Installation;

  // Mixer configuration: changes occasionally; updating it rebuilds routeIndex.
  channels: MixerChannelState[];

  // Mixer configuration (issue #11): the 16 console Out slots. Changes
  // occasionally, exactly like `channels` — updating it rebuilds
  // `outputRouteIndex` alone, never `routeIndex`/`discrepancies` (those are
  // the input side's own derived values, untouched by output changes).
  outputs: MixerOutputState[];

  // Blessed known-good snapshot (config lifecycle; null until first save).
  baseline: MixerSnapshot | null;

  // Config lifecycle (step 20): the bridge's GitHub Releases check result,
  // changing at most a couple of times a day — never the fast runtime path.
  // Never touches routeIndex/discrepancies; mock mode (no bridge) leaves it
  // null forever.
  updateAvailable: UpdateAvailable | null;

  // Derived (recomputed only when installation/channels' sources change):
  routeIndex: RouteIndex;
  // Derived (recomputed only when channels/baseline change; [] w/o baseline):
  discrepancies: RoutingDiscrepancy[];

  // Derived (issue #11; recomputed only when installation/outputs change).
  // A separate index from `routeIndex` — the input and output endpoint-kind
  // spaces are disjoint (architecture.md §3), and an outputs change must
  // never rebuild the input side's `routeIndex`/`discrepancies`.
  outputRouteIndex: OutputRouteIndex;

  // Runtime: fast-changing, never triggers index rebuilds.
  connection: MixerConnectionState;
  selectedChannel: MixerChannelId | null; // from the physical console
  hoveredEndpoint: EndpointId | null; // browser-local

  // Runtime: transient UI feedback for a rejected `save-baseline` (step 14).
  // Never touches `baseline`/`discrepancies` — a rejected save changed
  // nothing about either.
  baselineSaveError: string | null;

  // Runtime: a fourth, fastest state path (architecture.md §5, step 15) —
  // live per-channel meter levels, updated several times a second. `null`
  // until the first `meters` message/mock tick arrives. Its own slice,
  // disjoint from everything above: a meters update never touches
  // routeIndex/channels/discrepancies/baseline/selection/hover, and none of
  // those setters ever touch it (`store.test.ts` asserts both directions).
  meterLevels: number[] | null;

  // Config lifecycle (issue #17): `/-stat/aes50/state` and
  // `/-stat/aes50/[A,B]` change on the order of "console reboots or a box
  // is swapped" — never the fast runtime path, and neither ever touches
  // `routeIndex`. `aes50LinkState` is `null` until the first read/mock tick
  // ("not yet known", never treated as "healthy"); `aes50Chain` is `[]` the
  // same way. `aes50ChainDiscrepancies` is the one derived value here,
  // recomputed only when `installation` or `aes50Chain` change
  // (`compareAes50Chain`) — independent of `routeIndex`/`discrepancies`.
  aes50LinkState: Aes50LinkState | null;
  aes50Chain: Aes50Chain[];
  aes50ChainDiscrepancies: Aes50ChainDiscrepancy[];
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

  // Configuration slice (issue #11) — rebuilds outputRouteIndex only, never
  // routeIndex/discrepancies.
  setOutputSource(output: number, source: MixerOutputSourceRef): void;

  // Configuration slice — recomputes discrepancies only, never routeIndex.
  setBaseline(baseline: MixerSnapshot | null): void;

  // Configuration slice (step 20) — its own key, touches nothing derived.
  setUpdateAvailable(update: UpdateAvailable | null): void;

  // Runtime slice — never rebuilds routeIndex.
  setConnection(connection: MixerConnectionState): void;
  setSelectedChannel(channel: MixerChannelId | null): void;
  setHoveredEndpoint(endpoint: EndpointId | null): void;
  setBaselineSaveError(reason: string | null): void;

  // Fourth path — never composed with any other slice's patch (architecture.md §5).
  setMeterLevels(levels: number[] | null): void;

  // Config lifecycle (issue #17) — never touches routeIndex/discrepancies.
  setAes50LinkState(state: Aes50LinkState | null): void;
  /** Replaces one bus's chain entry (matching the adapter's per-bus reads/pushes) and recomputes `aes50ChainDiscrepancies`. */
  setAes50Chain(chain: Aes50Chain): void;
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
 * The output configuration slice and its derived index (issue #11), rebuilt
 * together — the output-side mirror of `configurationPatch`, kept
 * independent so an outputs change never touches `routeIndex`.
 */
type OutputConfigurationPatch = Pick<AppState, "outputs" | "outputRouteIndex">;

function outputConfigurationPatch(
  installation: Installation,
  outputs: MixerOutputState[],
): OutputConfigurationPatch {
  return { outputs, outputRouteIndex: buildOutputRouteIndex(installation, outputs) };
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
 * `aes50ChainDiscrepancies`' own patch (issue #17), the same independence
 * discipline as `discrepancyPatch`: depends on `installation` and
 * `aes50Chain` alone, merged as its own key so it never rebuilds
 * `routeIndex`.
 */
type Aes50ChainPatch = Pick<AppState, "aes50Chain" | "aes50ChainDiscrepancies">;

function aes50ChainPatch(installation: Installation, chain: Aes50Chain[]): Aes50ChainPatch {
  return { aes50Chain: chain, aes50ChainDiscrepancies: compareAes50Chain(installation, chain) };
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
 * The output-side mirror of `replaceChannel`: replaces one output slot,
 * leaving every other entry's object identity intact. `null` when there is
 * nothing to do.
 */
function replaceOutput(
  state: AppState,
  output: number,
  update: (current: MixerOutputState) => MixerOutputState,
): MixerOutputState[] | null {
  const index = state.outputs.findIndex((candidate) => candidate.output === output);
  const current = index === -1 ? undefined : state.outputs[index];
  if (current === undefined) return null;

  const next = update(current);
  if (next === current) return null;

  const outputs = [...state.outputs];
  outputs[index] = next;
  return outputs;
}

/** Structural equality of two output sources — the output-side mirror of `sameSource`. */
const sameOutputSource: (a: MixerOutputSourceRef, b: MixerOutputSourceRef) => boolean =
  mixerOutputSourceRefEquals;

function cloneOutput(output: MixerOutputState): MixerOutputState {
  return {
    output: output.output,
    name: output.name,
    source: { ...output.source },
  };
}

/**
 * @param installation the loaded topology — structural, never replaced.
 * @param channels     initial mixer configuration; empty until the gateway
 *                     delivers the first snapshot. The schematic renders fine
 *                     without it (topology alone), which is exactly what has to
 *                     happen while the mixer is unreachable.
 * @param outputs      initial output configuration (issue #11); empty until
 *                     the gateway delivers the first snapshot, same as `channels`.
 */
export function createAppStore(
  installation: Installation,
  channels: MixerChannelState[] = [],
  outputs: MixerOutputState[] = [],
): AppStore {
  return createStore<AppStoreState>()((set, get) => ({
    installation,
    ...configurationPatch(installation, channels),
    ...outputConfigurationPatch(installation, outputs),
    baseline: null,
    ...discrepancyPatch(channels, null),
    updateAvailable: null,
    connection: "disconnected",
    selectedChannel: null,
    hoveredEndpoint: null,
    baselineSaveError: null,
    meterLevels: null,
    aes50LinkState: null,
    ...aes50ChainPatch(installation, []),

    applySnapshot(snapshot, connection) {
      const state = get();
      const nextChannels = snapshot.channels.map(cloneChannel);
      const nextOutputs = (snapshot.outputs ?? []).map(cloneOutput);
      set({
        ...configurationPatch(state.installation, nextChannels),
        ...outputConfigurationPatch(state.installation, nextOutputs),
        ...discrepancyPatch(nextChannels, state.baseline),
        ...aes50ChainPatch(state.installation, snapshot.aes50Chain ?? []),
        selectedChannel: snapshot.selectedChannel,
        connection,
        aes50LinkState: snapshot.aes50LinkState ?? null,
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

    /** Rebuilds `outputRouteIndex` only — never `routeIndex`/`discrepancies`
     * (issue #11's own identity boundary, mirroring `setChannelSource`). */
    setOutputSource(output, source) {
      const state = get();
      const outputs = replaceOutput(state, output, (current) =>
        sameOutputSource(current.source, source)
          ? current
          : { ...current, source: { ...source } },
      );
      if (outputs !== null) {
        set(outputConfigurationPatch(state.installation, outputs));
      }
    },

    /** Only `discrepancies` recomputes — `routeIndex` depends on installation
     * + channels' sources alone, untouched by a baseline change. */
    setBaseline(baseline) {
      const state = get();
      if (state.baseline === baseline) return;
      set({ baseline, ...discrepancyPatch(state.channels, baseline) });
    },

    setUpdateAvailable(update) {
      const state = get();
      if (
        state.updateAvailable === update ||
        (state.updateAvailable?.version === update?.version &&
          state.updateAvailable?.url === update?.url)
      ) {
        return;
      }
      set({ updateAvailable: update });
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

    /**
     * The one write in this store that runs several times a second — no
     * equality check against the previous value (a fresh `levels` array
     * arrives on every tick anyway) and, crucially, no other key in the
     * patch: `set` only replaces `meterLevels`, so every other slice keeps
     * its exact object identity (architecture.md §5's fourth-path guarantee).
     */
    setMeterLevels(levels) {
      set({ meterLevels: levels });
    },

    /** Never touches routeIndex/discrepancies — config-lifecycle only. */
    setAes50LinkState(state) {
      const current = get().aes50LinkState;
      if (current === state) return;
      if (current !== null && state !== null && aes50LinkStateEquals(current, state)) return;
      set({ aes50LinkState: state });
    },

    /** Replaces one bus's entry and recomputes `aes50ChainDiscrepancies`; other buses' entries keep their identity. */
    setAes50Chain(chain) {
      const state = get();
      const rest = state.aes50Chain.filter((entry) => entry.bus !== chain.bus);
      set(aes50ChainPatch(state.installation, [...rest, chain]));
    },
  }));
}
