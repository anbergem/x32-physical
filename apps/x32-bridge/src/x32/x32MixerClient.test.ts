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

import { metersReplyAddress, metersSubscribeAddress, outRoutingBlockAddress, outputMainSourceAddress } from "./addresses";
import type { OscArgument } from "./osc";
import { decodeOscMessage, encodeOscMessage } from "./osc";
import type { UdpTransport } from "./transport";
import { DEFAULTS, X32MixerClient } from "./x32MixerClient";

/** Builds a `/meters/1`-shaped blob: int32 LE float count, then LE floats. */
function meterBlob(values: number[]): Buffer {
  const buffer = Buffer.alloc(4 + values.length * 4);
  buffer.writeInt32LE(values.length, 0);
  values.forEach((value, index) => buffer.writeFloatLE(value, 4 + index * 4));
  return buffer;
}

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
    if (address.startsWith("/outputs/main/") && address.endsWith("/src")) return [{ type: "i", value: 0 }]; // off, unused by default
    if (address.startsWith("/config/routing/OUT/")) return [{ type: "i", value: 0 }]; // gather-only, value irrelevant
    if (address === "/-stat/selidx") return [{ type: "i", value: 40 }]; // FX return -> no channel selected
    if (address === "/-stat/aes50/A") return [{ type: "s", value: "AA00000000" }]; // 2 x S16
    if (address === "/-stat/aes50/B") return [{ type: "s", value: "" }]; // unused
    if (address === "/-stat/aes50/state") return [{ type: "i", value: 0 }]; // all clear
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
  ...Array.from({ length: 16 }, (_, i) => `/outputs/main/${pad2(i + 1)}/src`),
  "/config/routing/OUT/1-4",
  "/config/routing/OUT/5-8",
  "/config/routing/OUT/9-12",
  "/config/routing/OUT/13-16",
  "/-stat/selidx",
  "/-stat/aes50/A",
  "/-stat/aes50/B",
  "/-stat/aes50/state",
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

    // 16 output reads, all defaulting to 0 (off) — see defaultAutoReply.
    expect(snapshot.outputs).toHaveLength(16);
    expect(snapshot.outputs?.[0]).toEqual({ output: 1, source: { kind: "off" } });
    expect(snapshot.outputs?.[15]).toEqual({ output: 16, source: { kind: "off" } });

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

async function connectedClient(): Promise<{ transport: FakeTransport; events: MixerEvent[] }> {
  const transport = new FakeTransport();
  transport.autoReply = defaultAutoReply();
  client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });
  await client.connect();

  const events: MixerEvent[] = [];
  client.subscribe((event) => events.push(event));
  return { transport, events };
}

