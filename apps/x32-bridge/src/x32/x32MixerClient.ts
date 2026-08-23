/**
 * `X32MixerClient` (docs/x32-protocol.md §Initial snapshot, §Subscribing;
 * architecture.md §4). The only `MixerClient` implementation that talks to a
 * real console — everything OSC/UDP-shaped lives in this module and its
 * siblings in `src/x32/`, per CLAUDE.md invariant 3.
 *
 * `connect()`:
 *   1. "connecting"
 *   2. runs the full snapshot read sequence (§Initial snapshot, in order):
 *      xinfo, routswitch, the 4 IN blocks, userrout 1–32, then name+source
 *      for channels 1–32, then selidx — each an address-only read with its
 *      own timeout + limited retries (UDP is lossy).
 *   3. "connected" on success, "disconnected" on failure — either way
 *      `connect()` resolves; it never hangs waiting for a console that may
 *      never answer, because `apps/x32-bridge/src/server/bridgeServer.ts`
 *      awaits it before doing anything else and must still be able to serve
 *      a (disconnected, last-known) snapshot per architecture.md §7.
 *   4. starts the `/xremote` renewal loop (~8s) and the `/xinfo` liveness
 *      poll (~5s) either way.
 *
 * The liveness poll doubles as the reconnect path: while connected it's a
 * single lightweight `/xinfo` read; a missed reply flips the client to
 * "disconnected". While disconnected, each tick instead re-runs the *full*
 * snapshot sequence (§Subscribing: "perform a full resync on reconnect"); on
 * success the client flips back to "connected", which is what
 * `bridgeServer.ts` treats as "re-read and broadcast a fresh snapshot".
 *
 * Every incoming datagram — a reply to one of our reads or an unsolicited
 * live push — goes through the same decode-and-apply path
 * (`#handleIncoming` → `#applyMessage`), per docs/x32-protocol.md's framing:
 * one decoder for both. Events are only emitted for that path once the
 * client is not in the middle of building a snapshot (`#suppressEvents`) —
 * building a snapshot must not look like ~100 live changes to consumers.
 */

import { mixerChannelId, MIXER_CHANNEL_COUNT } from "@x32/domain";
import type {
  MixerClient,
  MixerConnectionState,
  MixerEvent,
  MixerEventListener,
  MixerSnapshot,
  Unsubscribe,
} from "@x32/mixer-contracts";

import {
  channelNameAddress,
  channelSourceAddress,
  inBlockAddress,
  parseAddress,
  routswitchAddress,
  selidxAddress,
  userRoutAddress,
  xinfoAddress,
  xremoteAddress,
} from "./addresses";
import type { OscArgument, OscMessage } from "./osc";
import { decodeOscMessage, encodeOscMessage } from "./osc";
import { X32State } from "./resolve";
import type { UdpTransport } from "./transport";

export interface X32MixerClientOptions {
  /** Per-request read timeout. Not specified numerically by the doc — chosen for LAN latency plus UDP's occasional loss. Default 300ms. */
  requestTimeoutMs?: number;
  /** Retries per read after the first attempt. Default 3. */
  maxRetries?: number;
  /** `/xremote` renewal interval; the console's subscription lasts 10s. Default 8000ms, per the doc. */
  xremoteRenewalMs?: number;
  /** `/xinfo` liveness poll interval. Default 5000ms, per the doc. */
  livenessPollMs?: number;
}

const DEFAULTS = {
  requestTimeoutMs: 300,
  maxRetries: 3,
  xremoteRenewalMs: 8000,
  livenessPollMs: 5000,
} as const satisfies Required<X32MixerClientOptions>;

interface Subscription {
  listener: MixerEventListener;
}

interface PendingRead {
  address: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstInt(args: OscArgument[]): number | undefined {
  const arg = args[0];
  return arg?.type === "i" ? arg.value : undefined;
}

function firstString(args: OscArgument[]): string | undefined {
  const arg = args[0];
  return arg?.type === "s" ? arg.value : undefined;
}

export class X32MixerClient implements MixerClient {
  readonly #transport: UdpTransport;
  readonly #requestTimeoutMs: number;
  readonly #maxRetries: number;
  readonly #xremoteRenewalMs: number;
  readonly #livenessPollMs: number;

  readonly #state = new X32State();
  readonly #subscriptions = new Set<Subscription>();

  #connectionState: MixerConnectionState = "disconnected";
  #closed = false;
  #suppressEvents = false;
  #pollInFlight = false;
  #pendingRead: PendingRead | null = null;
  #xremoteTimer: ReturnType<typeof setInterval> | null = null;
  #livenessTimer: ReturnType<typeof setInterval> | null = null;

