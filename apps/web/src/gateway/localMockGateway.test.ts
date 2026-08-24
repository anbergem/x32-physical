/**
 * `MockMixerClient` → gateway → store, one test per event type.
 *
 * The interesting assertion is not that the value arrived but *which slice* it
 * landed in (architecture.md §5/§6): selection and connection are runtime and
 * leave the route index alone; name and source are configuration.
 */

import { mixerChannelId, panelInput } from "@x32/domain";
import { MockMixerClient } from "@x32/mixer-contracts";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import type { AppStore } from "../state/store";
import { createAppStore } from "../state/store";

import type { BaselineStore } from "./baselineStore";
import { LocalMockGateway } from "./localMockGateway";

/** In-memory `BaselineStore` fake — no real `localStorage` in these tests. */
function fakeBaselineStore(initial: MixerSnapshot | null = null): BaselineStore {
  let stored = initial;
  return {
    load: () => stored,
    save: (snapshot) => {
      stored = snapshot;
    },
  };
}

const CH7 = mixerChannelId(7);
const CH12 = mixerChannelId(12);

let store: AppStore;
let mock: MockMixerClient;
let gateway: LocalMockGateway;

beforeEach(async () => {
  store = createAppStore(venueInstallation());
  mock = new MockMixerClient();
  gateway = new LocalMockGateway(store, mock);
  await gateway.connect();
});

describe("LocalMockGateway.connect", () => {
  it("applies the initial snapshot and the connection state", () => {
    const state = store.getState();

    expect(state.channels).toHaveLength(32);
    expect(state.connection).toBe("connected");
    expect(state.selectedChannel).toBeNull();
    expect(state.routeIndex.byMixerChannel.size).toBe(32);
  });
});

describe("event → slice mapping", () => {
  it("routes selected-channel-changed to the runtime slice only", () => {
    const before = store.getState();

    mock.simulateSelect(CH12);

    const after = store.getState();
    expect(after.selectedChannel).toBe(CH12);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });

  it("routes channel-name-changed to the configuration slice", () => {
    const before = store.getState();

    mock.simulateRename(CH7, "Overhead R");

    const after = store.getState();
    expect(after.channels.find((state) => state.channel === CH7)?.name).toBe(
      "Overhead R",
    );
    expect(after.channels).not.toBe(before.channels);
    // Configuration, but not routing: a name cannot change where signal goes.
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("routes channel-source-changed to the configuration slice and rebuilds the index", () => {
    const before = store.getState();

    mock.simulateSourceChange(CH12, { kind: "aes50", bus: "A", channel: 3 });

    const after = store.getState();
    expect(after.channels.find((state) => state.channel === CH12)?.source).toEqual({
      kind: "aes50",
      bus: "A",
      channel: 3,
    });
    expect(after.routeIndex).not.toBe(before.routeIndex);
    expect(after.routeIndex.byMixerChannel.get(CH12)?.physicalInputs).toEqual([
      panelInput("front-left", 3),
    ]);
  });

  it("routes connection-state-changed to the runtime slice only", () => {
    const before = store.getState();

    mock.simulateConnectionLoss();

    expect(store.getState().connection).toBe("disconnected");
    // The last known routing stays on screen while the console is away.
    expect(store.getState().routeIndex).toBe(before.routeIndex);
    expect(store.getState().channels).toBe(before.channels);

    mock.simulateReconnect();
    expect(store.getState().connection).toBe("connected");
  });
});

describe("meters (step 15)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wires mock.subscribeMeters to the store's meterLevels slice only", () => {
    vi.useFakeTimers();
    const before = store.getState();

    mock.simulateMetersStart();
    vi.advanceTimersByTime(250);

    const after = store.getState();
    expect(after.meterLevels).not.toBeNull();
    expect(after.meterLevels).toHaveLength(32);
    expect(after.channels).toBe(before.channels);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.selectedChannel).toBe(before.selectedChannel);

    mock.simulateMetersStop();
  });

  it("stops delivering meter levels after disconnect", async () => {
    vi.useFakeTimers();
    mock.simulateMetersStart();
    vi.advanceTimersByTime(250);
    const levelsAfterFirstTick = store.getState().meterLevels;

    await gateway.disconnect();
    vi.advanceTimersByTime(250 * 4);

    // Nothing further applied — the gateway's meters subscription was torn down.
    expect(store.getState().meterLevels).toBe(levelsAfterFirstTick);

    mock.simulateMetersStop();
  });
});

describe("LocalMockGateway.disconnect", () => {
  it("stops applying events and reports the connection as down", async () => {
    await gateway.disconnect();
    expect(store.getState().connection).toBe("disconnected");

    mock.simulateSelect(CH7);

    expect(store.getState().selectedChannel).toBeNull();
  });
});

describe("LocalMockGateway baseline persistence (architecture.md §7)", () => {
  it("applies a previously persisted baseline on connect", async () => {
    const persisted: MixerSnapshot = {
      channels: [{ channel: CH7, name: "Overhead R", source: { kind: "aes50", bus: "A", channel: 7 } }],
      selectedChannel: null,
    };
    const freshStore = createAppStore(venueInstallation());
    const freshGateway = new LocalMockGateway(
      freshStore,
      new MockMixerClient(),
      fakeBaselineStore(persisted),
    );

    await freshGateway.connect();

    expect(freshStore.getState().baseline).toEqual(persisted);
  });

  it("starts with no baseline when nothing was persisted", () => {
    // `gateway`/`store` from the outer beforeEach use a fresh fakeBaselineStore-less
    // LocalMockGateway (real localStorage, unavailable under Node) — always null.
    expect(store.getState().baseline).toBeNull();
  });

  it("saveBaseline persists the current channels/selection and updates the store", () => {
    const baselineStore = fakeBaselineStore();
    const localGateway = new LocalMockGateway(store, mock, baselineStore);

    mock.simulateSelect(CH12);
    localGateway.saveBaseline();

    const state = store.getState();
    expect(state.baseline).toEqual({
      channels: state.channels,
      selectedChannel: CH12,
    });
    // Round-trips through the store: a fresh gateway reading the same store
    // sees exactly what was just saved.
    expect(baselineStore.load()).toEqual(state.baseline);
  });

  it("saveBaseline round-trips through the fake storage across a fresh load", async () => {
    const baselineStore = fakeBaselineStore();
    const saver = new LocalMockGateway(store, mock, baselineStore);
    saver.saveBaseline();

    const freshStore = createAppStore(venueInstallation());
    const reader = new LocalMockGateway(freshStore, new MockMixerClient(), baselineStore);
    await reader.connect();

    expect(freshStore.getState().baseline).toEqual(store.getState().baseline);
  });
});
