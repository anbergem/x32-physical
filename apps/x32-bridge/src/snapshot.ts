/**
 * Defensive copies of `MixerSnapshot`, so the bridge's cache and a client's
 * outbound message never alias the same objects (same discipline as
 * `MockMixerClient`'s and the web store's own clone helpers).
 */

import type { MixerChannelState } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";

function cloneChannel(channel: MixerChannelState): MixerChannelState {
  return {
    channel: channel.channel,
    name: channel.name,
    source: { ...channel.source },
  };
}

export function cloneSnapshot(snapshot: MixerSnapshot): MixerSnapshot {
  return {
    channels: snapshot.channels.map(cloneChannel),
    selectedChannel: snapshot.selectedChannel,
  };
}
