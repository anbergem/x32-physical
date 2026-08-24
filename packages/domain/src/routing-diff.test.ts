import { describe, expect, it } from "vitest";

import { mixerChannelId } from "./ids";
import type { MixerChannelState, MixerSourceRef } from "./mixer";
import { mixerSourceRefEquals } from "./mixer";
import type { RoutingDiscrepancy } from "./routing-diff";
import { compareRouting } from "./routing-diff";

function aes50A(channel: number): MixerSourceRef {
  return { kind: "aes50", bus: "A", channel };
}

function channel(
  n: number,
  name: string,
  source: MixerSourceRef,
): MixerChannelState {
  return { channel: mixerChannelId(n), name, source };
}

/**
 * A realistic 32-channel snapshot mirroring the mock's default (dual
 * consumer CH23/CH28 sharing AES50-A 23, an unmapped card source, an off
 * channel), used for the round-trip and shuffled-order tests below.
 */
function defaultSnapshot(): MixerChannelState[] {
  const channels: MixerChannelState[] = [];
  for (let n = 1; n <= 27; n += 1) {
    channels.push(channel(n, `Ch ${n}`, aes50A(n)));
  }
  channels.push(channel(28, "Podium Rec", aes50A(23))); // dual consumer with CH23
  channels.push(channel(29, "Playback L", { kind: "card", input: 1 })); // unmapped
  channels.push(channel(30, "Playback R", { kind: "card", input: 2 })); // unmapped
  channels.push(channel(31, "Stage Talk", aes50A(31)));
  channels.push(channel(32, "Spare 32", { kind: "off" })); // off
  return channels;
}

describe("mixerSourceRefEquals", () => {
  it("is true for structurally identical sources", () => {
    expect(mixerSourceRefEquals({ kind: "off" }, { kind: "off" })).toBe(true);
    expect(
      mixerSourceRefEquals(aes50A(5), { kind: "aes50", bus: "A", channel: 5 }),
    ).toBe(true);
  });

  it("is false when kind or fields differ", () => {
    expect(mixerSourceRefEquals(aes50A(5), aes50A(6))).toBe(false);
    expect(
      mixerSourceRefEquals(aes50A(5), { kind: "local", input: 5 }),
    ).toBe(false);
  });
});

describe("compareRouting", () => {
  it("flags a single source-mismatch when a channel's source differs", () => {
    const expected = [channel(4, "Tom 1", aes50A(4))];
    const actual = [channel(4, "Tom 1", aes50A(7))];

    expect(compareRouting(expected, actual)).toEqual([
      {
        kind: "source-mismatch",
        channel: 4,
        expected: aes50A(4),
        actual: aes50A(7),
      },
    ]);
  });

  it("flags unexpected-shared-source when actual newly shares a source", () => {
    const expected = [channel(4, "Tom 1", aes50A(4)), channel(7, "OH R", aes50A(7))];
    const actual = [channel(4, "Tom 1", aes50A(4)), channel(7, "OH R", aes50A(4))];

    const result = compareRouting(expected, actual);
    expect(result).toEqual([
      { kind: "source-mismatch", channel: 7, expected: aes50A(7), actual: aes50A(4) },
      {
        kind: "unexpected-shared-source",
        source: aes50A(4),
        channels: [4, 7],
      },
    ]);
  });

  it("flags only a name-mismatch on a rename", () => {
    const expected = [channel(1, "Kick In", aes50A(1))];
    const actual = [channel(1, "Kick", aes50A(1))];

    expect(compareRouting(expected, actual)).toEqual([
      { kind: "name-mismatch", channel: 1, expected: "Kick In", actual: "Kick" },
    ]);
  });

  it("returns [] for identical arrays", () => {
    expect(compareRouting(defaultSnapshot(), defaultSnapshot())).toEqual([]);
  });

  it("does not flag two off channels as sharing a source", () => {
    const expected = [channel(31, "A", { kind: "off" }), channel(32, "B", { kind: "off" })];
    const actual = [channel(31, "A", { kind: "off" }), channel(32, "B", { kind: "off" })];

    expect(compareRouting(expected, actual)).toEqual([]);
  });

  it("does not flag a source shared in both expected and actual", () => {
    const expected = [channel(23, "Podium", aes50A(23)), channel(28, "Podium Rec", aes50A(23))];
    const actual = [channel(23, "Podium", aes50A(23)), channel(28, "Podium Rec", aes50A(23))];

    expect(compareRouting(expected, actual)).toEqual([]);
  });

  it("skips a channel missing from expected without throwing", () => {
    const expected = [channel(1, "Kick In", aes50A(1))];
    const actual = [channel(1, "Kick In", aes50A(1)), channel(2, "Snare", aes50A(2))];

    expect(() => compareRouting(expected, actual)).not.toThrow();
    expect(compareRouting(expected, actual)).toEqual([]);
  });

  it("skips a channel missing from actual without throwing", () => {
    const expected = [channel(1, "Kick In", aes50A(1)), channel(2, "Snare", aes50A(2))];
    const actual = [channel(1, "Kick In", aes50A(1))];

    expect(() => compareRouting(expected, actual)).not.toThrow();
    expect(compareRouting(expected, actual)).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const expected = [channel(4, "Tom 1", aes50A(4)), channel(7, "OH R", aes50A(7))];
    const actualInOrder = [channel(4, "Tom 1", aes50A(9)), channel(7, "OH R", aes50A(9))];
    const actualShuffled = [...actualInOrder].reverse();
    const expectedShuffled = [...expected].reverse();

    const result = compareRouting(expected, actualInOrder);
    const shuffledResult = compareRouting(expectedShuffled, actualShuffled);

    expect(shuffledResult).toEqual(result);
    expect(result).toEqual([
      { kind: "source-mismatch", channel: 4, expected: aes50A(4), actual: aes50A(9) },
      { kind: "source-mismatch", channel: 7, expected: aes50A(7), actual: aes50A(9) },
      { kind: "unexpected-shared-source", source: aes50A(9), channels: [4, 7] },
    ]);
  });

  it("round-trips the default dual-consumer snapshot against itself", () => {
    const snapshot = defaultSnapshot();
    const result: RoutingDiscrepancy[] = compareRouting(snapshot, snapshot);
    expect(result).toEqual([]);
  });
});
