import type { MixerChannelId } from "@x32/domain";
import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MixerEvent, MixerSnapshot } from "./client";
import { createDefaultMockSnapshot } from "./default-snapshot";
import { MockMixerClient } from "./mock";

const CH12: MixerChannelId = mixerChannelId(12);
const CH23: MixerChannelId = mixerChannelId(23);

/** Records every event a client fans out, in order. */
function recorder(client: MockMixerClient): {
  events: MixerEvent[];
  stop: () => void;
} {
  const events: MixerEvent[] = [];
  const stop = client.subscribe((event) => {
    events.push(event);
  });
  return { events, stop };
}

describe("MockMixerClient connection lifecycle", () => {
  it("starts disconnected", () => {
    expect(new MockMixerClient().getConnectionState()).toBe("disconnected");
  });

  it("connects and disconnects, emitting one event per transition", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    await client.connect();
    expect(client.getConnectionState()).toBe("connected");

    await client.disconnect();
    expect(client.getConnectionState()).toBe("disconnected");

    expect(events).toEqual([
      { type: "connection-state-changed", state: "connected" },
      { type: "connection-state-changed", state: "disconnected" },
    ]);
  });

  it("treats a redundant transition as a no-op", async () => {
    const client = new MockMixerClient();
    await client.connect();
    const { events } = recorder(client);

    await client.connect();
    client.simulateReconnect();

    expect(client.getConnectionState()).toBe("connected");
    expect(events).toEqual([]);
  });

  it("simulates a connection attempt in flight", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateConnecting();
    expect(client.getConnectionState()).toBe("connecting");

    // Idempotent like the other transitions.
    client.simulateConnecting();

    await client.connect();
    expect(client.getConnectionState()).toBe("connected");

    expect(events).toEqual([
      { type: "connection-state-changed", state: "connecting" },
      { type: "connection-state-changed", state: "connected" },
    ]);
  });

  it("simulates connection loss and reconnection", async () => {
    const client = new MockMixerClient();
    await client.connect();
    const { events } = recorder(client);

    client.simulateConnectionLoss();
    expect(client.getConnectionState()).toBe("disconnected");

    client.simulateReconnect();
    expect(client.getConnectionState()).toBe("connected");

    expect(events).toEqual([
      { type: "connection-state-changed", state: "disconnected" },
      { type: "connection-state-changed", state: "connected" },
    ]);
  });

  it("keeps the snapshot across a connection loss", async () => {
    const client = new MockMixerClient();
    await client.connect();
    client.simulateSelect(CH12);

    client.simulateConnectionLoss();

    expect(await client.getSnapshot()).toEqual({
      ...createDefaultMockSnapshot(),
      selectedChannel: 12,
    });
  });
});

