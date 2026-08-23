/**
 * `X32MixerClient` integration tests, driven entirely through a fake
 * `UdpTransport` — no real socket, no real X32. Replies are delivered via
 * `queueMicrotask` (a real microtask, unaffected by fake timers), so the
 * ~103-read snapshot sequence resolves through ordinary promise chaining
 * without needing any timer advancement; fake timers are only engaged for
 * the scenarios that actually depend on a timeout or interval firing
 * (dropped replies, the liveness/reconnect loop).
 */

import type { MixerEvent } from "@x32/mixer-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OscArgument } from "./osc";
import { decodeOscMessage, encodeOscMessage } from "./osc";
import type { UdpTransport } from "./transport";
import { X32MixerClient } from "./x32MixerClient";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type AutoReply = (address: string) => OscArgument[] | undefined;

class FakeTransport implements UdpTransport {
  readonly sent: Array<{ address: string; args: OscArgument[] }> = [];
  closed = false;
  autoReply: AutoReply | null = null;
  #onMessage: ((buffer: Uint8Array) => void) | null = null;

  send(buffer: Uint8Array): void {
    const decoded = decodeOscMessage(buffer);
    this.sent.push({ address: decoded.address, args: decoded.args });

    const reply = this.autoReply?.(decoded.address);
    if (reply === undefined) return; // simulates a dropped/never-replying read

    queueMicrotask(() => {
      this.#onMessage?.(encodeOscMessage(decoded.address, reply));
    });
  }

  onMessage(callback: (buffer: Uint8Array) => void): void {
    this.#onMessage = callback;
  }

  close(): void {
    this.closed = true;
  }

  /** Test-only: simulate an unsolicited live push (or a direct reply). */
  push(address: string, args: OscArgument[] = []): void {
    this.#onMessage?.(encodeOscMessage(address, args));
  }
}

/**
 * The straight-through default: every channel N's `config/source` is N, and
 * all 4 IN blocks are AES50-A quarters (values 4-7), so CH n resolves to
 * AES50-A n for every n — easy to reason about and to override per-address
 * for individual scenarios.
 */
function defaultAutoReply(overrides: Record<string, OscArgument[] | undefined> = {}): AutoReply {
  return (address) => {
    if (address in overrides) return overrides[address];

    if (address === "/xinfo") {
      return [
        { type: "s", value: "192.168.1.10" },
        { type: "s", value: "X32" },
        { type: "s", value: "X32" },
        { type: "s", value: "4.06" },
      ];
    }
    if (address === "/config/routing/routswitch") return [{ type: "i", value: 0 }];
    if (address === "/config/routing/IN/1-8") return [{ type: "i", value: 4 }]; // A1-8
    if (address === "/config/routing/IN/9-16") return [{ type: "i", value: 5 }]; // A9-16
    if (address === "/config/routing/IN/17-24") return [{ type: "i", value: 6 }]; // A17-24
    if (address === "/config/routing/IN/25-32") return [{ type: "i", value: 7 }]; // A25-32
    if (address.startsWith("/config/userrout/in/")) return [{ type: "i", value: 0 }]; // off, unused by default
    if (address.startsWith("/ch/") && address.endsWith("/config/name")) {
      const channel = Number(address.slice(4, 6));
      return [{ type: "s", value: `CH${channel}` }];
    }
    if (address.startsWith("/ch/") && address.endsWith("/config/source")) {
      const channel = Number(address.slice(4, 6));
      return [{ type: "i", value: channel }];
    }
    if (address === "/-stat/selidx") return [{ type: "i", value: 40 }]; // FX return -> no channel selected
    return undefined;
  };
}

const EXPECTED_READ_SEQUENCE = [
  "/xinfo",
  "/config/routing/routswitch",
  "/config/routing/IN/1-8",
  "/config/routing/IN/9-16",
  "/config/routing/IN/17-24",
  "/config/routing/IN/25-32",
  ...Array.from({ length: 32 }, (_, i) => `/config/userrout/in/${pad2(i + 1)}`),
  ...Array.from({ length: 32 }, (_, i) => `/ch/${pad2(i + 1)}/config/name`),
  ...Array.from({ length: 32 }, (_, i) => `/ch/${pad2(i + 1)}/config/source`),
  "/-stat/selidx",
];

let client: X32MixerClient | null = null;

