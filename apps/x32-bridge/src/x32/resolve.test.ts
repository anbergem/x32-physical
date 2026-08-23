/**
 * Resolution unit tests, taken straight from docs/x32-protocol.md's own
 * worked examples and enum tables (§Resolution algorithm, §The messages we
 * track).
 */

import { describe, expect, it } from "vitest";

import {
  classifyChannelSourceValue,
  resolveUserRoutValue,
  selIdxToChannel,
} from "./osc-tables";
import type { InBlockValues } from "./resolve";
import {
  affectedChannelsForInBlockChange,
  affectedChannelsForUserRoutChange,
  resolveChannelSource,
  sourceRefEquals,
  X32State,
} from "./resolve";

const OFF_BLOCKS: InBlockValues = [0, 0, 0, 0]; // all AN, irrelevant for aux/usb/fx/bus/off cases
const NO_USER_ROUT = Array.from({ length: 32 }, () => 0);

describe("classifyChannelSourceValue", () => {
  it("0 -> off", () => {
    expect(classifyChannelSourceValue(0)).toEqual({ kind: "off" });
  });

  it("33..38 -> aux 1-6", () => {
    expect(classifyChannelSourceValue(33)).toEqual({ kind: "aux", input: 1 });
    expect(classifyChannelSourceValue(38)).toEqual({ kind: "aux", input: 6 });
  });

  it("39/40 -> usb L/R", () => {
    expect(classifyChannelSourceValue(39)).toEqual({ kind: "usb", side: "L" });
    expect(classifyChannelSourceValue(40)).toEqual({ kind: "usb", side: "R" });
  });

  it("41..48 -> fx 1..4 (L/R share one ret, matching MixerSourceRef's shape)", () => {
    expect(classifyChannelSourceValue(41)).toEqual({ kind: "fx", ret: 1 });
    expect(classifyChannelSourceValue(42)).toEqual({ kind: "fx", ret: 1 });
    expect(classifyChannelSourceValue(43)).toEqual({ kind: "fx", ret: 2 });
    expect(classifyChannelSourceValue(48)).toEqual({ kind: "fx", ret: 4 });
  });

  it("49..64 -> bus 1..16", () => {
    expect(classifyChannelSourceValue(49)).toEqual({ kind: "bus", bus: 1 });
    expect(classifyChannelSourceValue(64)).toEqual({ kind: "bus", bus: 16 });
  });

  it("1..32 -> input slot", () => {
    expect(classifyChannelSourceValue(1)).toEqual({ kind: "input-slot", slot: 1 });
    expect(classifyChannelSourceValue(32)).toEqual({ kind: "input-slot", slot: 32 });
  });

  it("out-of-spec values degrade to off rather than throw", () => {
    expect(classifyChannelSourceValue(65)).toEqual({ kind: "off" });
    expect(classifyChannelSourceValue(-1)).toEqual({ kind: "off" });
  });
});

describe("resolveUserRoutValue", () => {
  it("0 -> off", () => {
    expect(resolveUserRoutValue(0)).toEqual({ kind: "off" });
  });

  it("1..32 -> local 1..32", () => {
    expect(resolveUserRoutValue(1)).toEqual({ kind: "local", input: 1 });
    expect(resolveUserRoutValue(32)).toEqual({ kind: "local", input: 32 });
  });

  it("33..80 -> aes50-A (v-32)", () => {
    expect(resolveUserRoutValue(33)).toEqual({ kind: "aes50", bus: "A", channel: 1 });
    expect(resolveUserRoutValue(55)).toEqual({ kind: "aes50", bus: "A", channel: 23 });
    expect(resolveUserRoutValue(80)).toEqual({ kind: "aes50", bus: "A", channel: 48 });
  });

  it("81..128 -> aes50-B (v-80)", () => {
    expect(resolveUserRoutValue(81)).toEqual({ kind: "aes50", bus: "B", channel: 1 });
    expect(resolveUserRoutValue(128)).toEqual({ kind: "aes50", bus: "B", channel: 48 });
  });

  it("129..160 -> card", () => {
    expect(resolveUserRoutValue(129)).toEqual({ kind: "card", input: 1 });
    expect(resolveUserRoutValue(160)).toEqual({ kind: "card", input: 32 });
  });

  it("161..166 -> aux", () => {
    expect(resolveUserRoutValue(161)).toEqual({ kind: "aux", input: 1 });
    expect(resolveUserRoutValue(166)).toEqual({ kind: "aux", input: 6 });
  });

  it("167/168 -> talkback int/ext", () => {
    expect(resolveUserRoutValue(167)).toEqual({ kind: "talkback", which: "int" });
    expect(resolveUserRoutValue(168)).toEqual({ kind: "talkback", which: "ext" });
  });

  it("out-of-spec values degrade to off rather than throw", () => {
    expect(resolveUserRoutValue(169)).toEqual({ kind: "off" });
    expect(resolveUserRoutValue(-1)).toEqual({ kind: "off" });
  });
});