describe("MockMixerClient simulation API", () => {
  it("emits selected-channel-changed and updates the snapshot", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateSelect(CH12);
    expect((await client.getSnapshot()).selectedChannel).toBe(12);

    client.simulateSelect(null);
    expect((await client.getSnapshot()).selectedChannel).toBeNull();

    expect(events).toEqual([
      { type: "selected-channel-changed", channel: 12 },
      { type: "selected-channel-changed", channel: null },
    ]);
  });

  it("emits channel-name-changed and updates the snapshot", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateRename(CH12, "Grand Pno");

    const snapshot = await client.getSnapshot();
    expect(snapshot.channels[11]).toEqual({
      channel: 12,
      name: "Grand Pno",
      source: { kind: "aes50", bus: "A", channel: 19 },
    });
    expect(events).toEqual([
      { type: "channel-name-changed", channel: 12, name: "Grand Pno" },
    ]);
  });

  it("emits channel-source-changed and updates the snapshot", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateSourceChange(CH12, { kind: "aes50", bus: "A", channel: 8 });

    expect((await client.getSnapshot()).channels[11]?.source).toEqual({
      kind: "aes50",
      bus: "A",
      channel: 8,
    });
    expect(events).toEqual([
      {
        type: "channel-source-changed",
        channel: 12,
        source: { kind: "aes50", bus: "A", channel: 8 },
      },
    ]);
  });

  it("accepts unmapped sources", async () => {
    const client = new MockMixerClient();

    client.simulateSourceChange(CH12, { kind: "card", input: 5 });
    expect((await client.getSnapshot()).channels[11]?.source).toEqual({
      kind: "card",
      input: 5,
    });

    client.simulateSourceChange(CH12, { kind: "off" });
    expect((await client.getSnapshot()).channels[11]?.source).toEqual({
      kind: "off",
    });
  });

  it("does not alias the source object it was handed", async () => {
    const client = new MockMixerClient();
    const source = { kind: "aes50", bus: "A", channel: 8 } as const;

    client.simulateSourceChange(CH12, { ...source });
    const { events } = recorder(client);
    client.simulateSourceChange(CH12, { ...source });

    // A consumer mutating the event payload must not reach the mock's state.
    const emitted = events[0];
    if (emitted?.type !== "channel-source-changed") {
      throw new Error("expected a channel-source-changed event");
    }
    Object.assign(emitted.source, { channel: 99 });

    expect((await client.getSnapshot()).channels[11]?.source).toEqual(source);
  });

  it("rejects channels the snapshot does not contain", () => {
    const snapshot: MixerSnapshot = {
      channels: [
        {
          channel: CH12,
          name: "Keys R",
          source: { kind: "aes50", bus: "A", channel: 12 },
        },
      ],
      selectedChannel: null,
    };
    const client = new MockMixerClient(snapshot);

    expect(() => client.simulateRename(CH23, "Podium")).toThrow(
      /Unknown mixer channel 23/,
    );
    expect(() => client.simulateSelect(CH23)).toThrow(/Unknown mixer channel/);
    expect(() =>
      client.simulateSourceChange(CH23, { kind: "off" }),
    ).toThrow(/Unknown mixer channel/);
  });

  it("emits output-source-changed and updates the snapshot (issue #11)", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateOutputSourceChange(13, { kind: "bus", bus: 7 });

    const snapshot = await client.getSnapshot();
    expect(snapshot.outputs?.[12]).toEqual({
      output: 13,
      name: undefined,
      source: { kind: "bus", bus: 7 },
    });
    expect(events).toEqual([
      { type: "output-source-changed", output: 13, source: { kind: "bus", bus: 7 } },
    ]);
  });

  it("does not alias the output source object it was handed", async () => {
    const client = new MockMixerClient();
    const source = { kind: "bus", bus: 3 } as const;

    client.simulateOutputSourceChange(7, { ...source });
    const { events } = recorder(client);
    client.simulateOutputSourceChange(7, { ...source });

    const emitted = events[0];
    if (emitted?.type !== "output-source-changed") {
      throw new Error("expected an output-source-changed event");
    }
    Object.assign(emitted.source, { bus: 99 });

    expect((await client.getSnapshot()).outputs?.[6]?.source).toEqual(source);
  });

  it("rejects outputs the snapshot does not contain", () => {
    const snapshot: MixerSnapshot = {
      channels: [],
      outputs: [{ output: 1, source: { kind: "off" } }],
      selectedChannel: null,
    };
    const client = new MockMixerClient(snapshot);

    expect(() =>
      client.simulateOutputSourceChange(2, { kind: "off" }),
    ).toThrow(/Unknown mixer output 2/);
  });
});

