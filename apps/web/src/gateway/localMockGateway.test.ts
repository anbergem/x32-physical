/**
 * `MockMixerClient` → gateway → store, one test per event type.
 *
 * The interesting assertion is not that the value arrived but *which slice* it
 * landed in (architecture.md §5/§6): selection and connection are runtime and
 * leave the route index alone; name and source are configuration.
 */

import { mixerChannelId, panelInput } from "@x32/domain";
import { MockMixerClient } from "@x32/mixer-contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import type { AppStore } from "../state/store";
import { createAppStore } from "../state/store";

import { LocalMockGateway } from "./localMockGateway";

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

describe("LocalMockGateway.disconnect", () => {
  it("stops applying events and reports the connection as down", async () => {
    await gateway.disconnect();
    expect(store.getState().connection).toBe("disconnected");

    mock.simulateSelect(CH7);

    expect(store.getState().selectedChannel).toBeNull();
  });
});
