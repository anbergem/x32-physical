/**
 * `ServerMessage` -> store slices, mirroring `localMockGateway.test.ts`'s
 * style: what matters is *which slice* a message lands in (architecture.md
 * §5/§7), not merely that a value arrived. No socket anywhere — this is the
 * seam `WebSocketMixerGateway.onmessage` is a one-line wrapper around.
 */

import { endpointId, mixerChannelId, panelInput } from "@x32/domain";
import type { ServerMessage } from "@x32/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";
import type { AppStore } from "../state/store";
import { createAppStore } from "../state/store";

import { applyServerMessage } from "./applyServerMessage";

const CH7 = mixerChannelId(7);
const CH12 = mixerChannelId(12);

let store: AppStore;

beforeEach(() => {
  store = createAppStore(exampleRig());
});

function snapshotMessage(): Extract<ServerMessage, { type: "snapshot" }> {
  return {
    type: "snapshot",
    mixerConnection: "connected",
    snapshot: {
      outputs: [],
      selectedChannel: null,
      channels: Array.from({ length: 32 }, (_, index) => ({
        channel: mixerChannelId(index + 1),
        name: `CH${index + 1}`,
        source: { kind: "aes50" as const, bus: "A" as const, channel: index + 1 },
      })),
      aes50LinkState: null,
      aes50Chain: [],
    },
    baseline: null,
    updateAvailable: null,
    installationVersion: null,
  };
}

describe("applyServerMessage: snapshot", () => {
  it("applies the channels, selection and connection state atomically", () => {
    applyServerMessage(store, snapshotMessage());

    const state = store.getState();
    expect(state.channels).toHaveLength(32);
    expect(state.connection).toBe("connected");
    expect(state.selectedChannel).toBeNull();
    expect(state.routeIndex.byMixerChannel.size).toBe(32);
  });

  it("reports the mixer as disconnected when the bridge says so, without blanking the topology", () => {
    const message = snapshotMessage();
    message.mixerConnection = "disconnected";

    applyServerMessage(store, message);

    expect(store.getState().connection).toBe("disconnected");
    expect(store.getState().channels).toHaveLength(32);
  });

  it("accepts a JSON string, exactly what a real socket delivers", () => {
    applyServerMessage(store, JSON.stringify(snapshotMessage()));

    expect(store.getState().channels).toHaveLength(32);
    expect(store.getState().connection).toBe("connected");
  });
});

