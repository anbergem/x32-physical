/**
 * The state boundary of architecture.md §5, asserted by object identity.
 *
 * This is the plan's "Selection change mutates runtime state only" checklist
 * item: the route index is derived from topology + mixer configuration, and a
 * selection, a hover or a connection blip must never rebuild it. Identity, not
 * deep equality, is the whole point — an equal-but-new index would invalidate
 * every memoised highlight lookup in steps 7–8.
 */

import type { MixerChannelState } from "@x32/domain";
import { endpointId, mixerChannelId, panelInput } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";

import { createAppStore } from "./store";

const CH7 = mixerChannelId(7);
const CH12 = mixerChannelId(12);

function channel(
  number: number,
  name: string,
  aes50: number,
): MixerChannelState {
  return {
    channel: mixerChannelId(number),
    name,
    source: { kind: "aes50", bus: "A", channel: aes50 },
  };
}

function createStore() {
  return createAppStore(venueInstallation(), [
    channel(7, "OH R", 7),
    channel(12, "Keys R", 12),
  ]);
}

describe("createAppStore", () => {
  it("derives the route index from installation and channels at creation", () => {
    const { routeIndex } = createStore().getState();

    // AES50-A 7 is stagebox-1 input 7, cabled from front-left socket 7.
    expect(routeIndex.byMixerChannel.get(CH7)?.physicalInputs).toEqual([
      panelInput("front-left", 7),
    ]);
    expect(routeIndex.byMixerChannel.get(CH7)?.endpoints).toContain(
      endpointId(panelInput("front-left", 7)),
    );
  });

  it("applies a snapshot to the configuration and runtime slices at once", () => {
    const store = createStore();
    const before = store.getState().routeIndex;

    store.getState().applySnapshot(
      {
        channels: [channel(12, "Keys R", 8)],
        selectedChannel: CH12,
      },
      "connected",
    );

    const state = store.getState();
    expect(state.channels).toHaveLength(1);
    expect(state.selectedChannel).toBe(CH12);
    expect(state.connection).toBe("connected");
    expect(state.routeIndex).not.toBe(before);
    expect(state.routeIndex.byMixerChannel.get(CH12)?.physicalInputs).toEqual([
      panelInput("front-left", 8),
    ]);
  });
});

describe("runtime slice", () => {
  it("selection change mutates runtime state only", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);

    const after = store.getState();
    expect(after.selectedChannel).toBe(CH12);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
    expect(after.installation).toBe(before.installation);
  });

  it("hover change mutates runtime state only", () => {
    const store = createStore();
    const before = store.getState();
    const endpoint = endpointId(panelInput("front-left", 3));

    store.getState().setHoveredEndpoint(endpoint);

    const after = store.getState();
    expect(after.hoveredEndpoint).toBe(endpoint);
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });

  it("connection change mutates runtime state only", () => {
    const store = createStore();
    store.getState().setSelectedChannel(CH12);
    const before = store.getState();

    store.getState().setConnection("disconnected");

    const after = store.getState();
    expect(after.connection).toBe("disconnected");
    // A dropped console keeps the last known routing on screen, selection
    // included — there is nothing new to know until it comes back.
    expect(after.selectedChannel).toBe(CH12);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });

  it("ignores a write that changes nothing", () => {
    const store = createStore();
    store.getState().setSelectedChannel(CH12);
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);

    expect(store.getState()).toBe(before);
  });
});

describe("configuration slice", () => {
  it("rebuilds the route index when a channel's source changes", () => {
    const store = createStore();
    const before = store.getState();

    store
      .getState()
      .setChannelSource(CH12, { kind: "aes50", bus: "A", channel: 8 });

    const after = store.getState();
    expect(after.routeIndex).not.toBe(before.routeIndex);
    expect(after.routeIndex.byMixerChannel.get(CH12)?.physicalInputs).toEqual([
      panelInput("front-left", 8),
    ]);
    expect(after.installation).toBe(before.installation);
  });

  it("keeps every other channel's identity when one is renamed", () => {
    const store = createStore();
    const untouched = store
      .getState()
      .channels.find((state) => state.channel === CH12);

    store.getState().setChannelName(CH7, "OH Right");

    const after = store.getState();
    expect(after.channels.find((state) => state.channel === CH7)?.name).toBe(
      "OH Right",
    );
    // Selector discipline (architecture.md §5): renaming CH7 must leave CH12's
    // object identical, so a strip subscribed to CH12 does not rerender.
    expect(after.channels.find((state) => state.channel === CH12)).toBe(
      untouched,
    );
  });

  it("ignores an event for a channel it does not have", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setChannelName(mixerChannelId(31), "Ghost");

    expect(store.getState()).toBe(before);
  });
});
