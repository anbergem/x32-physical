/**
 * Hover highlighting at the selector level (no DOM).
 *
 * Two properties matter and both are asserted here:
 *
 * 1. **Symmetry** — a route is one shared object, so hovering either end lights
 *    exactly the same endpoints, fan-out included.
 * 2. **Rerender discipline** — statuses are primitives, and a hover changes the
 *    status of only the endpoints on that route. The probe below counts the
 *    changed ones, which is what would rerender in the browser.
 *
 * The mock's default snapshot (mixer-contracts) is faithful to the real patch
 * sheet and has no dual-consumer or unmapped-source channel, so the tests that
 * need those edge cases build their own local fixture snapshot by overriding
 * the default rather than leaning on it.
 */

import type { EndpointId, Installation, MixerChannelState } from "@x32/domain";
import {
  aes50Channel,
  endpointId,
  mixerChannel,
  MIXER_CHANNEL_COUNT,
  mixerChannelId,
  panelInput,
  stageboxInput,
} from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { selectHoverStatus } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

/** Every endpoint the schematic actually renders: sockets and strips. */
function renderedEndpoints(installation: Installation): EndpointId[] {
  const endpoints: EndpointId[] = [];

  for (const device of installation.devices) {
    for (let input = 1; input <= device.inputs; input += 1) {
      endpoints.push(
        endpointId(
          device.kind === "stagebox"
            ? stageboxInput(device.id, input)
            : panelInput(device.id, input),
        ),
      );
    }
  }
  for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
    endpoints.push(endpointId(mixerChannel(channel)));
  }

  return endpoints;
}

const installation = exampleRig();
const ALL = renderedEndpoints(installation);

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

/** A local fixture: CH29 forced onto an unmapped (Card) source. */
function cardChannels(): MixerChannelState[] {
  const { channels } = createDefaultMockSnapshot();
  return channels.map((channel) =>
    channel.channel === mixerChannelId(29)
      ? { ...channel, source: { kind: "card", input: 1 } }
      : channel,
  );
}

function storeWith(channels: MixerChannelState[]): AppStore {
  return createAppStore(installation, channels);
}

function hoverStore(): AppStore {
  return storeWith(createDefaultMockSnapshot().channels);
}

function dualConsumerStore(): AppStore {
  return storeWith(dualConsumerChannels());
}

function statusOf(store: AppStore, endpoint: EndpointId) {
  return selectHoverStatus(endpoint)(store.getState());
}

/** The endpoints that light up, whatever their exact status. */
function highlighted(store: AppStore, hovered: EndpointId): EndpointId[] {
  store.getState().setHoveredEndpoint(hovered);
  return ALL.filter((endpoint) => statusOf(store, endpoint) !== "none");
}

const SOCKET = endpointId(stageboxInput("stagebox-1", 10)); // AES50-A 10
const CH23_ENDPOINT = endpointId(mixerChannel(CH23));
const CH28_ENDPOINT = endpointId(mixerChannel(CH28));

describe("selectHoverStatus", () => {
  it("lights the whole route from a socket, including every consumer", () => {
    const store = dualConsumerStore();
    store.getState().setHoveredEndpoint(SOCKET);

    expect(statusOf(store, SOCKET)).toBe("hovered");
    // One socket, two channels: the fan-out the local fixture exists for.
    expect(statusOf(store, CH23_ENDPOINT)).toBe("on-route");
    expect(statusOf(store, CH28_ENDPOINT)).toBe("on-route");
    // The AES50 hop is on the route too, though no element renders it.
    expect(statusOf(store, endpointId(aes50Channel("A", 10)))).toBe("on-route");
    // A channel on an unrelated route stays dark.
    expect(statusOf(store, endpointId(mixerChannel(12)))).toBe("none");
  });

  it("lights the same route when hovered from the far end", () => {
    const store = dualConsumerStore();

    const fromSocket = highlighted(store, SOCKET);
    const fromChannel = highlighted(store, CH28_ENDPOINT);

    expect(fromChannel).toEqual(fromSocket);
    expect(fromSocket).toContain(SOCKET);
    expect(fromSocket).toContain(CH23_ENDPOINT);
    expect(fromSocket).toContain(CH28_ENDPOINT);
  });

  it("traces a panel socket through its stagebox to the channel", () => {
    const store = hoverStore();
    const panel = endpointId(panelInput("front-left", 3));
    store.getState().setHoveredEndpoint(panel);

    expect(statusOf(store, panel)).toBe("hovered");
    expect(statusOf(store, endpointId(stageboxInput("stagebox-1", 3)))).toBe(
      "on-route",
    );
    // front-left input 3 -> stagebox-1 input 3 -> AES50-A 3 -> CH7 "Vox 3".
    expect(statusOf(store, endpointId(mixerChannel(7)))).toBe("on-route");
  });

  it("lights only the strip itself for an unmapped channel", () => {
    const store = storeWith(cardChannels());
    const card = endpointId(mixerChannel(29)); // forced Card 1

    expect(highlighted(store, card)).toEqual([card]);
  });

  it("lights nothing when the pointer leaves", () => {
    const store = dualConsumerStore();
    store.getState().setHoveredEndpoint(SOCKET);

    store.getState().setHoveredEndpoint(null);

    expect(ALL.every((endpoint) => statusOf(store, endpoint) === "none")).toBe(
      true,
    );
  });
});

describe("rerender discipline", () => {
  function statusMap(store: AppStore): Map<EndpointId, string> {
    return new Map(ALL.map((endpoint) => [endpoint, statusOf(store, endpoint)]));
  }

  it("changes the status of only the endpoints on the hovered route", () => {
    const store = dualConsumerStore();
    const before = statusMap(store);

    store.getState().setHoveredEndpoint(SOCKET);

    const after = statusMap(store);
    const changed = ALL.filter(
      (endpoint) => before.get(endpoint) !== after.get(endpoint),
    );

    // The socket plus its two consumers — 3 of 72 rendered elements rerender,
    // not the whole schematic.
    expect(changed).toEqual([SOCKET, CH23_ENDPOINT, CH28_ENDPOINT]);
  });

  it("returns a primitive status, stable across unrelated store writes", () => {
    const store = dualConsumerStore();
    store.getState().setHoveredEndpoint(SOCKET);
    const before = statusOf(store, CH23_ENDPOINT);

    store.getState().setChannelName(mixerChannelId(1), "Renamed");

    expect(typeof before).toBe("string");
    expect(statusOf(store, CH23_ENDPOINT)).toBe(before);
  });
});
