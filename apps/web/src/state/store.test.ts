/**
 * The state boundary of architecture.md §5, asserted by object identity.
 *
 * This is the plan's "Selection change mutates runtime state only" checklist
 * item: the route index is derived from topology + mixer configuration, and a
 * selection, a hover or a connection blip must never rebuild it. Identity, not
 * deep equality, is the whole point — an equal-but-new index would invalidate
 * every memoised highlight lookup in steps 7–8.
 */

import type { Installation, MixerChannelState, MixerOutputState } from "@x32/domain";
import {
  consoleOutput,
  destination,
  deviceId,
  endpointId,
  mixerChannelId,
  panelInput,
  stageboxOutput,
} from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

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
  return createAppStore(exampleRig(), [
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
    // A hover already in progress when the console SELECTs a channel must
    // survive untouched — selection and hover are independent runtime state
    // (architecture.md §5).
    const hovered = endpointId(panelInput("front-left", 4));
    store.getState().setHoveredEndpoint(hovered);
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);

    const after = store.getState();
    expect(after.selectedChannel).toBe(CH12);
    expect(after.hoveredEndpoint).toBe(hovered);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
    expect(after.installation).toBe(before.installation);
  });

  it("hover change mutates runtime state only", () => {
    const store = createStore();
    // A real selection in place, so "preserves selectedChannel" below is not
    // just two nulls agreeing — it comes from the physical console and
    // hovering must never touch it (architecture.md §5).
    store.getState().setSelectedChannel(CH7);
    const before = store.getState();
    const endpoint = endpointId(panelInput("front-left", 3));

    store.getState().setHoveredEndpoint(endpoint);

    const after = store.getState();
    expect(after.hoveredEndpoint).toBe(endpoint);
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);

    // Moving between endpoints — what a pointer sweeping the schematic does
    // dozens of times a second — must stay just as cheap.
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    expect(store.getState().routeIndex).toBe(before.routeIndex);
    expect(store.getState().channels).toBe(before.channels);
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

  it("does not rebuild the route index when a channel is renamed", () => {
    const store = createStore();
    const before = store.getState();
    const untouched = before.channels.find((state) => state.channel === CH12);

    store.getState().setChannelName(CH7, "OH Right");

    const after = store.getState();
    expect(after.channels.find((state) => state.channel === CH7)?.name).toBe(
      "OH Right",
    );
    // A name is not part of a route: the index — and every highlight lookup
    // memoised on it — survives a rename untouched (architecture.md §5).
    expect(after.routeIndex).toBe(before.routeIndex);
    // Selector discipline: renaming CH7 must leave CH12's object identical,
    // so a strip subscribed to CH12 does not rerender.
    expect(after.channels.find((state) => state.channel === CH12)).toBe(
      untouched,
    );
  });

  it("rebuilds once when the same source is applied twice", () => {
    const store = createStore();
    const source = { kind: "aes50", bus: "A", channel: 8 } as const;

    store.getState().setChannelSource(CH12, source);
    const afterFirst = store.getState();

    // The X32 adapter fans one input-block change out to eight events, most of
    // them carrying the source that channel already had.
    store.getState().setChannelSource(CH12, { ...source });

    expect(store.getState()).toBe(afterFirst);
    expect(store.getState().routeIndex).toBe(afterFirst.routeIndex);
  });

  it("ignores an event for a channel it does not have", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setChannelName(mixerChannelId(31), "Ghost");

    expect(store.getState()).toBe(before);
  });
});

/**
 * `baseline`/`discrepancies` (architecture.md §5/§7, plan step 13): a second
 * derived-value pair with its own invalidation, independent of `routeIndex`.
 * `discrepancies` depends on (channels, baseline) via `compareRouting` — a
 * rename or a baseline change recomputes it without ever touching
 * `routeIndex`, and runtime writes leave both alone.
 */
/**
 * `meterLevels` (architecture.md §5, plan step 15): a fourth, fastest state
 * path, disjoint from all the others in both directions.
 */
