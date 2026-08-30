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
    outputs: [],
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
      installationVersion: null,
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
      installationVersion: null,
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
      installationVersion: "0123456789abcdef",
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

    expect(parseServerMessage(message)).toEqual({
      ...message,
      updateAvailable: null,
      installationVersion: null,
    });
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
          outputs: [],
          selectedChannel: null,
          aes50LinkState: null,
          aes50Chain: [],
        },
        mixerConnection: "disconnected",
        baseline: null,
        updateAvailable: null,
        installationVersion: null,
      };
      expect(parseServerMessage(message)).toEqual(message);
    }
  });

  it("re-brands channel ids through the domain constructor", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], outputs: [], selectedChannel: 12 },
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
    };

    const parsed = parseServerMessage(message);
    expect(parsed).toEqual({
      type: "snapshot",
      snapshot: { channels: [], outputs: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
      installationVersion: null,
    });
  });

  it("re-brands channel ids inside the baseline too", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], outputs: [], selectedChannel: null },
      mixerConnection: "connected",
      baseline: { channels: [], outputs: [], selectedChannel: 12 },
      updateAvailable: null,
    };

    const parsed = parseServerMessage(message);
    expect(parsed).toEqual({
      type: "snapshot",
      snapshot: { channels: [], outputs: [], selectedChannel: null, aes50LinkState: null, aes50Chain: [] },
      mixerConnection: "connected",
      baseline: { channels: [], outputs: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
      updateAvailable: null,
      installationVersion: null,
    });
  });

  it("still rejects an outputs field that is present but not an array", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], outputs: "nope", selectedChannel: null },
      mixerConnection: "connected",
      baseline: null,
      updateAvailable: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/outputs/);
  });

  it("rejects a channel id out of the 1-32 range", () => {
    const message = {
      type: "snapshot",
      snapshot: { channels: [], outputs: [], selectedChannel: 99 },
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
      outputs: [],
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

  it("rejects a snapshot with no outputs field", () => {
    // `outputs` is required on the wire and on disk (issue #31). Older-peer
    // tolerance was deliberately dropped: substituting `[]` would present a
    // baseline claiming every output is unrouted, so every real output would
    // read as a deviation — worse than failing loudly. A baseline blessed
    // before the field existed is re-saved with "Save as correct".
    const { outputs: _omitted, ...withoutOutputs } = baseSnapshot();
    const message = {
      type: "snapshot",
      snapshot: withoutOutputs,
      mixerConnection: "connected",
      baseline: null,
    };

    expect(() => parseServerMessage(message)).toThrow(/outputs/);
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
      baseline: { channels: [], outputs: [], selectedChannel: 12 },
    };

    expect(parseServerMessage(message)).toEqual({
      type: "baseline-changed",
      baseline: { channels: [], outputs: [], selectedChannel: CH12, aes50LinkState: null, aes50Chain: [] },
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

/**
 * The installation edit path (issue #27). The operation's own guard lives in
 * `@x32/installation` next to the union it validates; what matters here is
 * that the three new messages cross the wire intact and that a malformed
 * variant is rejected rather than reaching the write pipeline.
 */
describe("parseServerMessage: installation-changed", () => {
  it("accepts a well-formed message", () => {
    const message = {
      type: "installation-changed",
      text: "version: 1\ndevices: {}\nconnections: []\n",
      version: "0123456789abcdef",
    };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("rejects a missing document text", () => {
    expect(() =>
      parseServerMessage({ type: "installation-changed", version: "0123456789abcdef" }),
    ).toThrow(/server message\.text/);
  });

  it("rejects a non-string version", () => {
    expect(() =>
      parseServerMessage({ type: "installation-changed", text: "version: 1\n", version: 7 }),
    ).toThrow(/server message\.version/);
  });
});

describe("parseServerMessage: installation-edit-rejected", () => {
  it("accepts a well-formed message", () => {
    const message = { type: "installation-edit-rejected", reason: "Unknown device \"ghost\"." };

    expect(parseServerMessage(message)).toEqual(message);
  });

  it("rejects a missing reason", () => {
    expect(() => parseServerMessage({ type: "installation-edit-rejected" })).toThrow(
      /server message\.reason/,
    );
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

describe("parseClientMessage: apply-installation-edit (issue #27)", () => {
  const validEdit = {
    type: "apply-installation-edit",
    baseVersion: "0123456789abcdef",
    operation: { kind: "set-device-label", device: "pit-box", label: "Pit Box" },
  };

  it("accepts a well-formed edit", () => {
    expect(parseClientMessage(validEdit)).toEqual(validEdit);
  });

  it("rejects a missing baseVersion — an edit with no precondition is never applied", () => {
    const { baseVersion: _omitted, ...withoutVersion } = validEdit;

    expect(() => parseClientMessage(withoutVersion)).toThrow(/client message\.baseVersion/);
  });

  it("rejects a missing operation", () => {
    const { operation: _omitted, ...withoutOperation } = validEdit;

    expect(() => parseClientMessage(withoutOperation)).toThrow(/client message\.operation/);
  });

  it("rejects an operation of an unknown kind", () => {
    expect(() =>
      parseClientMessage({ ...validEdit, operation: { kind: "drop-device", device: "pit-box" } }),
    ).toThrow(/client message\.operation\.kind/);
  });

  it("rejects an operation whose device id is not a device id", () => {
    expect(() =>
      parseClientMessage({
        ...validEdit,
        operation: { kind: "set-device-label", device: "../etc/passwd", label: "x" },
      }),
    ).toThrow(/client message\.operation\.device/);
  });

  it("rejects an operation with a non-string label", () => {
    expect(() =>
      parseClientMessage({
        ...validEdit,
        operation: { kind: "set-device-label", device: "pit-box", label: 42 },
      }),
    ).toThrow(/client message\.operation\.label/);
  });
});

describe("parseServerMessage: source-meters (issue #36)", () => {
  function levels(buses = 16, matrices = 6) {
    return {
      buses: Array.from({ length: buses }, () => 0.1),
      matrices: Array.from({ length: matrices }, () => 0.2),
    };
  }

  it("accepts 16 bus and 6 matrix levels", () => {
    const parsed = parseServerMessage({ type: "source-meters", levels: levels() });

    expect(parsed.type).toBe("source-meters");
    expect(parsed.type === "source-meters" ? parsed.levels.buses : []).toHaveLength(16);
    expect(parsed.type === "source-meters" ? parsed.levels.matrices : []).toHaveLength(6);
  });

  it("rejects a wrong number of buses or matrices", () => {
    // A length mismatch means the sender's layout differs from ours, and
    // accepting it would put a meter beside the wrong speaker.
    expect(() => parseServerMessage({ type: "source-meters", levels: levels(8) })).toThrow(
      /buses/,
    );
    expect(() => parseServerMessage({ type: "source-meters", levels: levels(16, 4) })).toThrow(
      /matrices/,
    );
  });

  it("rejects non-numeric levels and a non-object payload", () => {
    const bad = { buses: Array.from({ length: 16 }, () => "loud"), matrices: [0, 0, 0, 0, 0, 0] };
    expect(() => parseServerMessage({ type: "source-meters", levels: bad })).toThrow(/buses/);
    expect(() => parseServerMessage({ type: "source-meters", levels: null })).toThrow();
  });
});