  constructor(transport: UdpTransport, options: X32MixerClientOptions = {}) {
    this.#transport = transport;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.#maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.#xremoteRenewalMs = options.xremoteRenewalMs ?? DEFAULTS.xremoteRenewalMs;
    this.#livenessPollMs = options.livenessPollMs ?? DEFAULTS.livenessPollMs;
    this.#transport.onMessage((buffer) => {
      this.#handleIncoming(buffer);
    });
  }

  // --- MixerClient ---------------------------------------------------------

  async connect(): Promise<void> {
    if (this.#closed || this.#connectionState !== "disconnected") return;

    this.#setConnectionState("connecting");
    const success = await this.#attemptFullSnapshot();
    this.#setConnectionState(success ? "connected" : "disconnected");

    this.#startXremoteRenewal();
    this.#startLivenessPoll();
  }

  async disconnect(): Promise<void> {
    this.#closed = true;
    this.#stopTimers();
    this.#rejectPendingRead(new Error("X32MixerClient disconnected"));
    this.#setConnectionState("disconnected");
    this.#transport.close();
  }

  async getSnapshot(): Promise<MixerSnapshot> {
    return this.#state.toSnapshot();
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

  // --- snapshot sequence -----------------------------------------------------

  /** docs/x32-protocol.md §Initial snapshot, in order — ~103 address-only reads. */
  #snapshotReadSequence(): string[] {
    const addresses: string[] = [xinfoAddress(), routswitchAddress()];
    for (let block = 0; block < 4; block += 1) {
      addresses.push(inBlockAddress(block as 0 | 1 | 2 | 3));
    }
    for (let slot = 1; slot <= MIXER_CHANNEL_COUNT; slot += 1) {
      addresses.push(userRoutAddress(slot));
    }
    for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
      addresses.push(channelNameAddress(channel));
    }
    for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
      addresses.push(channelSourceAddress(channel));
    }
    addresses.push(selidxAddress());
    return addresses;
  }

  /**
   * Runs the full sequence, applying every reply to `#state` as it arrives
   * (via `#handleIncoming`, the same path live pushes use) but without
   * emitting events (`#suppressEvents`) — building a snapshot is not ~100
   * incremental changes. Returns `false` (without throwing) the moment any
   * one read exhausts its retries; whatever was already applied stays,
   * harmless, and the next full resync attempt supersedes it.
   */
  async #attemptFullSnapshot(): Promise<boolean> {
    this.#suppressEvents = true;
    try {
      for (const address of this.#snapshotReadSequence()) {
        const ok = await this.#readWithRetry(address);
        if (!ok) return false;
      }
      return true;
    } finally {
      this.#suppressEvents = false;
    }
  }

  async #readWithRetry(address: string): Promise<boolean> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        await this.#readOnce(address);
        return true;
      } catch {
        // timed out (or the client was disconnected mid-flight); retry, or
        // give up once `#maxRetries` extra attempts are exhausted.
      }
    }
    return false;
  }

  /**
   * One address-only read attempt. There is only ever one pending read at a
   * time by construction — every read in this module is `await`ed before the
   * next is sent — so a single `#pendingRead` slot (rather than a queue) is
   * enough to match a reply to its request.
   */
  #readOnce(address: string): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("X32MixerClient is disconnected"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pendingRead?.address === address) this.#pendingRead = null;
        reject(
          new Error(`X32 read timed out: no reply to ${address} within ${this.#requestTimeoutMs}ms`),
        );
      }, this.#requestTimeoutMs);

      this.#pendingRead = {
        address,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.#transport.send(encodeOscMessage(address, []));
    });
  }

  #rejectPendingRead(error: Error): void {
    const pending = this.#pendingRead;
    if (pending === null) return;
    this.#pendingRead = null;
    pending.reject(error);
  }

  // --- incoming messages -----------------------------------------------------

  #handleIncoming(buffer: Uint8Array): void {
    let decoded: OscMessage;
    try {
      decoded = decodeOscMessage(buffer);
    } catch (error) {
      console.warn(`x32-bridge: ignoring malformed OSC datagram: ${errorMessage(error)}`);
      return;
    }

    if (this.#pendingRead !== null && this.#pendingRead.address === decoded.address) {
      const pending = this.#pendingRead;
      this.#pendingRead = null;
      pending.resolve();
    }

    this.#applyMessage(decoded.address, decoded.args);
  }

  #applyMessage(address: string, args: OscArgument[]): void {
    const parsed = parseAddress(address);

    switch (parsed.kind) {
      case "xinfo":
        return; // liveness confirmation only — nothing tracked to store.

      case "routswitch": {
        const value = firstInt(args);
        if (value === undefined) return;
        const enteredPlayback = this.#state.setRoutSwitch(value);
        if (enteredPlayback) {
          console.warn(
            "x32-bridge: playback routing active (routswitch = PLAY) — routing " +
              "display reflects REC/IN blocks, per docs/x32-protocol.md's documented MVP limitation.",
          );
        }
        return;
      }

      case "in-block": {
        const value = firstInt(args);
        if (value === undefined) return;
        this.#state.setInBlock(parsed.blockIndex, value);
        if (this.#suppressEvents) return;
        for (const channel of this.#state.channelsAffectedByInBlockChange(parsed.blockIndex)) {
          this.#emitChannelSourceChanged(channel);
        }
        return;
      }

      case "user-rout": {
        const value = firstInt(args);
        if (value === undefined) return;
        this.#state.setUserRoutIn(parsed.slot, value);
        if (this.#suppressEvents) return;
        for (const channel of this.#state.channelsAffectedByUserRoutChange(parsed.slot)) {
          this.#emitChannelSourceChanged(channel);
        }
        return;
      }

      case "channel-name": {
        const value = firstString(args);
        if (value === undefined) return;
        this.#state.setChannelName(parsed.channel, value);
        if (this.#suppressEvents) return;
        this.#emit({
          type: "channel-name-changed",
          channel: mixerChannelId(parsed.channel),
          name: value,
        });
        return;
      }

      case "channel-source": {
        const value = firstInt(args);
        if (value === undefined) return;
        this.#state.setChannelSource(parsed.channel, value);
        if (this.#suppressEvents) return;
        this.#emitChannelSourceChanged(parsed.channel);
        return;
      }

      case "selidx": {
        const value = firstInt(args);
        if (value === undefined) return;
        this.#state.setSelIdx(value);
        if (this.#suppressEvents) return;
        this.#emit({
          type: "selected-channel-changed",
          channel: this.#state.selectedChannel(),
        });
        return;
      }

      case "unknown":
        return; // ignored silently, per docs/x32-protocol.md.
    }
  }

  #emitChannelSourceChanged(channel: number): void {
    this.#emit({
      type: "channel-source-changed",
      channel: mixerChannelId(channel),
      source: this.#state.resolveChannel(channel),
    });
  }

  // --- background loops -----------------------------------------------------

  #startXremoteRenewal(): void {
    if (this.#xremoteTimer !== null) return;
    const renew = (): void => {
      this.#transport.send(encodeOscMessage(xremoteAddress(), []));
    };
    renew(); // the console's subscription lasts 10s — renew immediately, then on the interval.
    this.#xremoteTimer = setInterval(renew, this.#xremoteRenewalMs);
  }

  #startLivenessPoll(): void {
    if (this.#livenessTimer !== null) return;
    this.#livenessTimer = setInterval(() => {
      void this.#pollTick();
    }, this.#livenessPollMs);
  }

  /**
   * While connected: a single `/xinfo` read is the liveness check — a missed
   * reply (after its own retries) marks the client disconnected. While
   * disconnected: re-run the full snapshot sequence; success is the "full
   * resync on reconnect" the doc calls for, surfaced to `bridgeServer.ts` as
   * a "connected" transition it re-reads a fresh snapshot on.
   */
  async #pollTick(): Promise<void> {
    if (this.#pollInFlight || this.#closed) return;
    this.#pollInFlight = true;
    try {
      if (this.#connectionState === "connected") {
        const ok = await this.#readWithRetry(xinfoAddress());
        if (!ok) this.#setConnectionState("disconnected");
      } else if (this.#connectionState === "disconnected") {
        const ok = await this.#attemptFullSnapshot();
        if (ok) this.#setConnectionState("connected");
      }
    } finally {
      this.#pollInFlight = false;
    }
  }

  #stopTimers(): void {
    if (this.#xremoteTimer !== null) {
      clearInterval(this.#xremoteTimer);
      this.#xremoteTimer = null;
    }
    if (this.#livenessTimer !== null) {
      clearInterval(this.#livenessTimer);
      this.#livenessTimer = null;
    }
  }

  // --- internals ---------------------------------------------------------

  #setConnectionState(state: MixerConnectionState): void {
    if (this.#connectionState === state) return;
    this.#connectionState = state;
    this.#emit({ type: "connection-state-changed", state });
  }

  /**
   * Isolates listeners from each other (one throwing must not starve the
   * rest) and rethrows on a fresh microtask so the failure still reaches
   * Node's `uncaughtException` reporting with its stack intact — same
   * discipline as `MockMixerClient`'s `#emit`.
   */
  #emit(event: MixerEvent): void {
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