describe("meters slice", () => {
  it("starts with no meter levels", () => {
    expect(createStore().getState().meterLevels).toBeNull();
  });

  it("setMeterLevels touches only meterLevels — every other slice keeps its identity", () => {
    const store = createStore();
    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    const before = store.getState();

    store.getState().setMeterLevels(new Array(32).fill(0.42));

    const after = store.getState();
    expect(after.meterLevels).toEqual(new Array(32).fill(0.42));
    expect(after.channels).toBe(before.channels);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
    expect(after.baseline).toBe(before.baseline);
    expect(after.installation).toBe(before.installation);
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.hoveredEndpoint).toBe(before.hoveredEndpoint);
    expect(after.connection).toBe(before.connection);
  });

  it("setMeterLevels(null) clears the slice without touching anything else", () => {
    const store = createStore();
    store.getState().setMeterLevels([1, 2, 3]);
    const before = store.getState();

    store.getState().setMeterLevels(null);

    expect(store.getState().meterLevels).toBeNull();
    expect(store.getState().channels).toBe(before.channels);
    expect(store.getState().routeIndex).toBe(before.routeIndex);
  });

  it("no other setter ever touches meterLevels", () => {
    const store = createStore();
    store.getState().setMeterLevels([9, 9, 9]);
    const before = store.getState().meterLevels;

    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setConnection("disconnected");
    store.getState().setChannelName(CH7, "Renamed");
    store.getState().setChannelSource(CH12, { kind: "aes50", bus: "A", channel: 9 });
    store.getState().setBaseline({ channels: [], selectedChannel: null });

    expect(store.getState().meterLevels).toBe(before);
  });
});

describe("baseline / discrepancies slice", () => {
  function baselineSnapshot(channels: MixerChannelState[]): MixerSnapshot {
    return { channels, selectedChannel: null };
  }

  it("starts with no baseline and no discrepancies", () => {
    const state = createStore().getState();
    expect(state.baseline).toBeNull();
    expect(state.discrepancies).toEqual([]);
  });

  it("setBaseline with a matching baseline yields no discrepancies", () => {
    const store = createStore();
    const before = store.getState();

    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 12)]));

    const after = store.getState();
    expect(after.discrepancies).toEqual([]);
    // Only `discrepancies` (and `baseline`) change — routeIndex is untouched.
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });

  it("setBaseline with a source mismatch surfaces a source-mismatch discrepancy, without rebuilding routeIndex", () => {
    const store = createStore();
    const before = store.getState();

    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 8)]));

    const after = store.getState();
    expect(after.discrepancies).toEqual([
      expect.objectContaining({ kind: "source-mismatch", channel: CH12 }),
    ]);
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("setBaseline with only a name difference surfaces a name-mismatch discrepancy", () => {
    const store = createStore();

    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "Old Name", 7), channel(12, "Keys R", 12)]));

    expect(store.getState().discrepancies).toEqual([
      expect.objectContaining({ kind: "name-mismatch", channel: CH7 }),
    ]);
  });

  it("selection/hover/connection changes preserve baseline and discrepancies identity", () => {
    const store = createStore();
    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 8)]));
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setConnection("disconnected");

    const after = store.getState();
    expect(after.baseline).toBe(before.baseline);
    expect(after.discrepancies).toBe(before.discrepancies);
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("a channel-source change recomputes discrepancies (and routeIndex)", () => {
    const store = createStore();
    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 8)]));
    const before = store.getState();
    expect(before.discrepancies).toHaveLength(1); // the CH12 source-mismatch

    // Bring CH12's live source in line with the baseline.
    store.getState().setChannelSource(CH12, { kind: "aes50", bus: "A", channel: 8 });

    const after = store.getState();
    expect(after.discrepancies).toEqual([]);
    expect(after.routeIndex).not.toBe(before.routeIndex);
  });

  it("a rename recomputes discrepancies (names are compared) but not routeIndex", () => {
    const store = createStore();
    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 12)]));
    const before = store.getState();
    expect(before.discrepancies).toEqual([]);

    store.getState().setChannelName(CH7, "Overhead Right");

    const after = store.getState();
    expect(after.discrepancies).toEqual([
      expect.objectContaining({ kind: "name-mismatch", channel: CH7 }),
    ]);
    // The whole point: a rename never rebuilds the route index.
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("applySnapshot recomputes discrepancies against the existing baseline", () => {
    const store = createStore();
    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 12)]));

    store.getState().applySnapshot(
      { channels: [channel(12, "Keys R", 9)], selectedChannel: null },
      "connected",
    );

    const after = store.getState();
    expect(after.discrepancies).toEqual([
      expect.objectContaining({ kind: "source-mismatch", channel: CH12 }),
    ]);
  });

  it("setBaseline(null) clears discrepancies without touching routeIndex", () => {
    const store = createStore();
    store
      .getState()
      .setBaseline(baselineSnapshot([channel(7, "OH R", 7), channel(12, "Keys R", 8)]));
    const before = store.getState();
    expect(before.discrepancies).toHaveLength(1);

    store.getState().setBaseline(null);

    const after = store.getState();
    expect(after.baseline).toBeNull();
    expect(after.discrepancies).toEqual([]);
    expect(after.routeIndex).toBe(before.routeIndex);
  });
});

