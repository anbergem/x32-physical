/**
 * The mixer contract (architecture.md §4).
 *
 * `MixerClient` is the substitution point (CLAUDE.md invariant 3): everything
 * downstream depends on this interface, and `X32MixerClient` (bridge only) and
 * `MockMixerClient` are interchangeable. Nothing here knows about OSC, UDP,
 * WebSockets or the X32's 0-based indexing — the adapter hands over the
 * already-normalized domain types.
 */

import type {
  MixerChannelId,
  MixerChannelState,
  MixerSourceRef,
} from "@x32/domain";

export type MixerConnectionState = "connecting" | "connected" | "disconnected";

export interface MixerSnapshot {
  /** Exactly 32 entries — the X32's input channels, 1-based. */
  channels: MixerChannelState[];
  /** The channel SELECTed on the physical console, if any. */
  selectedChannel: MixerChannelId | null;
}

/**
 * Incremental changes, in the same shapes the mock and the real adapter emit.
 *
 * There is deliberately no `routing-changed` event: input-block and User In
 * changes are expanded by the adapter into per-channel `channel-source-changed`
 * events (possibly many at once), so consumers have exactly one code path for
 * "a channel's effective source changed".
 */
export type MixerEvent =
  | { type: "selected-channel-changed"; channel: MixerChannelId | null }
  | { type: "channel-name-changed"; channel: MixerChannelId; name: string }
  | {
      type: "channel-source-changed";
      channel: MixerChannelId;
      source: MixerSourceRef;
    }
  | { type: "connection-state-changed"; state: MixerConnectionState };

export type MixerEventListener = (event: MixerEvent) => void;

/** Cancels a subscription. Calling it more than once is a no-op. */
export type Unsubscribe = () => void;

/**
 * Read-only by design: commands (writes) are absent on purpose (CLAUDE.md
 * invariant 5). Only `MockMixerClient` exposes mutation, through its own wider
 * `simulate*` API, which production code never sees.
 */
export interface MixerClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): Promise<MixerSnapshot>;
  subscribe(listener: MixerEventListener): Unsubscribe;
  getConnectionState(): MixerConnectionState;
}