afterEach(async () => {
  await client?.disconnect();
  client = null;
  vi.useRealTimers();
});

describe("connect()", () => {
  it("issues the exact snapshot read sequence, all address-only, and builds a matching snapshot", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    expect(client.getConnectionState()).toBe("connected");

    const reads = transport.sent.slice(0, EXPECTED_READ_SEQUENCE.length);
    expect(reads.map((r) => r.address)).toEqual(EXPECTED_READ_SEQUENCE);
    expect(reads.every((r) => r.args.length === 0)).toBe(true); // reads only, never writes

    const snapshot = await client.getSnapshot();
    expect(snapshot.channels).toHaveLength(32);
    expect(snapshot.channels[0]).toEqual({
      channel: 1,
      name: "CH1",
      source: { kind: "aes50", bus: "A", channel: 1 },
    });
    expect(snapshot.channels[11]).toEqual({
      channel: 12,
      name: "CH12",
      source: { kind: "aes50", bus: "A", channel: 12 },
    });
    expect(snapshot.selectedChannel).toBeNull(); // selidx 40 -> FX return, no channel

    // /xremote renewal starts right after the snapshot completes.
    expect(transport.sent[EXPECTED_READ_SEQUENCE.length]).toEqual({
      address: "/xremote",
      args: [],
    });
  });

  it("resolves User In indirection during the initial snapshot too", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply({
      "/config/routing/IN/17-24": [{ type: "i", value: 22 }], // UIN17-24 (block value 22, not slot 20 — see docs/x32-protocol.md's IN block enum table)
      "/config/userrout/in/20": [{ type: "i", value: 55 }], // -> aes50 A23
    });
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const snapshot = await client.getSnapshot();
    // CH20's source value is 20 (default straight-through) -> slot 20 -> User In slot 20 -> A23.
    expect(snapshot.channels[19]).toEqual({
      channel: 20,
      name: "CH20",
      source: { kind: "aes50", bus: "A", channel: 23 },
    });
  });
});

describe("live pushes", () => {
  async function connectedClient(): Promise<{ transport: FakeTransport; events: MixerEvent[] }> {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });
    await client.connect();

    const events: MixerEvent[] = [];
    client.subscribe((event) => events.push(event));
    return { transport, events };
  }

  it("/-stat/selidx 11 -> selected-channel-changed CH12", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/selidx", [{ type: "i", value: 11 }]);

    expect(events).toEqual([{ type: "selected-channel-changed", channel: 12 }]);
    expect((await client!.getSnapshot()).selectedChannel).toBe(12);
  });

  it(">= 32 -> selected-channel-changed null", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/selidx", [{ type: "i", value: 48 }]);

    expect(events).toEqual([{ type: "selected-channel-changed", channel: null }]);
  });

  it("/ch/07/config/name -> channel-name-changed", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/ch/07/config/name", [{ type: "s", value: "Lead Vox" }]);

    expect(events).toEqual([{ type: "channel-name-changed", channel: 7, name: "Lead Vox" }]);
  });

  it("a source change affects exactly its own channel", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/ch/05/config/source", [{ type: "i", value: 0 }]); // -> off

    expect(events).toEqual([
      { type: "channel-source-changed", channel: 5, source: { kind: "off" } },
    ]);
  });

  it("an IN block change affects exactly the channels whose source falls in its range", async () => {
    const { transport, events } = await connectedClient();

    // Channels 1-8 (source values 1-8) all sit in the 1-8 block; nothing else does.
    transport.push("/config/routing/IN/1-8", [{ type: "i", value: 16 }]); // CARD1-8

    const sourceChanges = events.filter((e) => e.type === "channel-source-changed");
    expect(sourceChanges).toHaveLength(8);
    expect(sourceChanges.map((e) => e.channel)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [index, event] of sourceChanges.entries()) {
      expect(event.source).toEqual({ kind: "card", input: index + 1 });
    }

    const snapshot = await client!.getSnapshot();
    expect(snapshot.channels[0]?.source).toEqual({ kind: "card", input: 1 });
    expect(snapshot.channels[8]?.source).toEqual({ kind: "aes50", bus: "A", channel: 9 }); // CH9 untouched
  });

  it("a userrout change affects only channels currently routed through that slot", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply({
      "/config/routing/IN/17-24": [{ type: "i", value: 22 }], // UIN17-24 (block value 22, not slot 20 — see docs/x32-protocol.md's IN block enum table) for slots 17-24
      "/config/userrout/in/20": [{ type: "i", value: 55 }], // CH20 (slot 20) -> aes50 A23
    });
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });
    await client.connect();
    const events: MixerEvent[] = [];
    client.subscribe((event) => events.push(event));

    // CH21 (slot 21) routes through a *different* userrout slot (21), untouched by this.
    transport.push("/config/userrout/in/20", [{ type: "i", value: 129 }]); // -> card 1

    expect(events).toEqual([
      { type: "channel-source-changed", channel: 20, source: { kind: "card", input: 1 } },
    ]);
  });

  it("ignores an unknown address silently", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/config/routing/IN/AUX", [{ type: "i", value: 3 }]);
    transport.push("/-show/prepos/current", [{ type: "i", value: 1 }]);

    expect(events).toEqual([]);
  });

  it("logs a warning exactly once on the REC -> PLAY transition and keeps resolving IN blocks", async () => {
    const { transport } = await connectedClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    transport.push("/config/routing/routswitch", [{ type: "i", value: 1 }]);
    transport.push("/config/routing/routswitch", [{ type: "i", value: 1 }]); // repeat: no new warning

    const playbackWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("playback routing active"),
    );
    expect(playbackWarnings).toHaveLength(1);

    warn.mockRestore();
  });
});

