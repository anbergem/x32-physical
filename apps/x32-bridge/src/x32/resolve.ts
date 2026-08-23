/**
 * X32 raw state model + resolution (docs/x32-protocol.md §Resolution
 * algorithm; architecture.md §3 "Design choice"). Pure — no sockets, no
 * timers, no console I/O — so it is testable without a transport.
 *
 * `X32State` holds exactly the raw values the bridge tracks (32 names, 32
 * `config/source` values, the 4 IN block values, 32 `userrout/in` values,
 * `routswitch`, `selidx`) and resolves them into the flat `MixerSourceRef`
 * shape the rest of the codebase consumes — the "adapter resolves the
 * two-level indirection" design point from architecture.md §3. All X32
 * 0-based/1-based translation happens in this file and `osc-tables.ts`,
 * nowhere else in the repo.
 */

import type { MixerChannelId, MixerChannelState, MixerSourceRef } from "@x32/domain";
import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";

import {
  classifyChannelSourceValue,
  IN_BLOCK_TABLE,
  inBlockPositionOf,
  inBlockQuarterOf,
  resolveUserRoutValue,
  selIdxToChannel,
} from "./osc-tables";

export const IN_BLOCK_COUNT = 4;

/** The 4 raw `/config/routing/IN/*` values, index 0 = `1-8` … index 3 = `25-32`. */
export type InBlockValues = readonly [number, number, number, number];

export interface ChannelResolutionInputs {
  /** `/ch/NN/config/source`. */
  sourceValue: number;
  inBlocks: InBlockValues;
  /** `/config/userrout/in/01…32`, index 0 = slot 1. */
  userRoutIn: readonly number[];
}

/**
 * The resolution algorithm from docs/x32-protocol.md §Resolution, exactly:
 * channel source enum → input slot → IN block enum (AN/A/B/CARD/UIN ranges)
 * → optional userrout indirection → `MixerSourceRef`. Never throws: any
 * value outside the documented ranges resolves to `{ kind: "off" }` rather
 * than crash the bridge over one corrupt or unexpected wire value (matches
 * `osc-tables.ts`'s stance).
 */
export function resolveChannelSource(inputs: ChannelResolutionInputs): MixerSourceRef {
  const category = classifyChannelSourceValue(inputs.sourceValue);

  switch (category.kind) {
    case "off":
      return { kind: "off" };
    case "aux":
      return { kind: "aux", input: category.input };
    case "usb":
      return { kind: "usb", side: category.side };
    case "fx":
      return { kind: "fx", ret: category.ret };
    case "bus":
      return { kind: "bus", bus: category.bus };
    case "input-slot": {
      const quarter = inBlockQuarterOf(category.slot);
      const blockValue = inputs.inBlocks[quarter];
      const entry = IN_BLOCK_TABLE[blockValue];
      if (entry === undefined) return { kind: "off" }; // out-of-spec block enum

      const k = inBlockPositionOf(category.slot);
      switch (entry.kind) {
        case "local":
          return { kind: "local", input: entry.base + k };
        case "aes50":
          return { kind: "aes50", bus: entry.bus, channel: entry.base + k };
        case "card":
          return { kind: "card", input: entry.base + k };
        case "userin": {
          const slot = entry.base + k; // User In slot, 1–32
          const rawValue = inputs.userRoutIn[slot - 1] ?? 0;
          const target = resolveUserRoutValue(rawValue);
          switch (target.kind) {
            case "off":
              return { kind: "off" };
            case "local":
              return { kind: "local", input: target.input };
            case "aes50":
              return { kind: "aes50", bus: target.bus, channel: target.channel };
            case "card":
              return { kind: "card", input: target.input };
            case "aux":
              return { kind: "aux", input: target.input };
            case "talkback":
              return { kind: "talkback", which: target.which };
          }
        }
      }
    }
  }
}

/**
 * Structural equality for `MixerSourceRef`. A scene recall on the console
 * commonly re-sends an IN block or userrout value that hasn't actually
 * changed; the client uses this to skip emitting a no-op
 * `channel-source-changed` for a channel whose re-resolved source is
 * identical to what it already was.
 */
export function sourceRefEquals(a: MixerSourceRef, b: MixerSourceRef): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "off":
      return true;
    case "aes50":
      return b.kind === "aes50" && a.bus === b.bus && a.channel === b.channel;
    case "local":
      return b.kind === "local" && a.input === b.input;
    case "card":
      return b.kind === "card" && a.input === b.input;
    case "aux":
      return b.kind === "aux" && a.input === b.input;
    case "usb":
      return b.kind === "usb" && a.side === b.side;
    case "fx":
      return b.kind === "fx" && a.ret === b.ret;
    case "bus":
      return b.kind === "bus" && a.bus === b.bus;
    case "talkback":
      return b.kind === "talkback" && a.which === b.which;
  }
}

function isInputSlotInRange(sourceValue: number, start: number, end: number): number | null {
  const category = classifyChannelSourceValue(sourceValue);
  if (category.kind !== "input-slot") return null;
  return category.slot >= start && category.slot <= end ? category.slot : null;
}

/**
 * Change-fanout for a `/config/routing/IN/*` block: every channel whose
 * `config/source` currently names an input slot inside that block's 8-slot
 * range (docs/x32-protocol.md: "up to 8" — exactly the channels affected,
 * computed from the actual current state rather than assumed).
 */
