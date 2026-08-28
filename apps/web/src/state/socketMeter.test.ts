/**
 * Socket-level meters at the selector level (no DOM) — the fourth, fastest
 * state path (architecture.md §5) extended onto panel/stagebox sockets.
 *
 * `selectSocketMeterLevel` answers "is signal arriving here" for a physical
 * socket by taking the *maximum* level among the mixer channels consuming it
 * (never a sum or an average — a mixed level would be invented, not read).
 * A socket no channel consumes gets no bar at all: `null`, not zero.
 *
 * The mock's default snapshot (mixer-contracts) is faithful to the real patch
 * sheet and has no dual-consumer channel by default, so the dual-consumer
 * case below builds its own local fixture, same pattern as hover.test.ts.
 */

import type { EndpointId, MixerChannelState } from "@x32/domain";
import { endpointId, mixerChannelId, panelInput } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { selectSocketMeterLevel } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

const installation = exampleRig();

const CH5 = mixerChannelId(5); // "Vox 1" · AES50-A 1 · front-left socket 1
const CH6 = mixerChannelId(6); // "Vox 2" · AES50-A 2 · front-left socket 2

// front-left socket 1 -> stagebox-1 input 1 -> AES50-A 1, consumed by CH5 only.
const SOLE_CONSUMER_SOCKET = endpointId(panelInput("front-left", 1));
// front-left socket 7 -> AES50-A 7, left unconsumed in the default snapshot.
const UNCONSUMED_SOCKET = endpointId(panelInput("front-left", 7));

function levelsFor(overrides: Partial<Record<number, number>>): number[] {
  const levels = new Array(32).fill(0);
  for (const [channel, level] of Object.entries(overrides)) {
    levels[Number(channel) - 1] = level;
  }
  return levels;
}

function defaultStore(): AppStore {
  return createAppStore(installation, createDefaultMockSnapshot().channels);
}

/** A local fixture: CH5 and CH6 both forced onto AES50-A 1 (front-left socket 1). */
function dualConsumerChannels(): MixerChannelState[] {
  const { channels } = createDefaultMockSnapshot();
  return channels.map((channel) =>
    channel.channel === CH6
      ? { ...channel, source: { kind: "aes50", bus: "A", channel: 1 } }
      : channel,
  );
}

function statusOf(store: AppStore, endpoint: EndpointId) {
  return selectSocketMeterLevel(endpoint)(store.getState());
}

describe("selectSocketMeterLevel", () => {
  it("returns the consuming channel's level for a socket with one consumer", () => {
    const store = defaultStore();
    store.getState().setMeterLevels(levelsFor({ [CH5]: 0.6 }));

    expect(statusOf(store, SOLE_CONSUMER_SOCKET)).toBe(0.6);
  });

  it("returns the maximum level for a socket with two consumers", () => {
    const store = createAppStore(installation, dualConsumerChannels());
    store.getState().setMeterLevels(levelsFor({ [CH5]: 0.3, [CH6]: 0.9 }));

    expect(statusOf(store, SOLE_CONSUMER_SOCKET)).toBe(0.9);

    // Order must not matter — the higher level wins whichever channel it's on.
    store.getState().setMeterLevels(levelsFor({ [CH5]: 0.9, [CH6]: 0.3 }));
    expect(statusOf(store, SOLE_CONSUMER_SOCKET)).toBe(0.9);
  });

  it("returns null for a socket no channel consumes", () => {
    const store = defaultStore();
    store.getState().setMeterLevels(levelsFor({ [CH5]: 0.6 }));

    expect(statusOf(store, UNCONSUMED_SOCKET)).toBeNull();
  });

  it("returns null for every endpoint when meters are not flowing at all", () => {
    const store = defaultStore();

    expect(store.getState().meterLevels).toBeNull();
    expect(statusOf(store, SOLE_CONSUMER_SOCKET)).toBeNull();
    expect(statusOf(store, UNCONSUMED_SOCKET)).toBeNull();
  });
});