describe("live pushes", () => {
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

  it("re-sending an unchanged IN block value emits zero events (a scene recall echoing the current routing)", async () => {
    const { transport, events } = await connectedClient();

    // Same value the default snapshot already has for this block (A1-8 = 4).
    transport.push("/config/routing/IN/1-8", [{ type: "i", value: 4 }]);

    expect(events).toEqual([]);
  });

  it("re-sending an unchanged channel source value emits zero events", async () => {
    const { transport, events } = await connectedClient();

    // CH5's default source value is already 5.
    transport.push("/ch/05/config/source", [{ type: "i", value: 5 }]);

    expect(events).toEqual([]);
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

  it("re-sending an unchanged userrout value emits zero events", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply({
      "/config/routing/IN/17-24": [{ type: "i", value: 22 }], // UIN17-24
      "/config/userrout/in/20": [{ type: "i", value: 55 }], // CH20 -> aes50 A23
    });
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });
    await client.connect();
    const events: MixerEvent[] = [];
    client.subscribe((event) => events.push(event));

    transport.push("/config/userrout/in/20", [{ type: "i", value: 55 }]); // same value

    expect(events).toEqual([]);
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

describe("output routing (issue #10)", () => {
  it("snapshot reads populate the venue's expected output sources", async () => {
    const transport = new FakeTransport();
    // Out 13 <- Bus 1 (4), Out 15 <- Main L (1), Out 16 <- Main R (2),
    // Out 14 <- M/C (3), Out 1 <- Matrix 1 (20) — docs/installation.md's venue facts.
    transport.autoReply = defaultAutoReply({
      [outputMainSourceAddress(13)]: [{ type: "i", value: 4 }],
      [outputMainSourceAddress(15)]: [{ type: "i", value: 1 }],
      [outputMainSourceAddress(16)]: [{ type: "i", value: 2 }],
      [outputMainSourceAddress(14)]: [{ type: "i", value: 3 }],
      [outputMainSourceAddress(1)]: [{ type: "i", value: 20 }],
    });
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const snapshot = await client.getSnapshot();
    expect(snapshot.outputs?.[12]).toEqual({ output: 13, source: { kind: "bus", bus: 1 } });
    expect(snapshot.outputs?.[14]).toEqual({ output: 15, source: { kind: "main", side: "L" } });
    expect(snapshot.outputs?.[15]).toEqual({ output: 16, source: { kind: "main", side: "R" } });
    expect(snapshot.outputs?.[13]).toEqual({ output: 14, source: { kind: "main", side: "C" } });
    expect(snapshot.outputs?.[0]).toEqual({ output: 1, source: { kind: "matrix", matrix: 1 } });
  });

  it("a pushed output source change affects exactly its own output", async () => {
    const { transport, events } = await connectedClient();

    transport.push(outputMainSourceAddress(13), [{ type: "i", value: 4 }]); // -> Bus 1

    expect(events).toEqual([
      { type: "output-source-changed", output: 13, source: { kind: "bus", bus: 1 } },
    ]);
    expect((await client!.getSnapshot()).outputs?.[12]).toEqual({
      output: 13,
      source: { kind: "bus", bus: 1 },
    });
  });

  it("re-sending an unchanged output source value emits zero events", async () => {
    const { transport, events } = await connectedClient();

    // Every output defaults to 0 (off) in defaultAutoReply.
    transport.push(outputMainSourceAddress(5), [{ type: "i", value: 0 }]);

    expect(events).toEqual([]);
  });

  it("degrades an out-of-range pushed value to off, with a warning, and still emits the change", async () => {
    const { transport, events } = await connectedClient();

    // Move output 2 off its default "off" first, so the invalid value below
    // actually changes the resolved source rather than being suppressed as
    // a no-op (off -> off).
    transport.push(outputMainSourceAddress(2), [{ type: "i", value: 4 }]); // -> Bus 1
    events.length = 0;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      transport.push(outputMainSourceAddress(2), [{ type: "i", value: 999 }]);

      expect(events).toEqual([{ type: "output-source-changed", output: 2, source: { kind: "off" } }]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("reads and logs /config/routing/OUT/* at snapshot time without it affecting resolved output state", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply({
      [outRoutingBlockAddress(0)]: [{ type: "i", value: 7 }], // some non-zero raw value
      [outputMainSourceAddress(1)]: [{ type: "i", value: 1 }], // Main L, independent of the block above
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const outRoutingLogs = log.mock.calls.filter(([message]) =>
      String(message).includes("/config/routing/OUT/*"),
    );
    expect(outRoutingLogs).toHaveLength(4); // one per block, logged once each

    const snapshot = await client.getSnapshot();
    expect(snapshot.outputs?.[0]).toEqual({ output: 1, source: { kind: "main", side: "L" } });

    log.mockRestore();
  });
});

describe("AES50 link state + chain (issue #17)", () => {
  it("both addresses appear in the snapshot read sequence", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const addresses = transport.sent.map((r) => r.address);
    expect(addresses).toContain("/-stat/aes50/A");
    expect(addresses).toContain("/-stat/aes50/B");
    expect(addresses).toContain("/-stat/aes50/state");

    const snapshot = await client.getSnapshot();
    expect(snapshot.aes50LinkState).toEqual({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });
    expect(snapshot.aes50Chain).toEqual([
      {
        bus: "A",
        boxes: [
          { position: 1, model: "S16", rawLetter: "A" },
          { position: 2, model: "S16", rawLetter: "A" },
        ],
      },
      { bus: "B", boxes: [] },
    ]);
  });

  it("/-stat/aes50/state bitfield: bit 0 -> A audio error only", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/aes50/state", [{ type: "i", value: 0b00001 }]);

    expect(events).toEqual([
      {
        type: "aes50-link-state-changed",
        state: {
          buses: [
            { bus: "A", audioError: true, auxError: false },
            { bus: "B", audioError: false, auxError: false },
          ],
          locked: false,
        },
      },
    ]);
  });

  it("/-stat/aes50/state bitfield: bit 1 -> B audio error only", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/aes50/state", [{ type: "i", value: 0b00010 }]);

    expect(events).toEqual([
      {
        type: "aes50-link-state-changed",
        state: {
          buses: [
            { bus: "A", audioError: false, auxError: false },
            { bus: "B", audioError: true, auxError: false },
          ],
          locked: false,
        },
      },
    ]);
  });

  it("/-stat/aes50/state bitfield: bits 0+2 -> A audio + A aux error", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/aes50/state", [{ type: "i", value: 0b00101 }]);

    expect(events).toEqual([
      {
        type: "aes50-link-state-changed",
        state: {
          buses: [
            { bus: "A", audioError: true, auxError: true },
            { bus: "B", audioError: false, auxError: false },
          ],
          locked: false,
        },
      },
    ]);
  });

  it("/-stat/aes50/state bitfield: bit 4 -> locked", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/aes50/state", [{ type: "i", value: 0b10000 }]);

    expect(events).toEqual([
      {
        type: "aes50-link-state-changed",
        state: {
          buses: [
            { bus: "A", audioError: false, auxError: false },
            { bus: "B", audioError: false, auxError: false },
          ],
          locked: true,
        },
      },
    ]);
  });

  it("an out-of-range/negative /-stat/aes50/state value is ignored with one warning, no event", async () => {
    const { transport, events } = await connectedClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    transport.push("/-stat/aes50/state", [{ type: "i", value: -1 }]);

    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("re-pushing the same /-stat/aes50/state value emits zero events", async () => {
    const { transport, events } = await connectedClient();

    // The default snapshot's state is already 0 (all clear).
    transport.push("/-stat/aes50/state", [{ type: "i", value: 0 }]);

    expect(events).toEqual([]);
  });

  it("a chain string change on either bus emits aes50-chain-changed exactly once", async () => {
    const { transport, events } = await connectedClient();

    transport.push("/-stat/aes50/A", [{ type: "s", value: "AW00000000" }]); // box 2 replaced by an S32

    expect(events).toEqual([
      {
        type: "aes50-chain-changed",
        chain: {
          bus: "A",
          boxes: [
            { position: 1, model: "S16", rawLetter: "A" },
            { position: 2, model: "S32", rawLetter: "W" },
          ],
        },
      },
    ]);
  });

  it("re-pushing the same chain string emits zero events", async () => {
    const { transport, events } = await connectedClient();

    // The default snapshot's AES50-A chain string is already "AA00000000".
    transport.push("/-stat/aes50/A", [{ type: "s", value: "AA00000000" }]);

    expect(events).toEqual([]);
  });

  it("logs the raw chain string once at snapshot time", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const rawLogs = log.mock.calls.filter(([message]) => String(message).includes("/-stat/aes50/"));
    expect(rawLogs).toHaveLength(2); // one per bus (A, B)
    log.mockRestore();
  });
});

describe("meters (plan step 15)", () => {
  it("subscribes /meters ,siii \"/meters/1\" 0 0 <time_factor> on the same tick as the initial /xremote renewal", async () => {
    // time_factor is the 4th argument (docs/x32-protocol.md §Meters, #13):
    // the console silently ignores it as the 2nd (`,si`) and falls back to
    // its 50ms default, 5x the intended traffic.
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();

    const afterSnapshot = transport.sent.slice(EXPECTED_READ_SEQUENCE.length);
    expect(afterSnapshot[0]).toEqual({ address: "/xremote", args: [] });
    expect(afterSnapshot[1]).toEqual({
      address: metersSubscribeAddress(),
      args: [
        { type: "s", value: metersReplyAddress() },
        { type: "i", value: 0 },
        { type: "i", value: 0 },
        { type: "i", value: DEFAULTS.meterTimeFactor },
      ],
    });
  });

  it("renews /meters with the same ,siii form as the initial subscribe", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();
    await vi.advanceTimersByTimeAsync(8000); // one renewal tick (default xremoteRenewalMs)

    const metersRequests = transport.sent.filter(
      (r) => r.address === metersSubscribeAddress(),
    );
    expect(metersRequests.length).toBeGreaterThanOrEqual(2); // initial + at least one renewal
    for (const request of metersRequests) {
      expect(request.args).toEqual([
        { type: "s", value: metersReplyAddress() },
        { type: "i", value: 0 },
        { type: "i", value: 0 },
        { type: "i", value: DEFAULTS.meterTimeFactor },
      ]);
    }
  });

  it("renews the /meters subscription on the same cadence as /xremote — comfortably inside the console's ~10s expiry", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 20,
      maxRetries: 1,
      xremoteRenewalMs: 1000,
      livenessPollMs: 1_000_000, // stays out of the way for this test
    });

    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const metersRequestsAfterConnect = transport.sent.filter(
      (r) => r.address === metersSubscribeAddress(),
    ).length;
    expect(metersRequestsAfterConnect).toBe(1); // the immediate renewal on connect

    await vi.advanceTimersByTimeAsync(1000 * 3 + 10);

    const metersRequestsAfterTicks = transport.sent.filter(
      (r) => r.address === metersSubscribeAddress(),
    ).length;
    expect(metersRequestsAfterTicks).toBe(4); // 1 immediate + 3 renewals
    expect(DEFAULTS.xremoteRenewalMs).toBeLessThan(10_000);
  });

  it("delivers the first 32 of a 96-float /meters/1 blob to subscribers", async () => {
    const { transport } = await connectedClient();
    const levelsSeen: number[][] = [];
    client!.subscribeMeters((levels) => levelsSeen.push(levels));

    // Rounded through `Math.fround`: the wire format is 32-bit float, so the
    // decoded value is only guaranteed to match the float32-rounded input,
    // not full JS double precision.
    const values = Array.from({ length: 96 }, (_, i) => Math.fround(i / 100));
    transport.push(metersReplyAddress(), [{ type: "b", value: meterBlob(values) }]);

    expect(levelsSeen).toEqual([values.slice(0, 32)]);
  });

  it("stops delivery after unsubscribe", async () => {
    const { transport } = await connectedClient();
    const levelsSeen: number[][] = [];
    const stop = client!.subscribeMeters((levels) => levelsSeen.push(levels));

    stop();
    transport.push(metersReplyAddress(), [{ type: "b", value: meterBlob([0.5]) }]);

    expect(levelsSeen).toEqual([]);
  });

  it("ignores a malformed /meters/1 blob without crashing or delivering", async () => {
    const { transport } = await connectedClient();
    const levelsSeen: number[][] = [];
    client!.subscribeMeters((levels) => levelsSeen.push(levels));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Declares 5 floats but carries none — malformed (see meters.test.ts).
    transport.push(metersReplyAddress(), [
      { type: "b", value: Buffer.from([0x05, 0x00, 0x00, 0x00]) },
    ]);

    expect(levelsSeen).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("malformed /meters/1 blob"));
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

  it("connected + a datagram received within the window: the poll tick sends no /xinfo probe and stays connected", async () => {
    vi.useFakeTimers();

    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 10,
      maxRetries: 1,
      xremoteRenewalMs: 1_000_000, // stays out of the way for this test
      livenessPollMs: 50,
    });

    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;
    expect(client.getConnectionState()).toBe("connected");

    const xinfoCountAtConnect = transport.sent.filter((r) => r.address === "/xinfo").length;

    // A live push arrives just before the poll tick fires — proof of life.
    await vi.advanceTimersByTimeAsync(40);
    transport.push("/-stat/selidx", [{ type: "i", value: 3 }]);
    await vi.advanceTimersByTimeAsync(20); // crosses the 50ms poll interval

    expect(client.getConnectionState()).toBe("connected");
    expect(transport.sent.filter((r) => r.address === "/xinfo")).toHaveLength(xinfoCountAtConnect);
  });

  it("connected + silence past the window: probes with /xinfo, and a reply keeps it connected", async () => {
    vi.useFakeTimers();

    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 10,
      maxRetries: 1,
      xremoteRenewalMs: 1_000_000,
      livenessPollMs: 50,
    });

    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;
    expect(client.getConnectionState()).toBe("connected");

    const xinfoCountAtConnect = transport.sent.filter((r) => r.address === "/xinfo").length;

    // Nothing arrives — the poll tick has to fall back to an explicit probe.
    await vi.advanceTimersByTimeAsync(50 + 20);

    expect(client.getConnectionState()).toBe("connected");
    expect(transport.sent.filter((r) => r.address === "/xinfo").length).toBeGreaterThan(xinfoCountAtConnect);
  });

  it("a stream of pushed events keeps the client connected indefinitely with zero /xinfo probes sent", async () => {
    vi.useFakeTimers();

    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 10,
      maxRetries: 1,
      xremoteRenewalMs: 1_000_000,
      livenessPollMs: 50,
    });

    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;
    expect(client.getConnectionState()).toBe("connected");

    const xinfoCountAtConnect = transport.sent.filter((r) => r.address === "/xinfo").length;

    // A meter blob every 30ms — well inside the 50ms liveness window — for
    // 10 poll intervals' worth of wall-clock time.
    for (let i = 0; i < 20; i += 1) {
      await vi.advanceTimersByTimeAsync(30);
      transport.push(metersReplyAddress(), [{ type: "b", value: meterBlob([0.1]) }]);
    }

    expect(client.getConnectionState()).toBe("connected");
    expect(transport.sent.filter((r) => r.address === "/xinfo")).toHaveLength(xinfoCountAtConnect);
  });
});