describe("applyServerMessage: event -> slice mapping", () => {
  beforeEach(() => {
    applyServerMessage(store, snapshotMessage());
  });

  it("routes selected-channel-changed to the runtime slice only", () => {
    const before = store.getState();

    applyServerMessage(store, {
      type: "event",
      event: { type: "selected-channel-changed", channel: CH12 },
    });

    const after = store.getState();
    expect(after.selectedChannel).toBe(CH12);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });

  it("routes channel-name-changed to the configuration slice", () => {
    const before = store.getState();

    applyServerMessage(store, {
      type: "event",
      event: { type: "channel-name-changed", channel: CH7, name: "Overhead R" },
    });

    const after = store.getState();
    expect(after.channels.find((c) => c.channel === CH7)?.name).toBe("Overhead R");
    expect(after.channels).not.toBe(before.channels);
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("routes channel-source-changed to the configuration slice and rebuilds the index", () => {
    const before = store.getState();

    applyServerMessage(store, {
      type: "event",
      event: {
        type: "channel-source-changed",
        channel: CH12,
        source: { kind: "aes50", bus: "A", channel: 3 },
      },
    });

    const after = store.getState();
    expect(after.channels.find((c) => c.channel === CH12)?.source).toEqual({
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

    applyServerMessage(store, {
      type: "event",
      event: { type: "connection-state-changed", state: "disconnected" },
    });

    expect(store.getState().connection).toBe("disconnected");
    expect(store.getState().routeIndex).toBe(before.routeIndex);
    expect(store.getState().channels).toBe(before.channels);
  });
});

describe("applyServerMessage: meters (step 15)", () => {
  beforeEach(() => {
    applyServerMessage(store, snapshotMessage());
  });

  it("routes 'meters' to the meterLevels slice only, touching nothing else", () => {
    const before = store.getState();
    const levels = Array.from({ length: 32 }, (_, i) => i / 100);

    applyServerMessage(store, { type: "meters", levels });

    const after = store.getState();
    expect(after.meterLevels).toEqual(levels);
    expect(after.channels).toBe(before.channels);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
    expect(after.baseline).toBe(before.baseline);
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.hoveredEndpoint).toBe(before.hoveredEndpoint);
  });

  it("a non-meters message never touches meterLevels", () => {
    applyServerMessage(store, { type: "meters", levels: new Array(32).fill(0.1) });
    const before = store.getState();

    applyServerMessage(store, {
      type: "event",
      event: { type: "selected-channel-changed", channel: CH12 },
    });

    expect(store.getState().meterLevels).toBe(before.meterLevels);
  });
});

describe("applyServerMessage: baseline (architecture.md §7)", () => {
  it("applies a snapshot message's baseline field to the baseline slice", () => {
    const message = snapshotMessage();
    message.baseline = message.snapshot;

    applyServerMessage(store, message);

    expect(store.getState().baseline).toEqual(message.snapshot);
  });

  it("routes baseline-changed to the baseline slice and recomputes discrepancies, not routeIndex", () => {
    applyServerMessage(store, snapshotMessage());
    const before = store.getState();

    const renamed = {
      ...snapshotMessage().snapshot,
      channels: snapshotMessage().snapshot.channels.map((c) =>
        c.channel === CH7 ? { ...c, name: "Old Name" } : c,
      ),
    };
    applyServerMessage(store, { type: "baseline-changed", baseline: renamed });

    const after = store.getState();
    expect(after.baseline).toEqual(renamed);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies.some((d) => d.kind === "name-mismatch")).toBe(true);
  });

  it("routes baseline-save-rejected to the runtime baselineSaveError slice", () => {
    expect(() =>
      applyServerMessage(store, {
        type: "baseline-save-rejected",
        reason: "The mixer is not connected.",
      }),
    ).not.toThrow();

    expect(store.getState().baselineSaveError).toBe("The mixer is not connected.");
  });
});

describe("applyServerMessage: updateAvailable (plan step 20)", () => {
  it("applies a snapshot message's updateAvailable field", () => {
    const message = snapshotMessage();
    message.updateAvailable = { version: "0.2.0", url: "https://example.com/release/v0.2.0" };

    applyServerMessage(store, message);

    expect(store.getState().updateAvailable).toEqual({
      version: "0.2.0",
      url: "https://example.com/release/v0.2.0",
    });
  });

  it("routes update-available to the updateAvailable slice only, touching nothing else", () => {
    applyServerMessage(store, snapshotMessage());
    const before = store.getState();

    applyServerMessage(store, {
      type: "update-available",
      update: { version: "0.3.0", url: "https://example.com/release/v0.3.0" },
    });

    const after = store.getState();
    expect(after.updateAvailable).toEqual({
      version: "0.3.0",
      url: "https://example.com/release/v0.3.0",
    });
    expect(after.channels).toBe(before.channels);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.discrepancies).toBe(before.discrepancies);
  });
});

/**
 * The installation edit path (issue #27). `installation-changed` is the one
 * message that replaces *structural* state, so what matters is not only that
 * the new topology arrives but that nothing else moves with it.
 */
describe("applyServerMessage: installation (issue #27)", () => {
  const RENAMED_YAML = `version: 1

devices:
  # A comment, to prove the wire carries the document and not a re-serialisation.
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1 (renamed)"
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

  it("applies a snapshot message's installationVersion", () => {
    applyServerMessage(store, { ...snapshotMessage(), installationVersion: "0123456789abcdef" });

    expect(store.getState().installationVersion).toBe("0123456789abcdef");
  });

  it("routes installation-changed to the structural slice, re-parsing the document", () => {
    applyServerMessage(store, {
      type: "installation-changed",
      text: RENAMED_YAML,
      version: "0123456789abcdef",
    });

    const state = store.getState();
    expect(state.installation.devices.find((d) => d.id === "stagebox-1")?.label).toBe(
      "Stagebox 1 (renamed)",
    );
    expect(state.installationVersion).toBe("0123456789abcdef");
  });

  it("leaves every runtime slice's identity intact — an edit elsewhere disturbs nothing here", () => {
    applyServerMessage(store, snapshotMessage());
    store.getState().setSelectedChannel(CH12);
    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 4)));
    store.getState().setMeterLevels(new Array(32).fill(0.25));
    const before = store.getState();

    applyServerMessage(store, {
      type: "installation-changed",
      text: RENAMED_YAML,
      version: "0123456789abcdef",
    });

    const after = store.getState();
    expect(after.installation).not.toBe(before.installation);
    expect(after.selectedChannel).toBe(before.selectedChannel);
    expect(after.hoveredEndpoint).toBe(before.hoveredEndpoint);
    expect(after.hoverPinned).toBe(before.hoverPinned);
    expect(after.connection).toBe(before.connection);
    expect(after.meterLevels).toBe(before.meterLevels);
    expect(after.channels).toBe(before.channels);
    expect(after.baseline).toBe(before.baseline);
    expect(after.discrepancies).toBe(before.discrepancies);
  });

  it("ignores an installation-changed document that will not parse, keeping the last good topology", () => {
    const before = store.getState().installation;

    applyServerMessage(store, {
      type: "installation-changed",
      text: "not: [an, installation",
      version: "0123456789abcdef",
    });

    expect(store.getState().installation).toBe(before);
  });

  it("routes installation-edit-rejected to the runtime installationEditError slice", () => {
    const before = store.getState();

    applyServerMessage(store, {
      type: "installation-edit-rejected",
      reason: 'Unknown device "ghost-box".',
    });

    const after = store.getState();
    expect(after.installationEditError).toBe('Unknown device "ghost-box".');
    // A rejection changed nothing about the installation.
    expect(after.installation).toBe(before.installation);
    expect(after.installationVersion).toBe(before.installationVersion);
    expect(after.routeIndex).toBe(before.routeIndex);
  });

  it("a successful installation-changed clears a previous rejection", () => {
    applyServerMessage(store, {
      type: "installation-edit-rejected",
      reason: "The installation file changed.",
    });

    applyServerMessage(store, {
      type: "installation-changed",
      text: RENAMED_YAML,
      version: "0123456789abcdef",
    });

    expect(store.getState().installationEditError).toBeNull();
  });
});

describe("applyServerMessage: malformed input", () => {
  it("ignores a message that fails the protocol guards, without throwing", () => {
    expect(() =>
      applyServerMessage(store, { type: "snapshot", snapshot: {} }),
    ).not.toThrow();

    // Nothing was applied: the store still has whatever it started with.
    expect(store.getState().channels).toHaveLength(0);
  });

  it("ignores unparsable JSON text, without throwing", () => {
    expect(() => applyServerMessage(store, "{not json")).not.toThrow();
    expect(store.getState().channels).toHaveLength(0);
  });

  it("ignores a message of a shape it does not recognise at all", () => {
    expect(() => applyServerMessage(store, 42)).not.toThrow();
    expect(() => applyServerMessage(store, null)).not.toThrow();
  });
});