describe("selIdxToChannel", () => {
  it("0 -> CH1, 31 -> CH32", () => {
    expect(selIdxToChannel(0)).toBe(1);
    expect(selIdxToChannel(31)).toBe(32);
  });

  it("32..71 -> null (non-input strip)", () => {
    expect(selIdxToChannel(32)).toBeNull();
    expect(selIdxToChannel(71)).toBeNull();
  });

  it("out-of-spec values -> null", () => {
    expect(selIdxToChannel(-1)).toBeNull();
    expect(selIdxToChannel(72)).toBeNull();
  });
});

describe("resolveChannelSource — mixer-internal sources (steps 1-2)", () => {
  it("off", () => {
    expect(resolveChannelSource({ sourceValue: 0, inBlocks: OFF_BLOCKS, userRoutIn: NO_USER_ROUT })).toEqual({
      kind: "off",
    });
  });

  it("aux/usb/fx/bus pass straight through, ignoring IN blocks entirely", () => {
    expect(
      resolveChannelSource({ sourceValue: 33, inBlocks: OFF_BLOCKS, userRoutIn: NO_USER_ROUT }),
    ).toEqual({ kind: "aux", input: 1 });
    expect(
      resolveChannelSource({ sourceValue: 64, inBlocks: OFF_BLOCKS, userRoutIn: NO_USER_ROUT }),
    ).toEqual({ kind: "bus", bus: 16 });
  });
});

describe("resolveChannelSource — input slots (step 3)", () => {
  it("slot 12 with IN/9-16 = 5 (A9-16) -> aes50 A12", () => {
    const inBlocks: InBlockValues = [0, 5, 0, 0];
    expect(
      resolveChannelSource({ sourceValue: 12, inBlocks, userRoutIn: NO_USER_ROUT }),
    ).toEqual({ kind: "aes50", bus: "A", channel: 12 });
  });

  it("AN block: slot 3 with IN/1-8 = 0 (AN1-8) -> local 3", () => {
    const inBlocks: InBlockValues = [0, 0, 0, 0];
    expect(resolveChannelSource({ sourceValue: 3, inBlocks, userRoutIn: NO_USER_ROUT })).toEqual({
      kind: "local",
      input: 3,
    });
  });

  it("B block: slot 30 with IN/25-32 = 10 (B1-8) -> aes50 B6", () => {
    const inBlocks: InBlockValues = [0, 0, 0, 10];
    expect(resolveChannelSource({ sourceValue: 30, inBlocks, userRoutIn: NO_USER_ROUT })).toEqual({
      kind: "aes50",
      bus: "B",
      channel: 6,
    });
  });

  it("CARD block: slot 19 with IN/17-24 = 16 (CARD1-8) -> card 3", () => {
    const inBlocks: InBlockValues = [0, 0, 16, 0];
    expect(resolveChannelSource({ sourceValue: 19, inBlocks, userRoutIn: NO_USER_ROUT })).toEqual({
      kind: "card",
      input: 3,
    });
  });

  it("boundary: slot 32 with IN/25-32 = 9 (A41-48) -> aes50 A48 (top of both the block and the bus)", () => {
    const inBlocks: InBlockValues = [0, 0, 0, 9];
    expect(resolveChannelSource({ sourceValue: 32, inBlocks, userRoutIn: NO_USER_ROUT })).toEqual({
      kind: "aes50",
      bus: "A",
      channel: 48,
    });
  });
});