describe("disconnect()", () => {
  it("stops the transport and leaves no pending timers", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the renewal + liveness intervals are running

    await client.disconnect();

    expect(transport.closed).toBe(true);
    expect(client.getConnectionState()).toBe("disconnected");
    expect(vi.getTimerCount()).toBe(0);

    client = null; // already disconnected — afterEach must not double-disconnect
  });

  it("during a running connect() leaves no timers behind and sends nothing after close (race)", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    transport.autoReply = () => undefined; // nothing ever replies — connect() is still mid-retry
    client = new X32MixerClient(transport, { requestTimeoutMs: 10, maxRetries: 5 });

    const connectPromise = client.connect();
    await client.disconnect(); // races the in-flight connect()

    const sentAtClose = transport.sent.length;
    await connectPromise; // must settle without resurrecting state or timers

    expect(client.getConnectionState()).toBe("disconnected");
    expect(transport.closed).toBe(true);
    expect(transport.sent.length).toBe(sentAtClose); // nothing sent while connect() unwound
    expect(vi.getTimerCount()).toBe(0);

    // Even far into the future, nothing fires — no /xremote renewal, no liveness poll.
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(transport.sent.length).toBe(sentAtClose);
    expect(vi.getTimerCount()).toBe(0);

    client = null; // already disconnected — afterEach must not double-disconnect
  });

  it("is single-use: connect() after disconnect() throws rather than silently doing nothing", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    client = new X32MixerClient(transport, { requestTimeoutMs: 20, maxRetries: 1 });

    await client.connect();
    await client.disconnect();

    await expect(client.connect()).rejects.toThrow(
      "X32MixerClient is single-use; construct a new instance",
    );

    client = null; // already disconnected — afterEach must not double-disconnect
  });

  it("calls closeTransportResolver exactly once — releasing e.g. discovery mode's reused socket", async () => {
    const transport = new FakeTransport();
    transport.autoReply = defaultAutoReply();
    const closeTransportResolver = vi.fn();
    client = new X32MixerClient(transport, {
      requestTimeoutMs: 20,
      maxRetries: 1,
      closeTransportResolver,
    });

    await client.connect();
    expect(closeTransportResolver).not.toHaveBeenCalled();

    await client.disconnect();
    expect(closeTransportResolver).toHaveBeenCalledTimes(1);
  });
});

describe("defaults", () => {
  it("renews /xremote comfortably inside the console's 10s subscription expiry", () => {
    expect(DEFAULTS.xremoteRenewalMs).toBeLessThan(10_000);
  });
});
