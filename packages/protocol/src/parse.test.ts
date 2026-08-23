import { mixerChannelId } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { parseClientMessage, parseServerMessage } from "./parse";

const CH12 = mixerChannelId(12);
const CH28 = mixerChannelId(28);

function validSnapshot(): MixerSnapshot {
  return {
    channels: [
      { channel: CH12, name: "Keys L", source: { kind: "aes50", bus: "A", channel: 12 } },
      { channel: CH28, name: "Playback", source: { kind: "card", input: 1 } },
    ],
    selectedChannel: null,
  };
}

describe("parseServerMessage: snapshot", () => {
  it("accepts a well-formed snapshot message", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("accepts every documented MixerSourceRef kind", () => {
    const sources = [
      { kind: "aes50", bus: "B", channel: 40 },
      { kind: "local", input: 3 },
      { kind: "card", input: 1 },
      { kind: "aux", input: 2 },
      { kind: "usb", side: "L" },
      { kind: "fx", ret: 1 },
      { kind: "bus", bus: 4 },
      { kind: "talkback", which: "int" },
      { kind: "off" },
    ];

    for (const source of sources) {
      const message = {
        type: "snapshot",
        snapshot: {
          channels: [{ channel: 1, name: "CH1", source }],
          selectedChannel: null,
        },
        mixerConnection: "disconnected",
      };
      expect(parseServerMessage(message)).toEqual(message);
    }
  });

  it("re-brands channel ids through the domain constructor", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: 12 },
      mixerConnection: "connected",
    };

    const parsed = parseServerMessage(message);
    expect(parsed).toEqual({
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: CH12 },
      mixerConnection: "connected",
    });
  });

  it("rejects a channel id out of the 1-32 range", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: 99 },
      mixerConnection: "connected",
    };

    expect(() => parseServerMessage(message)).toThrow(/selectedChannel/);
  });

  it("rejects a missing channels array", () => {
    const message = {
      type: "snapshot",
      snapshot: { selectedChannel: null },
      mixerConnection: "connected",
    };

    expect(() => parseServerMessage(message)).toThrow(/channels/);
  });

  it("rejects an unknown mixer source kind", () => {
    const message = {
      type: "snapshot",
      snapshot: {
        channels: [{ channel: 1, name: "CH1", source: { kind: "wormhole" } }],
        selectedChannel: null,
      },
      mixerConnection: "connected",
    };

    expect(() => parseServerMessage(message)).toThrow(/mixer source kind/);
  });

  it("rejects an invalid mixerConnection value", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "reticulating",
    };

    expect(() => parseServerMessage(message)).toThrow(/mixerConnection/);
  });
});

describe("parseServerMessage: event", () => {
  it("accepts each MixerEvent variant", () => {
    const events = [
      { type: "selected-channel-changed", channel: 12 },
      { type: "selected-channel-changed", channel: null },
      { type: "channel-name-changed", channel: 7, name: "Overhead R" },
      {
        type: "channel-source-changed",
        channel: 12,
        source: { kind: "aes50", bus: "A", channel: 3 },
      },
      { type: "connection-state-changed", state: "connecting" },
    ];

    for (const event of events) {
      const message = { type: "event", event };
      const parsed = parseServerMessage(message);
      expect(parsed.type).toBe("event");
    }
  });

  it("re-brands the channel id on selected-channel-changed", () => {
    const message = {
      type: "event",
      event: { type: "selected-channel-changed", channel: 12 },
    };

    expect(parseServerMessage(message)).toEqual({
      type: "event",
      event: { type: "selected-channel-changed", channel: CH12 },
    });
  });

  it("rejects an unknown event type", () => {
    const message = { type: "event", event: { type: "channel-teleported" } };

    expect(() => parseServerMessage(message)).toThrow(/mixer event type/);
  });
});

describe("parseServerMessage: envelope", () => {
  it("rejects null, arrays, and non-objects", () => {
    for (const value of [null, undefined, 42, "snapshot", true, []]) {
      expect(() => parseServerMessage(value)).toThrow(/server message/);
    }
  });

  it("rejects an unknown message type", () => {
    expect(() => parseServerMessage({ type: "ping" })).toThrow(
      /server message.type/,
    );
  });

  it("rejects a message with no type", () => {
    expect(() => parseServerMessage({})).toThrow(/server message/);
  });
});

describe("parseClientMessage", () => {
  it("accepts a resync message", () => {
    expect(parseClientMessage({ type: "resync" })).toEqual({ type: "resync" });
  });

  it("rejects anything else", () => {
    expect(() => parseClientMessage({ type: "unsubscribe" })).toThrow(
      /client message.type/,
    );
    expect(() => parseClientMessage(null)).toThrow(/client message/);
    expect(() => parseClientMessage("resync")).toThrow(/client message/);
    expect(() => parseClientMessage({})).toThrow(/client message/);
  });
});