/**
 * AES50 link state + detected chain (issue #17): config lifecycle, like
 * `baseline` — never the fast runtime path, and neither ever touches
 * `routeIndex`.
 */
describe("aes50 slice", () => {
  it("starts with no link state and no chain data", () => {
    const state = createStore().getState();
    expect(state.aes50LinkState).toBeNull();
    expect(state.aes50Chain).toEqual([]);
    expect(state.aes50ChainDiscrepancies).toEqual([]);
  });

  it("setAes50LinkState sets the slice and leaves routeIndex/discrepancies untouched", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setAes50LinkState({
      buses: [
        { bus: "A", audioError: true, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });

    const after = store.getState();
    expect(after.aes50LinkState?.buses[0]).toEqual({ bus: "A", audioError: true, auxError: false });
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
  });

  it("setAes50Chain replaces one bus's entry and recomputes aes50ChainDiscrepancies, without touching routeIndex", () => {
    const store = createStore();
    const before = store.getState();

    // Only 1 box detected on AES50-A, but the venue fixture declares 2 stageboxes.
    store.getState().setAes50Chain({
      bus: "A",
      boxes: [{ position: 1, model: "S16", rawLetter: "A" }],
    });

    const after = store.getState();
    expect(after.aes50ChainDiscrepancies).toEqual([
      { kind: "box-count-mismatch", bus: "A", expected: 2, actual: 1 },
    ]);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
  });

  it("applySnapshot populates aes50LinkState/aes50Chain from the snapshot", () => {
    const store = createStore();
    const snapshot: MixerSnapshot = {
      channels: [channel(7, "OH R", 7), channel(12, "Keys R", 12)],
      selectedChannel: null,
      aes50LinkState: {
        buses: [
          { bus: "A", audioError: false, auxError: false },
          { bus: "B", audioError: false, auxError: false },
        ],
        locked: true,
      },
      aes50Chain: [
        {
          bus: "A",
          boxes: [
            { position: 1, model: "S16", rawLetter: "A" },
            { position: 2, model: "S16", rawLetter: "A" },
          ],
        },
      ],
    };

    store.getState().applySnapshot(snapshot, "connected");

    const state = store.getState();
    expect(state.aes50LinkState?.locked).toBe(true);
    expect(state.aes50Chain).toEqual(snapshot.aes50Chain);
    expect(state.aes50ChainDiscrepancies).toEqual([]); // 2 declared, 2 detected S16 — matches
  });

  it("applySnapshot without aes50 fields defaults to null/[] (older bridge / mock without the fields)", () => {
    const store = createStore();
    const snapshot: MixerSnapshot = {
      channels: [channel(7, "OH R", 7), channel(12, "Keys R", 12)],
      selectedChannel: null,
    };

    store.getState().applySnapshot(snapshot, "connected");

    const state = store.getState();
    expect(state.aes50LinkState).toBeNull();
    expect(state.aes50Chain).toEqual([]);
  });

  it("selection/hover/connection changes preserve aes50 slice identity", () => {
    const store = createStore();
    store.getState().setAes50LinkState({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });
    const before = store.getState();

    store.getState().setSelectedChannel(CH7);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 1)));
    store.getState().setConnection("connecting");

    const after = store.getState();
    expect(after.aes50LinkState).toBe(before.aes50LinkState);
    expect(after.aes50Chain).toBe(before.aes50Chain);
    expect(after.aes50ChainDiscrepancies).toBe(before.aes50ChainDiscrepancies);
  });
});