export function affectedChannelsForInBlockChange(
  sourceValues: readonly number[],
  blockIndex: 0 | 1 | 2 | 3,
): number[] {
  const start = blockIndex * 8 + 1;
  const end = start + 7;
  const affected: number[] = [];
  for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
    const value = sourceValues[channel - 1] ?? 0;
    if (isInputSlotInRange(value, start, end) !== null) affected.push(channel);
  }
  return affected;
}

/**
 * Change-fanout for a `/config/userrout/in/NN` slot: every channel whose
 * resolved chain currently passes through that slot — i.e. its `config/source`
 * names an input slot whose IN block is a `UIN` block, and that block's
 * `base + k` equals the changed slot.
 */
export function affectedChannelsForUserRoutChange(
  sourceValues: readonly number[],
  inBlocks: InBlockValues,
  slot: number,
): number[] {
  const affected: number[] = [];
  for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
    const value = sourceValues[channel - 1] ?? 0;
    const category = classifyChannelSourceValue(value);
    if (category.kind !== "input-slot") continue;

    const quarter = inBlockQuarterOf(category.slot);
    const entry = IN_BLOCK_TABLE[inBlocks[quarter]];
    if (entry?.kind !== "userin") continue;

    const k = inBlockPositionOf(category.slot);
    if (entry.base + k === slot) affected.push(channel);
  }
  return affected;
}

function requireChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 1 || channel > MIXER_CHANNEL_COUNT) {
    throw new Error(`Invalid X32 channel ${channel}: expected an integer between 1 and ${MIXER_CHANNEL_COUNT}.`);
  }
}

function requireBlockIndex(blockIndex: number): asserts blockIndex is 0 | 1 | 2 | 3 {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 3) {
    throw new Error(`Invalid IN block index ${blockIndex}: expected an integer between 0 and 3.`);
  }
}

function requireUserRoutSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > MIXER_CHANNEL_COUNT) {
    throw new Error(`Invalid User In slot ${slot}: expected an integer between 1 and ${MIXER_CHANNEL_COUNT}.`);
  }
}

/**
 * The bridge's mutable copy of everything docs/x32-protocol.md tracks.
 * Setters validate their own structural parameters (channel/block/slot
 * numbers) as an internal caller contract — `addresses.ts`'s parser is the
 * only thing that calls them, and it can only ever produce values in range,
 * so a violation here is a programming bug, not a wire-data surprise (unlike
 * the wire *values* handled by `osc-tables.ts`, which degrade gracefully).
 */
export class X32State {
  #channelNames: string[] = Array.from({ length: MIXER_CHANNEL_COUNT }, () => "");
  #channelSources: number[] = Array.from({ length: MIXER_CHANNEL_COUNT }, () => 0);
  #inBlocks: [number, number, number, number] = [0, 0, 0, 0];
  #userRoutIn: number[] = Array.from({ length: MIXER_CHANNEL_COUNT }, () => 0);
  #routSwitch = 0;
  /** -1 = "not yet known" — resolves to no selection via `selIdxToChannel`. */
  #selIdx = -1;

  setChannelName(channel: number, name: string): void {
    requireChannel(channel);
    this.#channelNames[channel - 1] = name;
  }

  setChannelSource(channel: number, value: number): void {
    requireChannel(channel);
    this.#channelSources[channel - 1] = value;
  }

  setInBlock(blockIndex: number, value: number): void {
    requireBlockIndex(blockIndex);
    this.#inBlocks[blockIndex] = value;
  }

  setUserRoutIn(slot: number, value: number): void {
    requireUserRoutSlot(slot);
    this.#userRoutIn[slot - 1] = value;
  }

  /** `routswitch`: 0 = REC (the `IN` blocks are active), 1 = PLAY. */
  setRoutSwitch(value: number): void {
    this.#routSwitch = value;
  }

  /**
   * `x32MixerClient.ts` reads this before and after `setRoutSwitch` to
   * edge-detect the REC → PLAY transition (docs/x32-protocol.md) and log its
   * "playback routing active" warning exactly once per transition rather
   * than on every read or liveness poll.
   */
  isPlaybackRoutingActive(): boolean {
    return this.#routSwitch === 1;
  }

  setSelIdx(value: number): void {
    this.#selIdx = value;
  }

  selectedChannel(): MixerChannelId | null {
    const channel = selIdxToChannel(this.#selIdx);
    return channel === null ? null : mixerChannelId(channel);
  }

  resolveChannel(channel: number): MixerSourceRef {
    requireChannel(channel);
    return resolveChannelSource({
      sourceValue: this.#channelSources[channel - 1] ?? 0,
      inBlocks: this.#inBlocks,
      userRoutIn: this.#userRoutIn,
    });
  }

  channelsAffectedByInBlockChange(blockIndex: number): number[] {
    requireBlockIndex(blockIndex);
    return affectedChannelsForInBlockChange(this.#channelSources, blockIndex);
  }

  channelsAffectedByUserRoutChange(slot: number): number[] {
    requireUserRoutSlot(slot);
    return affectedChannelsForUserRoutChange(this.#channelSources, this.#inBlocks, slot);
  }

  toSnapshot(): MixerSnapshot {
    const channels: MixerChannelState[] = [];
    for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
      channels.push({
        channel: mixerChannelId(channel),
        name: this.#channelNames[channel - 1] ?? "",
        source: this.resolveChannel(channel),
      });
    }
    return { channels, selectedChannel: this.selectedChannel() };
  }
}
