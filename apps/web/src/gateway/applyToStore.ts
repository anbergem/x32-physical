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
 */

import type {
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

export function applyMixerSnapshot(
  store: AppStore,
  snapshot: MixerSnapshot,
  connection: MixerConnectionState,
): void {
  store.getState().applySnapshot(snapshot, connection);
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
    case "connection-state-changed":
      state.setConnection(event.state);
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