describe("resolveChannelSource — User In indirection (step 3, UIN branch)", () => {
  it("slot 20 with IN/17-24 = 22 (UIN17-24) and userrout[20] = 55 -> aes50 A23", () => {
    // The IN block enum's UIN range is 20-23 = UIN1-8..UIN25-32 (docs/x32-protocol.md's
    // table), so UIN17-24 is block value 22, not 20 - easy to conflate with the
    // *slot* number, which is also 20 here.
    const inBlocks: InBlockValues = [0, 0, 22, 0];
    const userRoutIn = [...NO_USER_ROUT];
    userRoutIn[19] = 55; // slot 20 -> index 19
    expect(resolveChannelSource({ sourceValue: 20, inBlocks, userRoutIn })).toEqual({
      kind: "aes50",
      bus: "A",
      channel: 23,
    });
  });

  it("a User In slot mapped to off resolves to off", () => {
    const inBlocks: InBlockValues = [20, 0, 0, 0];
    const userRoutIn = [...NO_USER_ROUT];
    userRoutIn[0] = 0; // slot 1 -> off
    expect(resolveChannelSource({ sourceValue: 1, inBlocks, userRoutIn })).toEqual({ kind: "off" });
  });

  it("boundary: slot 32 with IN/25-32 = 23 (UIN25-32) resolves via userrout slot 32 (top of both ranges)", () => {
    const inBlocks: InBlockValues = [0, 0, 0, 23];
    const userRoutIn = [...NO_USER_ROUT];
    userRoutIn[31] = 1; // slot 32 -> index 31 -> local 1
    expect(resolveChannelSource({ sourceValue: 32, inBlocks, userRoutIn })).toEqual({
      kind: "local",
      input: 1,
    });
  });
});

describe("affectedChannelsForInBlockChange", () => {
  it("returns exactly the channels whose source names a slot in that block's range", () => {
    // CH1 -> slot 3 (in block 0, 1-8); CH2 -> slot 9 (block 1, 9-16); CH3 -> slot 8 (block 0).
    const sourceValues = [3, 9, 8];
    expect(affectedChannelsForInBlockChange(sourceValues, 0)).toEqual([1, 3]);
    expect(affectedChannelsForInBlockChange(sourceValues, 1)).toEqual([2]);
  });

  it("excludes channels that are off or on a mixer-internal source", () => {
    const sourceValues = [0, 49]; // off, bus 1 — neither is an input slot
    expect(affectedChannelsForInBlockChange(sourceValues, 0)).toEqual([]);
  });
});

describe("affectedChannelsForUserRoutChange", () => {
  it("returns only channels currently routed through the changed User In slot", () => {
    // CH1 -> slot 20 (block 2 = IN/17-24, value 22 = UIN17-24, k=3 -> u=17+3=20)
    // CH2 -> slot 21 (same block, k=4 -> u=21) — a different User In slot.
    // CH3 -> slot 5 (block 0 = IN/1-8, value 0 = AN1-8) — not User In at all.
    const inBlocks: InBlockValues = [0, 0, 22, 0];
    const sourceValues = [20, 21, 5];

    expect(affectedChannelsForUserRoutChange(sourceValues, inBlocks, 20)).toEqual([1]);
    expect(affectedChannelsForUserRoutChange(sourceValues, inBlocks, 21)).toEqual([2]);
    expect(affectedChannelsForUserRoutChange(sourceValues, inBlocks, 5)).toEqual([]);
  });

  it("a userrout slot with no current consumer affects nothing", () => {
    const inBlocks: InBlockValues = [20, 0, 0, 0];
    const sourceValues = [1]; // CH1 -> slot 1, block 0 = UIN1-8, u = 1
    expect(affectedChannelsForUserRoutChange(sourceValues, inBlocks, 2)).toEqual([]);
  });
});

