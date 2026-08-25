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
  Aes50Chain,
  Aes50LinkState,
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
  /**
   * `/-stat/aes50/state` decoded (issue #17). `null`/absent means "not read
   * yet" — never treated as "healthy", so a client that predates this field
   * (an older bridge, a stored baseline) never renders a false-clean status.
   */
  aes50LinkState?: Aes50LinkState | null;
  /**
   * `/-stat/aes50/[A,B]` decoded, one entry per bus that has replied
   * (issue #17). Absent/empty means "no chain data yet" — absence is not
   * evidence, so it produces no warning and no cross-check finding.
   */
  aes50Chain?: Aes50Chain[];
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
  | { type: "connection-state-changed"; state: MixerConnectionState }
  /** `/-stat/aes50/state` changed (issue #17) — rare, so a plain `MixerEvent`, unlike meters. */
  | { type: "aes50-link-state-changed"; state: Aes50LinkState }
  /** `/-stat/aes50/[A,B]` changed for one bus (issue #17); each bus reads/pushes independently. */
  | { type: "aes50-chain-changed"; chain: Aes50Chain };

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
  /**
   * Live per-channel meter levels (architecture.md §4 "Meters"), an optional
   * capability deliberately kept off the `MixerEvent` union: it is far too
   * chatty (updates several times a second) to ride the same fan-out as
   * occasional routing/selection changes. `X32MixerClient` and
   * `MockMixerClient` both implement it; a `MixerClient` consumer that
   * doesn't care about meters (or is talking to some future implementation
   * that has none) can simply not call it — hence optional.
   *
   * `levels` is exactly 32 entries, one per input channel (1-based index 0 =
   * channel 1) — the console's raw linear meter floats, verbatim, no dB
   * conversion or smoothing applied by the adapter.
   */
  subscribeMeters?(listener: (levels: number[]) => void): Unsubscribe;
}
