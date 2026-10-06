/**
 * Defensive copies of `MixerSnapshot`, so the bridge's cache and a client's
 * outbound message never alias the same objects (same discipline as
 * `MockMixerClient`'s and the web store's own clone helpers).
 */

import type {
  Aes50Chain,
  Aes50LinkState,
  MixerChannelState,
  MixerOutputState,
} from "@x32/domain";
import type { MixerEvent, MixerSnapshot } from "@x32/mixer-contracts";

function cloneChannel(channel: MixerChannelState): MixerChannelState {
  return {
    channel: channel.channel,
    name: channel.name,
    source: { ...channel.source },
  };
}

function cloneOutput(output: MixerOutputState): MixerOutputState {
  return {
    output: output.output,
    name: output.name,
    source: { ...output.source },
  };
}

function cloneAes50LinkState(state: Aes50LinkState | null | undefined): Aes50LinkState | null {
  if (state === null || state === undefined) return null;
  return { buses: state.buses.map((bus) => ({ ...bus })), locked: state.locked };
}

function cloneAes50Chain(chains: Aes50Chain[] | undefined): Aes50Chain[] {
  return (chains ?? []).map((chain) => ({
    bus: chain.bus,
    boxes: chain.boxes.map((box) => ({ ...box })),
  }));
}

export function cloneSnapshot(snapshot: MixerSnapshot): MixerSnapshot {
  return {
    channels: snapshot.channels.map(cloneChannel),
    outputs: snapshot.outputs.map(cloneOutput),
    selectedChannel: snapshot.selectedChannel,
    aes50LinkState: cloneAes50LinkState(snapshot.aes50LinkState),
    aes50Chain: cloneAes50Chain(snapshot.aes50Chain),
  };
}

/**
 * Folds one `MixerEvent` into a snapshot, returning a new one — the bridge's
 * equivalent of `apps/web`'s `applyToStore`, and what keeps the snapshot it
 * hands a *newly connecting* client as current as the one an already-open
 * client has arrived at event by event.
 *
 * The `switch` is exhaustive on purpose. This used to be an `if` chain in
 * `bridgeServer.ts` that knew three event types; the three added later
 * (output routing, AES50 link state, AES50 chain) were forwarded to open
 * clients but never applied here, so a browser opened after the console's
 * boot got whatever those read at the moment of connect — forever. A new
 * `MixerEvent` member now fails to compile until it has a case.
 */
export function applyEventToSnapshot(snapshot: MixerSnapshot, event: MixerEvent): MixerSnapshot {
  switch (event.type) {
    case "selected-channel-changed":
      return { ...snapshot, selectedChannel: event.channel };
    case "channel-name-changed":
      return {
        ...snapshot,
        channels: snapshot.channels.map((current) =>
          current.channel === event.channel ? { ...current, name: event.name } : current,
        ),
      };
    case "channel-source-changed":
      return {
        ...snapshot,
        channels: snapshot.channels.map((current) =>
          current.channel === event.channel ? { ...current, source: { ...event.source } } : current,
        ),
      };
    case "output-source-changed":
      return {
        ...snapshot,
        outputs: snapshot.outputs.map((current) =>
          current.output === event.output ? { ...current, source: { ...event.source } } : current,
        ),
      };
    case "aes50-link-state-changed":
      return { ...snapshot, aes50LinkState: cloneAes50LinkState(event.state) };
    case "aes50-chain-changed": {
      // Each bus reports independently: replace that bus's entry in place
      // (keeping the order clients already saw), or add it if it is new.
      const [chain] = cloneAes50Chain([event.chain]) as [Aes50Chain];
      const existing = snapshot.aes50Chain ?? [];
      const known = existing.some((current) => current.bus === chain.bus);
      return {
        ...snapshot,
        aes50Chain: known
          ? existing.map((current) => (current.bus === chain.bus ? chain : current))
          : [...existing, chain],
      };
    }
    case "connection-state-changed":
      return snapshot; // the connection is not part of the snapshot; the server tracks it separately.
    default:
      // Exhaustive at compile time. At runtime an unknown event leaves the
      // snapshot alone rather than throwing: the bridge must outlive it.
      ignoreUnknownEvent(event);
      return snapshot;
  }
}

function ignoreUnknownEvent(_event: never): void {
  // Intentionally empty — see the `default` branch above.
}
