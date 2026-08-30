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
import type { MixerSnapshot } from "@x32/mixer-contracts";

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
