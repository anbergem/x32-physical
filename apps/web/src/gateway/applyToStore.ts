/**
 * Mixer data → store slices. The only mapping from the mixer's event shapes
 * onto the state boundaries of architecture.md §5, shared by every gateway
 * implementation (the WebSocket one in plan step 9 reuses it verbatim).
 *
 * The slice each event lands in is the whole point:
 *
 * | event                      | slice                                  |
 * | -------------------------- | -------------------------------------- |
 * | `selected-channel-changed` | runtime only — no index rebuild        |
 * | `connection-state-changed` | runtime only — no index rebuild        |
 * | `channel-name-changed`     | configuration — no index rebuild       |
 * | `channel-source-changed`   | configuration — rebuilds the index     |
 * | `output-source-changed`    | configuration — rebuilds outputRouteIndex only |
 *
 * `applyBaseline` (step 13) is the sibling entry point for the `baseline`
 * slice — not a `MixerEvent` variant, since it is not mixer state at all.
 * `applyInstallation` (issue #27) is the same idea for the *structural*
 * slice: an edit is not mixer state either, and it lands through one function
 * both gateways call, so a live broadcast and a mock-mode edit cannot end up
 * writing different slices.
 */

import type { Installation, MixerSourceMeterLevels } from "@x32/domain";
import type {
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";
import type { UpdateAvailable } from "@x32/protocol";

import type { AppStore } from "../state/store";

export function applyMixerSnapshot(
  store: AppStore,
  snapshot: MixerSnapshot,
  connection: MixerConnectionState,
): void {
  store.getState().applySnapshot(snapshot, connection);
}

/**
 * The one path both gateways use to set the `baseline` slice (architecture.md
 * §7): the WS `snapshot` message's `baseline` field, a `baseline-changed`
 * event, and mock mode's persisted-on-load value all funnel through here.
 */
export function applyBaseline(store: AppStore, baseline: MixerSnapshot | null): void {
  store.getState().setBaseline(baseline);
}

/**
 * The `updateAvailable` slice's own entry point (step 20) — shared by both
 * wire forms (`snapshot`'s field and the standalone `update-available`
 * message) and by mock mode, which never calls it at all (`LocalMockGateway`
 * has no bridge, so the slice stays `null`).
 */
export function applyUpdateAvailable(
  store: AppStore,
  update: UpdateAvailable | null,
): void {
  store.getState().setUpdateAvailable(update);
}

/**
 * The `meters` slice's own entry point (step 15) — deliberately not a
 * `MixerEvent` variant (architecture.md §4/§5): the fourth, fastest state
 * path, wired straight to `setMeterLevels` and nothing else.
 */
export function applyMeterLevels(store: AppStore, levels: number[]): void {
  store.getState().setMeterLevels(levels);
}

/** The output side's equivalent (issue #36); same fast path, same slice discipline. */
export function applySourceMeterLevels(
  store: AppStore,
  levels: MixerSourceMeterLevels,
): void {
  store.getState().setSourceMeterLevels(levels);
}

/**
 * The structural slice's own entry point (issue #27): a topology that has
 * been edited, from the bridge's `installation-changed` broadcast or from a
 * mock-mode edit against the in-memory repository. Rebuilds what derives from
 * `installation` and touches no runtime slice — a second browser renaming a
 * device must not disturb the route this one has pinned, the meters it is
 * watching, or its connection state.
 */
export function applyInstallation(
  store: AppStore,
  installation: Installation,
  version: string | null,
): void {
  store.getState().setInstallation(installation, version);
}

/** The `installationVersion` alone — the `snapshot` message's field. */
export function applyInstallationVersion(
  store: AppStore,
  version: string | null,
): void {
  store.getState().setInstallationVersion(version);
}

/** A refused edit (issue #27) — the mirror of `baseline-save-rejected`. */
export function applyInstallationEditError(store: AppStore, reason: string | null): void {
  store.getState().setInstallationEditError(reason);
}

export function applyMixerEvent(store: AppStore, event: MixerEvent): void {
  const state = store.getState();

  switch (event.type) {
    case "selected-channel-changed":
      state.setSelectedChannel(event.channel);
      return;
    case "channel-name-changed":
      state.setChannelName(event.channel, event.name);
      return;
    case "channel-source-changed":
      state.setChannelSource(event.channel, event.source);
      return;
    case "output-source-changed":
      state.setOutputSource(event.output, event.source);
      return;
    case "connection-state-changed":
      state.setConnection(event.state);
      return;
    case "aes50-link-state-changed":
      state.setAes50LinkState(event.state);
      return;
    case "aes50-chain-changed":
      state.setAes50Chain(event.chain);
      return;
    default:
      // Exhaustive at compile time. At runtime an event type this build does
      // not know (an older client against a newer bridge) is ignored rather
      // than thrown: one stray message must not blank the schematic.
      ignoreUnknownEvent(event);
  }
}

function ignoreUnknownEvent(_event: never): void {
  // Intentionally empty — see the `default` branch above.
}
