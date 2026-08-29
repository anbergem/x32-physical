/**
 * `MockMixerClient` → gateway → store, one test per event type.
 *
 * The interesting assertion is not that the value arrived but *which slice* it
 * landed in (architecture.md §5/§6): selection and connection are runtime and
 * leave the route index alone; name and source are configuration.
 */

import { deviceId, mixerChannelId, panelInput } from "@x32/domain";
import { InMemoryInstallationRepository, installationVersion } from "@x32/installation";
import { MockMixerClient } from "@x32/mixer-contracts";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";
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
  store = createAppStore(exampleRig());
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

  /**
   * Step 20: mock mode has no bridge to check GitHub Releases with — the
   * update notice must stay hidden, never merely "not yet populated".
   */
  it("never sets updateAvailable — mock mode has no bridge to check with", () => {
    expect(store.getState().updateAvailable).toBeNull();
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
    const freshStore = createAppStore(exampleRig());
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

    const freshStore = createAppStore(exampleRig());
    const reader = new LocalMockGateway(freshStore, new MockMixerClient(), baselineStore);
    await reader.connect();

    expect(freshStore.getState().baseline).toEqual(store.getState().baseline);
  });
});

/**
 * Mock-mode editing (issue #27). The point of this path is that it is *not* a
 * second implementation: the gateway runs `@x32/installation`'s
 * `applyInstallationEdit` — the same precondition, the same surgical apply,
 * the same validate-the-result — against an in-memory repository, so `pnpm
 * dev` can demonstrate the editor and the pipeline is exercised on both sides.
 */
describe("LocalMockGateway.applyInstallationEdit (issue #27)", () => {
  const MOCK_YAML = `version: 1

devices:
  # Kept so a mangled write would show up here too.
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:
  - from: { device: front-left, input: 1 }
    to: { device: stagebox-1, input: 1 }
`;

  let repository: InMemoryInstallationRepository;
  let editingGateway: LocalMockGateway;

  beforeEach(() => {
    store = createAppStore(exampleRig());
    repository = new InMemoryInstallationRepository(MOCK_YAML);
    editingGateway = new LocalMockGateway(
      store,
      new MockMixerClient(),
      fakeBaselineStore(),
      repository,
    );
    store.getState().setInstallationVersion(installationVersion(MOCK_YAML));
  });

  it("applies a label edit into the structural slice and keeps the comments", async () => {
    const version = store.getState().installationVersion as string;

    editingGateway.applyInstallationEdit(version, {
      kind: "set-device-label",
      device: deviceId("front-left"),
      label: "Front Left B",
    });
    await vi.waitFor(() =>
      expect(store.getState().installationVersion).not.toBe(version),
    );

    expect(
      store.getState().installation.devices.find((d) => d.id === "front-left")?.label,
    ).toBe("Front Left B");
    expect(repository.text).toContain("# Kept so a mangled write");
    expect(store.getState().installationEditError).toBeNull();
  });

  it("surfaces a rejection in the operator's own words, and writes nothing", async () => {
    editingGateway.applyInstallationEdit("0000000000000000", {
      kind: "set-device-label",
      device: deviceId("front-left"),
      label: "Front Left B",
    });
    await vi.waitFor(() =>
      expect(store.getState().installationEditError).not.toBeNull(),
    );

    expect(store.getState().installationEditError).toMatch(/changed since/i);
    expect(repository.text).toBe(MOCK_YAML);
  });

  it("rejects an operation naming a device that is not there", async () => {
    const version = store.getState().installationVersion as string;

    editingGateway.applyInstallationEdit(version, {
      kind: "set-device-label",
      device: deviceId("ghost-box"),
      label: "Nowhere",
    });
    await vi.waitFor(() =>
      expect(store.getState().installationEditError).not.toBeNull(),
    );

    expect(store.getState().installationEditError).toContain("ghost-box");
    expect(repository.text).toBe(MOCK_YAML);
  });
});
