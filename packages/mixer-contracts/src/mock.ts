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
  Aes50Bus,
  Aes50Chain,
  Aes50ChainBox,
  Aes50LinkState,
  MixerChannelId,
  MixerChannelState,
  MixerOutputSourceRef,
  MixerOutputState,
  MixerSourceRef,
} from "@x32/domain";
import { MIXER_CHANNEL_COUNT } from "@x32/domain";

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
 * Host globals both Node and browsers provide, but which the ES lib this
 * workspace compiles against does not declare. Declaring the exact signatures
 * used here keeps the package free of `@types/node` and of the DOM lib — it
 * must run unchanged in both.
 */
declare function queueMicrotask(callback: () => void): void;
declare function setInterval(callback: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;

/**
 * One `subscribe` call. A record per call rather than a bare listener so that
 * registering the same function twice yields two independent subscriptions.
 */
interface Subscription {
  listener: MixerEventListener;
}

interface MeterSubscription {
  listener: (levels: number[]) => void;
}

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

function cloneOutputs(outputs: MixerOutputState[] | undefined): MixerOutputState[] {
  return outputs === undefined ? [] : outputs.map(cloneOutput);
}

function cloneAes50LinkState(state: Aes50LinkState | null | undefined): Aes50LinkState | null {
  if (state === null || state === undefined) return null;
  return {
    buses: state.buses.map((bus) => ({ ...bus })),
    locked: state.locked,
  };
}

function cloneAes50Chain(chains: Aes50Chain[] | undefined): Aes50Chain[] {
  if (chains === undefined) return [];
  return chains.map((chain) => ({
    bus: chain.bus,
    boxes: chain.boxes.map((box) => ({ ...box })),
  }));
}

function cloneSnapshot(snapshot: MixerSnapshot): MixerSnapshot {
  return {
    channels: snapshot.channels.map(cloneChannel),
    outputs: cloneOutputs(snapshot.outputs),
    selectedChannel: snapshot.selectedChannel,
    aes50LinkState: cloneAes50LinkState(snapshot.aes50LinkState),
    aes50Chain: cloneAes50Chain(snapshot.aes50Chain),
  };
}

export class MockMixerClient implements MixerClient {
  #snapshot: MixerSnapshot;
  #connectionState: MixerConnectionState = "disconnected";
  readonly #subscriptions = new Set<Subscription>();
  readonly #meterSubscriptions = new Set<MeterSubscription>();
  /** Non-`null` only while `simulateMetersStart()` is running — the mock is otherwise timer-free by design. */
  #meterTimer: unknown = null;
  #meterTick = 0;

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

  /**
   * Meters deliberately don't ride `MixerEvent` (architecture.md §4) — the
   * real adapter's are far too chatty for that fan-out. This is the mock's
   * matching capability; `simulateMetersStart()`/`simulateMetersStop()`
   * below are what actually produce levels for it to deliver.
   */
  subscribeMeters(listener: (levels: number[]) => void): Unsubscribe {
    const subscription: MeterSubscription = { listener };
    this.#meterSubscriptions.add(subscription);
    return () => {
      this.#meterSubscriptions.delete(subscription);
    };
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
   * A console Out slot's *resolved* source changed (issue #11) — the output
   * mirror of `simulateSourceChange`. The real adapter would emit one of
   * these per affected slot; the mock produces the flat form directly.
   */
  simulateOutputSourceChange(output: number, source: MixerOutputSourceRef): void {
    this.#requireOutput(output).source = { ...source };
    this.#emit({
      type: "output-source-changed",
      output,
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

  /**
   * Simulates an AES50 audio/aux link error on one bus (issue #17's
   * headline scenario — a dead snake, indistinguishable from silence
   * without this). Only the given bus's error flags change; `locked` and
   * the other bus are left as-is. `active: false` clears it back to
   * healthy. Always emits, even with no change, matching the real
   * adapter's "every read/push re-applies" discipline — this is a dev
   * action, not a wire replay, so idempotence isn't expected of it.
   */
  simulateAes50LinkError(
    bus: Aes50Bus,
    options: { audioError?: boolean; auxError?: boolean } = { audioError: true },
  ): void {
    const current = this.#snapshot.aes50LinkState ?? {
      buses: [
        { bus: "A" as Aes50Bus, audioError: false, auxError: false },
        { bus: "B" as Aes50Bus, audioError: false, auxError: false },
      ],
      locked: false,
    };
    const state: Aes50LinkState = {
      locked: current.locked,
      buses: current.buses.map((busState) =>
        busState.bus === bus
          ? {
              bus,
              audioError: options.audioError ?? busState.audioError,
              auxError: options.auxError ?? busState.auxError,
            }
          : { ...busState },
      ),
    };
    this.#snapshot.aes50LinkState = state;
    this.#emit({
      type: "aes50-link-state-changed",
      state: { locked: state.locked, buses: state.buses.map((busState) => ({ ...busState })) },
    });
  }

  /** Replaces one bus's detected chain (issue #17) — dev-only, for exercising the chain-mismatch UI without a console. */
  simulateAes50ChainChange(bus: Aes50Bus, boxes: Aes50ChainBox[]): void {
    const chain: Aes50Chain = { bus, boxes: boxes.map((box) => ({ ...box })) };
    const rest = (this.#snapshot.aes50Chain ?? []).filter((entry) => entry.bus !== bus);
    this.#snapshot.aes50Chain = [...rest, chain];
    this.#emit({
      type: "aes50-chain-changed",
      chain: { bus: chain.bus, boxes: chain.boxes.map((box) => ({ ...box })) },
    });
  }

  /**
   * Starts a dev-only level generator on a ~250ms interval (docs/plan.md
   * step 15) — plausible, smoothly moving levels for every channel whose
   * source isn't `off`, zero for the ones that are. This is the *only* timer
   * the mock ever runs, and only between this call and `simulateMetersStop()`
   * (or never, if the control surface's "Meters" toggle is never flipped) —
   * everything else about `MockMixerClient` stays timer-free.
   */
  simulateMetersStart(intervalMs = 250): void {
    if (this.#meterTimer !== null) return;
    this.#meterTimer = setInterval(() => {
      this.#meterTick += 1;
      this.#emitMeterLevels(this.#generateLevels());
    }, intervalMs);
  }

  simulateMetersStop(): void {
    if (this.#meterTimer === null) return;
    clearInterval(this.#meterTimer);
    this.#meterTimer = null;
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

  #requireOutput(output: number): MixerOutputState {
    const state = (this.#snapshot.outputs ?? []).find(
      (candidate) => candidate.output === output,
    );
    if (state === undefined) {
      throw new Error(
        `Unknown mixer output ${output}: this mock's snapshot has no such output.`,
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

  /**
   * One synthetic level per input channel: a slow per-channel sine (so
   * channels don't all pulse in lockstep) plus a little noise, clamped to
   * `[0, 1]`. There is no real audio behind this — it only has to read as
   * "alive" on the strip meters. A channel currently `off` always reads 0,
   * matching what a real desk's meter for a disconnected input shows.
   *
   * These are **linear amplitude**, the same units the console reports
   * (docs/x32-protocol.md §Meters, measured against fw 4.06: peak = 1.0,
   * a live mic in a quiet room ≈ 0.001–0.004). Real programme material
   * therefore sits far lower than intuition suggests: speech averages
   * roughly -30dBFS (~0.03) and peaks around -12dBFS (~0.25). The range
   * below is deliberately in that band so mock mode looks like the desk
   * does under the dB display curve — an earlier 0.05–0.65 range was tuned
   * for a since-corrected `sqrt` curve and made every channel read hot.
   */
  #generateLevels(): number[] {
    const levels: number[] = [];
    for (let channelNumber = 1; channelNumber <= MIXER_CHANNEL_COUNT; channelNumber += 1) {
      const state = this.#snapshot.channels.find((c) => c.channel === channelNumber);
      if (state === undefined || state.source.kind === "off") {
        levels.push(0);
        continue;
      }
      const phase = channelNumber * 0.7;
      // ~0.012 … ~0.16 linear (≈ -38dBFS … -16dBFS), with occasional
      // higher excursions from the noise term, as programme material does.
      const wave = 0.085 + 0.075 * Math.sin(this.#meterTick / 6 + phase);
      const noise = (Math.random() - 0.5) * 0.05;
      levels.push(Math.min(1, Math.max(0, wave + noise)));
    }
    return levels;
  }

  #emitMeterLevels(levels: number[]): void {
    for (const subscription of [...this.#meterSubscriptions]) {
      try {
        subscription.listener(levels);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
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