/**
 * `updateAvailable` (architecture.md §7, plan step 20): config lifecycle,
 * like `baseline` — it changes at most a couple of times a day, so it must
 * never sit in the fast runtime path, and setting it must never touch
 * `routeIndex`/`discrepancies`. Mock mode never touches it at all — its
 * default `null` is the only value `LocalMockGateway` ever produces.
 */
describe("updateAvailable slice", () => {
  it("starts null", () => {
    expect(createStore().getState().updateAvailable).toBeNull();
  });

  it("setUpdateAvailable sets the value and leaves every other slice's identity intact", () => {
    const store = createStore();
    const before = store.getState();

    store
      .getState()
      .setUpdateAvailable({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });

    const after = store.getState();
    expect(after.updateAvailable).toEqual({
      version: "0.2.0",
      url: "https://example.com/release/v0.2.0",
    });
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
    expect(after.channels).toBe(before.channels);
    expect(after.baseline).toBe(before.baseline);
  });

  it("ignores a write that changes nothing (same version and url)", () => {
    const store = createStore();
    store
      .getState()
      .setUpdateAvailable({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });
    const before = store.getState();

    store
      .getState()
      .setUpdateAvailable({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });

    expect(store.getState()).toBe(before);
  });

  it("selection/hover/connection changes preserve updateAvailable identity", () => {
    const store = createStore();
    store
      .getState()
      .setUpdateAvailable({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setConnection("disconnected");

    expect(store.getState().updateAvailable).toBe(before.updateAvailable);
  });

  it("no other setter ever touches updateAvailable", () => {
    const store = createStore();
    store
      .getState()
      .setUpdateAvailable({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });
    const before = store.getState().updateAvailable;

    store.getState().setChannelName(CH7, "Overhead Right");
    store.getState().setChannelSource(CH12, { kind: "aes50", bus: "A", channel: 20 });
    store.getState().setBaseline({ channels: [channel(7, "OH R", 7)], selectedChannel: null });
    store.getState().setMeterLevels(new Array(32).fill(0.1));

    expect(store.getState().updateAvailable).toBe(before);
  });
});

describe("outputs slice + outputRouteIndex (issue #11)", () => {
  function outputState(output: number, kind: MixerOutputState["source"]["kind"]): MixerOutputState {
    if (kind === "bus") return { output, source: { kind: "bus", bus: output } };
    return { output, source: { kind: "off" } };
  }

  function storeWithOutputs(outputs: MixerOutputState[]) {
    return createAppStore(exampleRig(), [], outputs);
  }

  it("derives outputRouteIndex from installation and outputs at creation", () => {
    const { outputRouteIndex } = storeWithOutputs([
      { output: 13, source: { kind: "bus", bus: 1 } },
    ]).getState();

    const route = outputRouteIndex.byMixerOutput.get(13);
    expect(route?.destinations).toEqual([destination("fill-left")]);
    expect(route?.endpoints).toContain(
      endpointId(stageboxOutput("stagebox-1", 5)),
    );
  });

  it("setOutputSource rebuilds outputRouteIndex but leaves routeIndex/discrepancies untouched", () => {
    const store = storeWithOutputs([outputState(1, "off")]);
    const before = store.getState();

    store.getState().setOutputSource(1, { kind: "matrix", matrix: 1 });

    const after = store.getState();
    expect(after.outputRouteIndex).not.toBe(before.outputRouteIndex);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
    expect(after.channels).toBe(before.channels);
  });

  it("setOutputSource is a no-op (no rebuild, no listener notification) when the source is structurally unchanged", () => {
    const store = storeWithOutputs([{ output: 7, source: { kind: "bus", bus: 3 } }]);
    const before = store.getState();

    store.getState().setOutputSource(7, { kind: "bus", bus: 3 });

    expect(store.getState()).toBe(before);
  });

  it("applySnapshot carries the snapshot's outputs into the outputs/outputRouteIndex slice", () => {
    const store = createStore();
    const before = store.getState().outputRouteIndex;

    store.getState().applySnapshot(
      {
        channels: [channel(7, "OH R", 7), channel(12, "Keys R", 12)],
        outputs: [{ output: 1, source: { kind: "matrix", matrix: 1 } }],
        selectedChannel: null,
      },
      "connected",
    );

    const after = store.getState();
    expect(after.outputs).toHaveLength(1);
    expect(after.outputRouteIndex).not.toBe(before);
  });

  it("applySnapshot with no outputs field leaves the outputs slice empty (older-peer compatibility)", () => {
    const store = createStore();

    store.getState().applySnapshot(
      { channels: [channel(7, "OH R", 7)], selectedChannel: null },
      "connected",
    );

    expect(store.getState().outputs).toEqual([]);
  });

  it("selection/hover/connection changes preserve outputs/outputRouteIndex identity", () => {
    const store = storeWithOutputs([outputState(1, "off")]);
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(consoleOutput(1)));
    store.getState().setConnection("disconnected");

    const after = store.getState();
    expect(after.outputs).toBe(before.outputs);
    expect(after.outputRouteIndex).toBe(before.outputRouteIndex);
  });

  it("meter updates preserve outputs/outputRouteIndex identity", () => {
    const store = storeWithOutputs([outputState(1, "off")]);
    const before = store.getState();

    store.getState().setMeterLevels(new Array(32).fill(0.2));

    const after = store.getState();
    expect(after.outputs).toBe(before.outputs);
    expect(after.outputRouteIndex).toBe(before.outputRouteIndex);
  });

  it("a channel rename/source change never touches outputs/outputRouteIndex", () => {
    const store = storeWithOutputs([outputState(1, "off")]);
    const before = store.getState();

    store.getState().setChannelName(CH7, "Renamed");
    store.getState().setChannelSource(CH12, { kind: "off" });

    const after = store.getState();
    expect(after.outputs).toBe(before.outputs);
    expect(after.outputRouteIndex).toBe(before.outputRouteIndex);
  });
});

/**
 * The installation editor's slices (issue #27). Two claims:
 *
 * - replacing the *topology* rebuilds only what derives from it, and leaves
 *   every runtime slice's object identity intact — an edit arriving from
 *   another browser must not drop the route this operator has pinned, blank
 *   the meters, or disturb the mixer connection;
 * - edit mode is off in a fresh store and is not restored from anywhere.
 */
describe("installation slice (issue #27)", () => {
  /** The same rig with one device renamed — a plausible `set-device-label` result. */
  function renamedRig(): Installation {
    const rig = exampleRig();
    return {
      ...rig,
      devices: rig.devices.map((device) =>
        device.id === "front-left" ? { ...device, label: "Front Left (renamed)" } : device,
      ),
    };
  }

  it("starts with no installation version until one is known", () => {
    expect(createStore().getState().installationVersion).toBeNull();
  });

  it("setInstallation replaces the topology and rebuilds what derives from it", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setInstallation(renamedRig(), "0123456789abcdef");

    const after = store.getState();
    expect(after.installation.devices.find((d) => d.id === "front-left")?.label).toBe(
      "Front Left (renamed)",
    );
    expect(after.installationVersion).toBe("0123456789abcdef");
    expect(after.routeIndex).not.toBe(before.routeIndex);
    expect(after.outputRouteIndex).not.toBe(before.outputRouteIndex);
  });

  it("setInstallation leaves every runtime slice's identity untouched", () => {
    const store = createStore();
    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setConnection("connected");
    store.getState().setMeterLevels(new Array(32).fill(0.5));
    const before = store.getState();

    store.getState().setInstallation(renamedRig(), "0123456789abcdef");

    const after = store.getState();
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.hoveredEndpoint).toBe(before.hoveredEndpoint);
    expect(after.hoverPinned).toBe(before.hoverPinned);
    expect(after.connection).toBe(before.connection);
    expect(after.meterLevels).toBe(before.meterLevels);
    // Mixer configuration is not the topology either: the channels the desk
    // reported are exactly as they were.
    expect(after.channels).toBe(before.channels);
    expect(after.outputs).toBe(before.outputs);
    expect(after.baseline).toBe(before.baseline);
    expect(after.discrepancies).toBe(before.discrepancies);
  });

  it("ignores a setInstallation that changes nothing", () => {
    const store = createStore();
    store.getState().setInstallation(renamedRig(), "aaaa");
    const before = store.getState();

    store.getState().setInstallation(before.installation, "aaaa");

    expect(store.getState().routeIndex).toBe(before.routeIndex);
  });

  it("runtime writes never touch the installation slice", () => {
    const store = createStore();
    const before = store.getState();

    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setConnection("disconnected");
    store.getState().setEditMode(true);
    store.getState().setEditingDevice(deviceId("front-left"));
    store.getState().setInstallationEditError("nope");

    const after = store.getState();
    expect(after.installation).toBe(before.installation);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.outputRouteIndex).toBe(before.outputRouteIndex);
  });
});