describe("X32State", () => {
  it("resolves a channel from applied raw values", () => {
    const state = new X32State();
    state.setInBlock(1, 5); // IN/9-16 = A9-16
    state.setChannelSource(12, 12); // CH12 source = slot 12
    expect(state.resolveChannel(12)).toEqual({ kind: "aes50", bus: "A", channel: 12 });
  });

  it("toSnapshot returns all 32 channels with names and resolved sources", () => {
    const state = new X32State();
    state.setChannelName(1, "Kick In");
    state.setChannelSource(1, 1); // AN1-8 default block -> local 1
    const snapshot = state.toSnapshot();

    expect(snapshot.channels).toHaveLength(32);
    expect(snapshot.channels[0]).toEqual({
      channel: 1,
      name: "Kick In",
      source: { kind: "local", input: 1 },
    });
    // Untouched channels still resolve — default source value 0 -> off.
    expect(snapshot.channels[31]).toEqual({ channel: 32, name: "", source: { kind: "off" } });
    expect(snapshot.selectedChannel).toBeNull();
  });

  it("selectedChannel reflects setSelIdx per the doc's mapping", () => {
    const state = new X32State();
    state.setSelIdx(11);
    expect(state.selectedChannel()).toBe(12);
    state.setSelIdx(32);
    expect(state.selectedChannel()).toBeNull();
  });

  it("isPlaybackRoutingActive reflects the current routswitch value", () => {
    // x32MixerClient.ts edge-detects the REC -> PLAY transition itself, by
    // reading this before and after calling setRoutSwitch.
    const state = new X32State();
    expect(state.isPlaybackRoutingActive()).toBe(false);
    state.setRoutSwitch(0);
    expect(state.isPlaybackRoutingActive()).toBe(false);
    state.setRoutSwitch(1);
    expect(state.isPlaybackRoutingActive()).toBe(true);
    state.setRoutSwitch(0);
    expect(state.isPlaybackRoutingActive()).toBe(false);
  });

  it("channelsAffectedBy* delegate to the free functions using current state", () => {
    const state = new X32State();
    state.setInBlock(0, 20); // IN/1-8 = UIN1-8
    state.setChannelSource(1, 3); // CH1 -> slot 3 -> User In slot 3

    expect(state.channelsAffectedByInBlockChange(0)).toEqual([1]);
    expect(state.channelsAffectedByUserRoutChange(3)).toEqual([1]);
    expect(state.channelsAffectedByUserRoutChange(4)).toEqual([]);
  });

  it("rejects an out-of-range channel number (a caller bug, not wire data)", () => {
    const state = new X32State();
    expect(() => state.setChannelSource(0, 5)).toThrow(/Invalid X32 channel/);
    expect(() => state.setChannelSource(33, 5)).toThrow(/Invalid X32 channel/);
  });
});

describe("sourceRefEquals", () => {
  it("treats two structurally identical refs as equal", () => {
    expect(sourceRefEquals({ kind: "off" }, { kind: "off" })).toBe(true);
    expect(
      sourceRefEquals(
        { kind: "aes50", bus: "A", channel: 12 },
        { kind: "aes50", bus: "A", channel: 12 },
      ),
    ).toBe(true);
    expect(sourceRefEquals({ kind: "local", input: 3 }, { kind: "local", input: 3 })).toBe(true);
    expect(sourceRefEquals({ kind: "talkback", which: "int" }, { kind: "talkback", which: "int" })).toBe(
      true,
    );
  });

  it("treats a different kind as unequal", () => {
    expect(sourceRefEquals({ kind: "off" }, { kind: "local", input: 1 })).toBe(false);
  });

  it("treats the same kind with different fields as unequal", () => {
    expect(
      sourceRefEquals(
        { kind: "aes50", bus: "A", channel: 12 },
        { kind: "aes50", bus: "A", channel: 13 },
      ),
    ).toBe(false);
    expect(
      sourceRefEquals(
        { kind: "aes50", bus: "A", channel: 12 },
        { kind: "aes50", bus: "B", channel: 12 },
      ),
    ).toBe(false);
    expect(sourceRefEquals({ kind: "usb", side: "L" }, { kind: "usb", side: "R" })).toBe(false);
  });
});
