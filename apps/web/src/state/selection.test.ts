/**
 * Selection highlighting at the selector level (no DOM).
 *
 * Selection is runtime state that arrives from the physical console
 * (architecture.md §5) — nothing here ever calls a "select" action to mean
 * anything but "the mock/adapter told the store this happened". Three
 * properties matter and are asserted below:
 *
 * 1. **Route, not just the channel** — selecting a dual-consumer source
 *    lights the socket, the AES50 hop and *every* consuming strip, exactly
 *    like hovering the same route does (plan step 7).
 * 2. **Independence from hover** — the two are separate slices with separate
 *    selectors; changing one must never move the other, whatever the pointer
 *    or the console is doing at the same time.
 * 3. **No throw on an unmapped source** — a selected channel with no
 *    physical mapping highlights only its own strip.
 *
 * The mock's default snapshot (mixer-contracts) is faithful to the real patch
 * sheet and has no dual-consumer or unmapped-source channel by default, so
 * the tests that need those edge cases build their own local fixture
 * snapshot by overriding the default rather than leaning on it.
 */

import type { EndpointId, MixerChannelState } from "@x32/domain";
import {
  aes50Channel,
  endpointId,
  mixerChannel,
  mixerChannelId,
  panelInput,
  stageboxInput,
} from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { selectHoverStatus, selectSelectionStatus } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

const installation = exampleRig();

const CH23 = mixerChannelId(23);
const CH28 = mixerChannelId(28);

/**
 * A local fixture: CH23 and CH28 both forced onto AES50-A 10 (stagebox-1
 * input 10, unconsumed by default), the fan-out case the real default
 * snapshot no longer contains.
 */
function dualConsumerChannels(): MixerChannelState[] {
  const { channels } = createDefaultMockSnapshot();
  return channels.map((channel) =>
    channel.channel === CH23 || channel.channel === CH28
      ? { ...channel, source: { kind: "aes50", bus: "A", channel: 10 } }
      : channel,
  );
}

function selectionStore(): AppStore {
  return createAppStore(installation, dualConsumerChannels());
}

function statusOf(store: AppStore, endpoint: EndpointId) {
  return selectSelectionStatus(endpoint)(store.getState());
}

// The local fixture's dual-consumer case (dualConsumerChannels above):
// AES50-A 10 (stagebox-1 input 10) feeds both CH23 and CH28.
const SOCKET = endpointId(stageboxInput("stagebox-1", 10));
const CH23_ENDPOINT = endpointId(mixerChannel(CH23));
const CH28_ENDPOINT = endpointId(mixerChannel(CH28));

describe("selectSelectionStatus", () => {
  it("shows nothing when no channel is selected", () => {
    const store = selectionStore();
    expect(statusOf(store, CH23_ENDPOINT)).toBe("none");
  });

  it("marks the selected channel's own strip as selected", () => {
    const store = selectionStore();
    store.getState().setSelectedChannel(CH23);

    expect(statusOf(store, CH23_ENDPOINT)).toBe("selected");
  });

  it("marks the rest of the route — sibling consumer, AES50 hop, socket — as on-selected-route", () => {
    const store = selectionStore();
    store.getState().setSelectedChannel(CH23);

    expect(statusOf(store, CH28_ENDPOINT)).toBe("on-selected-route");
    expect(statusOf(store, SOCKET)).toBe("on-selected-route");
    expect(statusOf(store, endpointId(aes50Channel("A", 10)))).toBe(
      "on-selected-route",
    );
  });

  it("leaves everything off the route dark", () => {
    const store = selectionStore();
    store.getState().setSelectedChannel(CH23);

    expect(statusOf(store, endpointId(mixerChannel(12)))).toBe("none");
    // front-left is cabled into stagebox-1, an unrelated bus channel.
    expect(statusOf(store, endpointId(panelInput("front-left", 3)))).toBe(
      "none",
    );
  });

  it("highlights only the strip itself for a selected channel with an unmapped source, without throwing", () => {
    const { channels } = createDefaultMockSnapshot();
    const withCard: MixerChannelState[] = channels.map((channel) =>
      channel.channel === mixerChannelId(29)
        ? { ...channel, source: { kind: "card", input: 1 } }
        : channel,
    );
    const store = createAppStore(installation, withCard);
    const card = endpointId(mixerChannel(mixerChannelId(29))); // forced Card 1

    expect(() => store.getState().setSelectedChannel(mixerChannelId(29))).not.toThrow();
    expect(statusOf(store, card)).toBe("selected");
    expect(statusOf(store, endpointId(mixerChannel(mixerChannelId(30))))).toBe(
      "none",
    );
  });
});

describe("selection and hover independence", () => {
  it("a hover change leaves selectedChannel and every selection status untouched", () => {
    const store = selectionStore();
    store.getState().setSelectedChannel(CH23);
    const before = {
      strip: statusOf(store, CH23_ENDPOINT),
      sibling: statusOf(store, CH28_ENDPOINT),
      socket: statusOf(store, SOCKET),
    };

    store.getState().setHoveredEndpoint(endpointId(panelInput("front-left", 3)));

    expect(store.getState().selectedChannel).toBe(CH23);
    expect(statusOf(store, CH23_ENDPOINT)).toBe(before.strip);
    expect(statusOf(store, CH28_ENDPOINT)).toBe(before.sibling);
    expect(statusOf(store, SOCKET)).toBe(before.socket);
  });

  it("hovering the selected channel itself keeps both statuses, not one replacing the other", () => {
    const store = selectionStore();
    store.getState().setSelectedChannel(CH23);

    store.getState().setHoveredEndpoint(CH23_ENDPOINT);

    expect(statusOf(store, CH23_ENDPOINT)).toBe("selected");
    expect(selectHoverStatus(CH23_ENDPOINT)(store.getState())).toBe("hovered");
  });

  it("a selection change leaves hoveredEndpoint and routeIndex identity untouched", () => {
    const store = selectionStore();
    const hovered = endpointId(panelInput("front-left", 4));
    store.getState().setHoveredEndpoint(hovered);
    const before = store.getState();

    store.getState().setSelectedChannel(CH23);

    const after = store.getState();
    expect(after.hoveredEndpoint).toBe(hovered);
    expect(after.routeIndex).toBe(before.routeIndex);
    expect(after.channels).toBe(before.channels);
  });
});
