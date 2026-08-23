/**
 * `ServerMessage` -> store slices, mirroring `localMockGateway.test.ts`'s
 * style: what matters is *which slice* a message lands in (architecture.md
 * §5/§7), not merely that a value arrived. No socket anywhere — this is the
 * seam `WebSocketMixerGateway.onmessage` is a one-line wrapper around.
 */

import { mixerChannelId, panelInput } from "@x32/domain";
import type { ServerMessage } from "@x32/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import type { AppStore } from "../state/store";
import { createAppStore } from "../state/store";

import { applyServerMessage } from "./applyServerMessage";

const CH7 = mixerChannelId(7);
const CH12 = mixerChannelId(12);

let store: AppStore;

beforeEach(() => {
  store = createAppStore(venueInstallation());
});

function snapshotMessage(): Extract<ServerMessage, { type: "snapshot" }> {
  return {
    type: "snapshot",
    mixerConnection: "connected",
    snapshot: {
      selectedChannel: null,
      channels: Array.from({ length: 32 }, (_, index) => ({
        channel: mixerChannelId(index + 1),
        name: `CH${index + 1}`,
        source: { kind: "aes50" as const, bus: "A" as const, channel: index + 1 },
      })),
    },
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