describe("edit mode (issue #27)", () => {
  it("is off in a fresh store, with nothing selected and no error", () => {
    const state = createStore().getState();

    expect(state.editMode).toBe(false);
    expect(state.editingDevice).toBeNull();
    expect(state.installationEditError).toBeNull();
  });

  it("is not inherited from a previous session — a new store is always off", () => {
    const first = createStore();
    first.getState().setEditMode(true);
    first.getState().setEditingDevice(deviceId("front-left"));

    // What a reload produces. Unlike section visibility, "am I editing?" must
    // never come back: this app is read at a glance during a live service.
    expect(createStore().getState().editMode).toBe(false);
    expect(createStore().getState().editingDevice).toBeNull();
  });

  it("has nowhere to be persisted: the store module touches no web storage", () => {
    // The thing being ruled out is a *write*, which no behavioural test on a
    // fresh store can observe — the same reasoning as
    // `loadInstallation.test.ts`'s "no bundled installation copy".
    const source = readFileSync(
      fileURLToPath(new URL("./store.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it("leaving edit mode closes the inspector and drops a stale rejection", () => {
    const store = createStore();
    store.getState().setEditMode(true);
    store.getState().setEditingDevice(deviceId("front-left"));
    store.getState().setInstallationEditError("The installation file changed.");

    store.getState().setEditMode(false);

    const state = store.getState();
    expect(state.editMode).toBe(false);
    expect(state.editingDevice).toBeNull();
    expect(state.installationEditError).toBeNull();
  });

  it("selecting a different device drops the previous device's rejection", () => {
    const store = createStore();
    store.getState().setEditingDevice(deviceId("front-left"));
    store.getState().setInstallationEditError("Unknown device.");

    store.getState().setEditingDevice(deviceId("stagebox-1"));

    expect(store.getState().installationEditError).toBeNull();
  });
});
