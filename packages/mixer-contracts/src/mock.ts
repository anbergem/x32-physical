/**
 * `MockMixerClient` (architecture.md §4).
 *
 * Pure TS: runs unchanged in Node and in the browser (no `node:` imports, no
 * timers, no globals beyond the language). Mock-first development (CLAUDE.md
 * invariant 4) means the whole UX is driven from here, so the mock emits
 * exactly the events the real adapter emits — consumers cannot tell them apart.
 *
 * The `simulate*` methods are the mock's own, wider surface: they are the only
 * mutation path in the codebase and are dev-only. `MixerClient` itself stays
 * read-only.
 */

import type {
  MixerChannelId,
  MixerChannelState,
  MixerSourceRef,
} from "@x32/domain";

import type {
  MixerClient,
  MixerConnectionState,
  MixerEvent,
  MixerEventListener,
  MixerSnapshot,
  Unsubscribe,
} from "./client";
import { createDefaultMockSnapshot } from "./default-snapshot";

/**
 * A host global both Node and browsers provide, but which the ES lib this
 * workspace compiles against does not declare. Declaring the one signature used
 * here keeps the package free of `@types/node` and of the DOM lib — it must run
 * unchanged in both.
 */
declare function queueMicrotask(callback: () => void): void;

/**
 * One `subscribe` call. A record per call rather than a bare listener so that
 * registering the same function twice yields two independent subscriptions.
 */
interface Subscription {
  listener: MixerEventListener;
}

function cloneChannel(channel: MixerChannelState): MixerChannelState {
  return {
    channel: channel.channel,
    name: channel.name,
    source: { ...channel.source },
  };
}

function cloneSnapshot(snapshot: MixerSnapshot): MixerSnapshot {
  return {
    channels: snapshot.channels.map(cloneChannel),
    selectedChannel: snapshot.selectedChannel,
  };
}

export class MockMixerClient implements MixerClient {
  #snapshot: MixerSnapshot;
  #connectionState: MixerConnectionState = "disconnected";
  readonly #subscriptions = new Set<Subscription>();

  /**
   * The snapshot is copied, so the caller's object is never aliased by the
   * mock (and vice versa). Defaults to the realistic venue snapshot.
   */
  constructor(snapshot: MixerSnapshot = createDefaultMockSnapshot()) {
    this.#snapshot = cloneSnapshot(snapshot);
  }

  // --- MixerClient -------------------------------------------------------

  async connect(): Promise<void> {
    this.#setConnectionState("connected");
  }

  async disconnect(): Promise<void> {
    this.#setConnectionState("disconnected");
  }

  /** A defensive copy: mutating the result never reaches the mock's state. */
  async getSnapshot(): Promise<MixerSnapshot> {
    return cloneSnapshot(this.#snapshot);
  }

  subscribe(listener: MixerEventListener): Unsubscribe {
    const subscription: Subscription = { listener };
    this.#subscriptions.add(subscription);

    return () => {
      this.#subscriptions.delete(subscription);
    };
  }

  getConnectionState(): MixerConnectionState {
    return this.#connectionState;
  }

  // --- Simulation API (dev-only) -----------------------------------------

  /** The operator pressed SELECT on the console — or deselected. */
  simulateSelect(channel: MixerChannelId | null): void {
    if (channel !== null) this.#requireChannel(channel);

    this.#snapshot.selectedChannel = channel;
    this.#emit({ type: "selected-channel-changed", channel });
  }

  simulateRename(channel: MixerChannelId, name: string): void {
    this.#requireChannel(channel).name = name;
    this.#emit({ type: "channel-name-changed", channel, name });
  }

  /**
   * A channel's *resolved* source changed. The real adapter emits one of these
   * per affected channel when an input block or User In mapping changes; the
   * mock produces the flat form directly.
   */
  simulateSourceChange(channel: MixerChannelId, source: MixerSourceRef): void {
    this.#requireChannel(channel).source = { ...source };
    this.#emit({
      type: "channel-source-changed",
      channel,
      source: { ...source },
    });
  }

  /**
   * A connection attempt is in flight. The real adapter reports this while it
   * is reaching for the console; the mock exposes it so the connection-status
   * UI has no branch that mock mode cannot reach.
   */
  simulateConnecting(): void {
    this.#setConnectionState("connecting");
  }

  /** The console dropped off the network. The snapshot is kept as-is. */
  simulateConnectionLoss(): void {
    this.#setConnectionState("disconnected");
  }

  simulateReconnect(): void {
    this.#setConnectionState("connected");
  }

  // --- internals ----------------------------------------------------------

  #requireChannel(channel: MixerChannelId): MixerChannelState {
    const state = this.#snapshot.channels.find(
      (candidate) => candidate.channel === channel,
    );
    if (state === undefined) {
      throw new Error(
        `Unknown mixer channel ${channel}: this mock's snapshot has no such channel.`,
      );
    }
    return state;
  }

  /** Connection transitions are idempotent: no change, no event. */
  #setConnectionState(state: MixerConnectionState): void {
    if (this.#connectionState === state) return;

    this.#connectionState = state;
    this.#emit({ type: "connection-state-changed", state });
  }

  #emit(event: MixerEvent): void {
    // Iterate a copy so subscribing/unsubscribing from inside a listener is
    // safe, and isolate listeners from each other: one that throws is the
    // consumer's bug and must not starve the rest of the fan-out.
    //
    // The failure is rethrown on a fresh microtask rather than swallowed, so it
    // still reaches the host's unhandled-error reporting (window.onerror,
    // Node's uncaughtException) with its stack intact. A silently eaten
    // exception from a store or React listener is exactly the bug that is
    // hardest to find later. The mock has no logger by design — it must run in
    // Node and the browser alike.
    for (const subscription of [...this.#subscriptions]) {
      try {
        subscription.listener(event);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