describe("retry, disconnect detection, and resync", () => {
  it("retries a dropped read before giving up, and fails connect() into 'disconnected' when it never replies", async () => {
    const transport = new FakeTransport();
    transport.autoReply = () => undefined; // nothing ever replies
    client = new X32MixerClient(transport, { requestTimeoutMs: 10, maxRetries: 2 });

    vi.useFakeTimers();
    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(10 * 3 + 20); // 1 initial attempt + 2 retries
    await connectPromise;

    expect(client.getConnectionState()).toBe("disconnected");
    // 1 request should have been sent per attempt for the very first address (xinfo);
    // the sequence aborts there without moving on to later addresses.
    expect(transport.sent.filter((r) => r.address === "/xinfo")).toHaveLength(3);
    expect(transport.sent.some((r) => r.address === "/config/routing/routswitch")).toBe(false);
  });

  it("drops out on missed /xinfo liveness replies, then fully resyncs once replies resume", async () => {
    vi.useFakeTimers();

    const transport = new FakeTransport();
    const goodReplies = defaultAutoReply();
    transport.autoReply = goodReplies;
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 10,
      maxRetries: 1,
      xremoteRenewalMs: 1_000_000, // stays out of the way for this test
      livenessPollMs: 50,
    });

    const connectPromise = client.connect();
    // The initial snapshot resolves purely through microtask-delivered replies —
    // no timer needs to fire for it, but advancing a no-op amount is harmless.
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;
    expect(client.getConnectionState()).toBe("connected");

    const events: MixerEvent[] = [];
    client.subscribe((event) => events.push(event));

    // Stop answering /xinfo — the next liveness poll should detect this and
    // exhaust its retries (10ms timeout x 2 attempts) inside one poll tick.
    transport.autoReply = (address) => (address === "/xinfo" ? undefined : goodReplies(address));
    await vi.advanceTimersByTimeAsync(50 /* poll interval */ + 10 * 2 /* attempts */ + 20 /* slack */);

    expect(client.getConnectionState()).toBe("disconnected");
    expect(events).toContainEqual({ type: "connection-state-changed", state: "disconnected" });

    // Resume replying, with CH1's name changed — proof the next recovery is a
    // *full* resync (a fresh snapshot), not just a resumed liveness ping.
    transport.autoReply = defaultAutoReply({
      "/ch/01/config/name": [{ type: "s", value: "Recovered" }],
    });
    await vi.advanceTimersByTimeAsync(50 + 20);

    expect(client.getConnectionState()).toBe("connected");
    expect(events).toContainEqual({ type: "connection-state-changed", state: "connected" });

    const snapshot = await client.getSnapshot();
    expect(snapshot.channels[0]?.name).toBe("Recovered");
  });
});

describe("disconnect()", () => {
  it("stops the transport and leaves no pending timers", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();
    await client.disconnect();

    expect(transport.closed).toBe(true);
    expect(client.getConnectionState()).toBe("disconnected");

    client = null; // already disconnected — afterEach must not double-disconnect
  });
});
