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
    aes50LinkState: null,
    aes50Chain: [],
  };
}

describe("parseServerMessage: snapshot", () => {
  it("accepts a well-formed snapshot message with no baseline yet", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("accepts a well-formed snapshot message carrying a baseline", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: validSnapshot(),
      updateAvailable: null,
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("accepts a well-formed snapshot message carrying an update notice", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: { version: "0.2.0", url: "https://github.com/x/y/releases/tag/v0.2.0" },
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("treats a missing updateAvailable field as null (older bridge compatibility)", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: null,
    };

    expect(parseServerMessage(message)).toEqual({ ...message, updateAvailable: null });
  });

  it("rejects an updateAvailable with a non-https url", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: { version: "0.2.0", url: "javascript:alert(1)" },
    };

    expect(() => parseServerMessage(message)).toThrow(/updateAvailable\.url/);
  });

  it("rejects an updateAvailable missing its version", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: { url: "https://github.com/x/y/releases/tag/v0.2.0" },
    };

    expect(() => parseServerMessage(message)).toThrow(/updateAvailable\.version/);
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
          aes50LinkState: null,
          aes50Chain: [],
        },
        mixerConnection: "disconnected",
        baseline: null,
        updateAvailable: null,
      };
      expect(parseServerMessage(message)).toEqual(message);
    }
  });

  it("re-brands channel ids through the domain constructor", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: 12 },
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
    };

    const parsed = parseServerMessage(message);
    expect(parsed).toEqual({
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
    });
  });

  it("re-brands channel ids inside the baseline too", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: null },
      mixerConnection: "connected",
      baseline: { channels: [], selectedChannel: 12 },
      updateAvailable: null,
    };

    const parsed = parseServerMessage(message);
    expect(parsed).toEqual({
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: null, aes50LinkState: null, aes50Chain: [] },
      mixerConnection: "connected",
      baseline: { channels: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
      updateAvailable: null,
    });
  });

  it("rejects a channel id out of the 1-32 range", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], selectedChannel: 99 },
      mixerConnection: "connected",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/selectedChannel/);
  });

  it("rejects a missing channels array", () => {
    const message = {
      type: "snapshot",
      snapshot: { selectedChannel: null },
      mixerConnection: "connected",
      baseline: null,
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
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/mixer source kind/);
  });

  it("rejects an invalid mixerConnection value", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "reticulating",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/mixerConnection/);
  });

  it("rejects a missing baseline field (undefined is not a valid 'no baseline')", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
    };

    expect(() => parseServerMessage(message)).toThrow(/baseline/);
  });

  it("rejects a malformed baseline", () => {
    const message = {
      type: "snapshot",
      snapshot: validSnapshot(),
      mixerConnection: "connected",
      baseline: { channels: "not-an-array", selectedChannel: null },
    };

    expect(() => parseServerMessage(message)).toThrow(/baseline/);
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
      {
        type: "output-source-changed",
        output: 7,
        source: { kind: "bus", bus: 3 },
      },
      { type: "connection-state-changed", state: "connecting" },
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
      {
        type: "aes50-chain-changed",
        chain: { bus: "A", boxes: [{ position: 1, model: "S16", rawLetter: "A" }] },
      },
    ];

    for (const event of events) {
      const message = { type: "event", event };
      const parsed = parseServerMessage(message);
      expect(parsed.type).toBe("event");
    }
  });

  it("round-trips an aes50-link-state-changed event, including a null model kept as a distinct box", () => {
    const message = {
      type: "event",
      event: {
        type: "aes50-chain-changed",
        chain: {
          bus: "A",
          boxes: [{ position: 1, model: null, rawLetter: "?" }],
        },
      },
    };

    expect(parseServerMessage(message)).toEqual(message);
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

describe("parseServerMessage: output-source-changed (issue #11)", () => {
  it("round-trips every documented MixerOutputSourceRef kind", () => {
    const sources = [
      { kind: "main", side: "L" },
      { kind: "main", side: "C" },
      { kind: "bus", bus: 3 },
      { kind: "matrix", matrix: 1 },
      { kind: "direct-out-channel", channel: 12 },
      { kind: "direct-out-aux", aux: 2 },
      { kind: "direct-out-fx", ret: 1 },
      { kind: "monitor", side: "R" },
      { kind: "talkback" },
      { kind: "off" },
    ];

    for (const source of sources) {
      const message = { type: "event", event: { type: "output-source-changed", output: 13, source } };
      const expected =
        source.kind === "direct-out-channel"
          ? { type: "event", event: { type: "output-source-changed", output: 13, source: { kind: "direct-out-channel", channel: CH12 } } }
          : message;
      expect(parseServerMessage(message)).toEqual(expected);
    }
  });

  it("rejects an output number out of the 1-16 range", () => {
    const message = {
      type: "event",
      event: { type: "output-source-changed", output: 17, source: { kind: "off" } },
    };

    expect(() => parseServerMessage(message)).toThrow(/output/);
  });

  it("rejects an unknown output source kind", () => {
    const message = {
      type: "event",
      event: { type: "output-source-changed", output: 1, source: { kind: "wormhole" } },
    };

    expect(() => parseServerMessage(message)).toThrow(/mixer output source kind/);
  });

  it("rejects a malformed main side", () => {
    const message = {
      type: "event",
      event: { type: "output-source-changed", output: 1, source: { kind: "main", side: "Q" } },
    };

    expect(() => parseServerMessage(message)).toThrow(/side/);
  });
});

describe("parseServerMessage: snapshot outputs (issue #11)", () => {
  function baseSnapshot() {
    return {
      channels: [],
      selectedChannel: null,
      aes50LinkState: null,
      aes50Chain: [],
    };
  }

  it("accepts a snapshot carrying 16 output slots", () => {
    const outputs = Array.from({ length: 16 }, (_, index) => ({
      output: index + 1,
      source: { kind: "off" },
    }));
    const message = {
      type: "snapshot",
      snapshot: { ...baseSnapshot(), outputs },
      mixerConnection: "connected",
      baseline: null,
    };

    const parsed = parseServerMessage(message);
    expect(parsed.type).toBe("snapshot");
    expect(parsed.type === "snapshot" ? parsed.snapshot.outputs : undefined).toEqual(outputs);
  });

  it("tolerates a snapshot with no outputs field (older-peer compatibility)", () => {
    const message = {
      type: "snapshot",
      snapshot: baseSnapshot(),
      mixerConnection: "connected",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).not.toThrow();
  });

  it("rejects a malformed output entry inside the snapshot", () => {
    const message = {
      type: "snapshot",
      snapshot: { ...baseSnapshot(), outputs: [{ output: 1, source: { kind: "wormhole" } }] },
      mixerConnection: "connected",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/mixer output source kind/);
  });

  it("rejects an output entry with a name that is not a string", () => {
    const message = {
      type: "snapshot",
      snapshot: { ...baseSnapshot(), outputs: [{ output: 1, name: 42, source: { kind: "off" } }] },
      mixerConnection: "connected",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/name/);
  });
});

describe("parseServerMessage: baseline-changed", () => {
  it("accepts a well-formed baseline-changed message", () => {
    const message = { type: "baseline-changed", baseline: validSnapshot() };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("re-brands channel ids inside the baseline", () => {
    const message = {
      type: "baseline-changed",
      baseline: { channels: [], selectedChannel: 12 },
    };

    expect(parseServerMessage(message)).toEqual({
      type: "baseline-changed",
      baseline: { channels: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
    });
  });

  it("rejects a missing baseline", () => {
    expect(() => parseServerMessage({ type: "baseline-changed" })).toThrow(
      /baseline/,
    );
  });

  it("rejects a null baseline (unlike snapshot, this message always carries one)", () => {
    expect(() =>
      parseServerMessage({ type: "baseline-changed", baseline: null }),
    ).toThrow(/baseline/);
  });

  it("rejects a malformed baseline", () => {
    expect(() =>
      parseServerMessage({ type: "baseline-changed", baseline: { channels: null } }),
    ).toThrow(/baseline/);
  });
});

describe("parseServerMessage: baseline-save-rejected", () => {
  it("accepts a well-formed baseline-save-rejected message", () => {
    const message = {
      type: "baseline-save-rejected",
      reason: "The mixer is not connected.",
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("rejects a missing reason", () => {
    expect(() =>
      parseServerMessage({ type: "baseline-save-rejected" }),
    ).toThrow(/reason/);
  });

  it("rejects a non-string reason", () => {
    expect(() =>
      parseServerMessage({ type: "baseline-save-rejected", reason: 42 }),
    ).toThrow(/reason/);
  });
});

describe("parseServerMessage: meters", () => {
  function levels32(fill = 0): number[] {
    return new Array(32).fill(fill);
  }

  it("accepts a well-formed meters message with exactly 32 levels", () => {
    const message = { type: "meters", levels: levels32(0.5) };
    expect(parseServerMessage(message)).toEqual(message);
  });

  it("rejects a levels array that isn't an array", () => {
    expect(() =>
      parseServerMessage({ type: "meters", levels: "not-an-array" }),
    ).toThrow(/levels/);
  });

  it("rejects a levels array with the wrong length", () => {
    expect(() =>
      parseServerMessage({ type: "meters", levels: levels32().slice(0, 31) }),
    ).toThrow(/levels/);
    expect(() =>
      parseServerMessage({ type: "meters", levels: [...levels32(), 0] }),
    ).toThrow(/levels/);
  });

  it("rejects a non-numeric entry", () => {
    const levels: unknown[] = levels32();
    levels[5] = "loud";
    expect(() => parseServerMessage({ type: "meters", levels })).toThrow(
      /levels\[5\]/,
    );
  });

  it("rejects a non-finite entry", () => {
    const levels = levels32();
    levels[0] = Number.NaN;
    expect(() => parseServerMessage({ type: "meters", levels })).toThrow(
      /levels\[0\]/,
    );
  });
});

describe("parseServerMessage: update-available", () => {
  it("accepts a well-formed update-available message", () => {
    const message = {
      type: "update-available",
      update: { version: "0.2.0", url: "https://github.com/x/y/releases/tag/v0.2.0" },
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("rejects a missing update", () => {
    expect(() => parseServerMessage({ type: "update-available" })).toThrow(/update/);
  });

  it("rejects a non-https url", () => {
    const message = {
      type: "update-available",
      update: { version: "0.2.0", url: "data:text/html,<script>alert(1)</script>" },
    };

    expect(() => parseServerMessage(message)).toThrow(/update\.url/);
  });

  it("rejects a non-string version", () => {
    const message = {
      type: "update-available",
      update: { version: 2, url: "https://github.com/x/y/releases/tag/v0.2.0" },
    };

    expect(() => parseServerMessage(message)).toThrow(/update\.version/);
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

  it("accepts a save-baseline message", () => {
    expect(parseClientMessage({ type: "save-baseline" })).toEqual({
      type: "save-baseline",
    });
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