describe("MockMixerClient subscriptions", () => {
  it("fans out to every subscriber, including duplicates of one listener", () => {
    const client = new MockMixerClient();
    const seen: string[] = [];
    const listener = (): void => {
      seen.push("listener");
    };

    client.subscribe(listener);
    const unsubscribeSecond = client.subscribe(listener);
    client.subscribe(() => {
      seen.push("other");
    });

    client.simulateSelect(CH12);
    expect(seen).toEqual(["listener", "listener", "other"]);

    // Unsubscribing one registration leaves the other one intact.
    seen.length = 0;
    unsubscribeSecond();
    client.simulateSelect(null);
    expect(seen).toEqual(["listener", "other"]);
  });

  it("stops delivery after unsubscribe, idempotently", () => {
    const client = new MockMixerClient();
    const first = recorder(client);
    const second = recorder(client);

    first.stop();
    first.stop(); // idempotent: must not disturb the other subscription
    client.simulateSelect(CH12);

    expect(first.events).toEqual([]);
    expect(second.events).toEqual([
      { type: "selected-channel-changed", channel: 12 },
    ]);
  });

  it("keeps delivering when a listener throws, and rethrows out of band", () => {
    const client = new MockMixerClient();
    const delivered: MixerEvent[] = [];

    // Capture the microtask instead of letting it reach the test runner as an
    // unhandled error — the point is that the failure is rethrown, not eaten.
    const host = globalThis as unknown as {
      queueMicrotask: (callback: () => void) => void;
    };
    const original = host.queueMicrotask;
    const rethrown: Array<() => void> = [];
    host.queueMicrotask = (callback) => {
      rethrown.push(callback);
    };

    try {
      client.subscribe(() => {
        throw new Error("listener blew up");
      });
      client.subscribe((event) => {
        delivered.push(event);
      });

      expect(() => {
        client.simulateSelect(CH12);
      }).not.toThrow();
      expect(delivered).toEqual([
        { type: "selected-channel-changed", channel: 12 },
      ]);

      expect(rethrown).toHaveLength(1);
      expect(() => {
        rethrown[0]?.();
      }).toThrowError("listener blew up");
    } finally {
      host.queueMicrotask = original;
    }
  });

  it("tolerates unsubscribing from inside a listener", () => {
    const client = new MockMixerClient();
    const delivered: MixerEvent[] = [];

    const stop = client.subscribe(() => {
      stop();
    });
    client.subscribe((event) => {
      delivered.push(event);
    });

    client.simulateSelect(CH12);
    client.simulateSelect(null);

    expect(delivered).toHaveLength(2);
  });
});

describe("MockMixerClient meters (plan step 15)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits nothing until simulateMetersStart() — the mock is otherwise timer-free", () => {
    vi.useFakeTimers();
    const client = new MockMixerClient();
    const levelsSeen: number[][] = [];
    client.subscribeMeters((levels) => levelsSeen.push(levels));

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(levelsSeen).toEqual([]);
  });

  it("delivers 32 levels on a ~250ms cadence once started, zero for OFF channels", () => {
    vi.useFakeTimers();
    const client = new MockMixerClient();
    // The real patch sheet has no OFF channel by default; force one locally.
    client.simulateSourceChange(mixerChannelId(32), { kind: "off" });
    const levelsSeen: number[][] = [];
    client.subscribeMeters((levels) => levelsSeen.push(levels));

    client.simulateMetersStart();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(250);
    expect(levelsSeen).toHaveLength(1);
    const [first] = levelsSeen;
    expect(first).toHaveLength(MIXER_CHANNEL_COUNT);
    expect(first?.every((level) => level >= 0 && level <= 1)).toBe(true);
    expect(first?.[31]).toBe(0); // CH32 forced OFF above

    vi.advanceTimersByTime(250 * 3);
    expect(levelsSeen).toHaveLength(4);
  });

  it("simulateMetersStop() stops the interval cleanly, idempotently", () => {
    vi.useFakeTimers();
    const client = new MockMixerClient();
    const levelsSeen: number[][] = [];
    client.subscribeMeters((levels) => levelsSeen.push(levels));

    client.simulateMetersStart();
    vi.advanceTimersByTime(250);
    expect(levelsSeen).toHaveLength(1);

    client.simulateMetersStop();
    client.simulateMetersStop(); // idempotent
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(levelsSeen).toHaveLength(1); // nothing more delivered
  });

  it("starting twice does not create a second interval", () => {
    vi.useFakeTimers();
    const client = new MockMixerClient();
    client.subscribeMeters(() => {});

    client.simulateMetersStart();
    client.simulateMetersStart();
    expect(vi.getTimerCount()).toBe(1);

    client.simulateMetersStop();
  });

  it("stops delivering to an unsubscribed meter listener", () => {
    vi.useFakeTimers();
    const client = new MockMixerClient();
    const levelsSeen: number[][] = [];
    const stop = client.subscribeMeters((levels) => levelsSeen.push(levels));

    client.simulateMetersStart();
    vi.advanceTimersByTime(250);
    expect(levelsSeen).toHaveLength(1);

    stop();
    vi.advanceTimersByTime(250);
    expect(levelsSeen).toHaveLength(1); // no further delivery

    client.simulateMetersStop();
  });
});

describe("MockMixerClient snapshot isolation", () => {
  it("returns a defensive copy", async () => {
    const client = new MockMixerClient();

    const snapshot = await client.getSnapshot();
    snapshot.selectedChannel = CH12;
    snapshot.channels.push({
      channel: CH23,
      name: "Injected",
      source: { kind: "off" },
    });
    const firstChannel = snapshot.channels[0];
    if (firstChannel === undefined) throw new Error("expected a channel");
    firstChannel.name = "Tampered";
    firstChannel.source = { kind: "off" };

    expect(await client.getSnapshot()).toEqual(createDefaultMockSnapshot());
  });

  it("copies the snapshot it was constructed from", async () => {
    const initial = createDefaultMockSnapshot();
    const client = new MockMixerClient(initial);

    const firstChannel = initial.channels[0];
    if (firstChannel === undefined) throw new Error("expected a channel");
    firstChannel.name = "Tampered";
    initial.selectedChannel = CH12;

    const snapshot = await client.getSnapshot();
    expect(snapshot.channels[0]?.name).toBe("Lectern");
    expect(snapshot.selectedChannel).toBeNull();
  });
});

describe("MockMixerClient AES50 simulation (issue #17)", () => {
  it("starts with the healthy default: both buses clear, the venue's 2-box AES50-A chain", async () => {
    const client = new MockMixerClient();
    const snapshot = await client.getSnapshot();
    expect(snapshot.aes50LinkState).toEqual({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: true,
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

  it("simulateAes50LinkError sets the given bus's audioError and emits aes50-link-state-changed", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateAes50LinkError("A");

    expect(events).toEqual([
      {
        type: "aes50-link-state-changed",
        state: {
          buses: [
            { bus: "A", audioError: true, auxError: false },
            { bus: "B", audioError: false, auxError: false },
          ],
          locked: true,
        },
      },
    ]);
    const snapshot = await client.getSnapshot();
    expect(snapshot.aes50LinkState?.buses[0]).toEqual({
      bus: "A",
      audioError: true,
      auxError: false,
    });
    // The other bus is untouched.
    expect(snapshot.aes50LinkState?.buses[1]).toEqual({
      bus: "B",
      audioError: false,
      auxError: false,
    });
  });

  it("simulateAes50LinkError(bus, { audioError: false }) clears it back to healthy", async () => {
    const client = new MockMixerClient();
    client.simulateAes50LinkError("A");

    client.simulateAes50LinkError("A", { audioError: false });

    const snapshot = await client.getSnapshot();
    expect(snapshot.aes50LinkState?.buses[0]?.audioError).toBe(false);
  });

  it("simulateAes50ChainChange replaces one bus's chain and emits aes50-chain-changed", async () => {
    const client = new MockMixerClient();
    const { events } = recorder(client);

    client.simulateAes50ChainChange("A", [{ position: 1, model: "S32", rawLetter: "W" }]);

    expect(events).toEqual([
      {
        type: "aes50-chain-changed",
        chain: { bus: "A", boxes: [{ position: 1, model: "S32", rawLetter: "W" }] },
      },
    ]);
    const snapshot = await client.getSnapshot();
    expect(snapshot.aes50Chain).toContainEqual({
      bus: "A",
      boxes: [{ position: 1, model: "S32", rawLetter: "W" }],
    });
    // Bus B's entry is untouched.
    expect(snapshot.aes50Chain).toContainEqual({ bus: "B", boxes: [] });
  });
});
