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
 */

import type { EndpointId, Installation } from "@x32/domain";
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

import { venueInstallation } from "../__fixtures__/venue";

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

const installation = venueInstallation();
const ALL = renderedEndpoints(installation);

function hoverStore(): AppStore {
  return createAppStore(installation, createDefaultMockSnapshot().channels);
}

function statusOf(store: AppStore, endpoint: EndpointId) {
  return selectHoverStatus(endpoint)(store.getState());
}

/** The endpoints that light up, whatever their exact status. */
function highlighted(store: AppStore, hovered: EndpointId): EndpointId[] {
  store.getState().setHoveredEndpoint(hovered);
  return ALL.filter((endpoint) => statusOf(store, endpoint) !== "none");
}

const SOCKET = endpointId(stageboxInput("stagebox-2", 7)); // AES50-A 23
const CH23 = endpointId(mixerChannel(23));
const CH28 = endpointId(mixerChannel(28));

describe("selectHoverStatus", () => {
  it("lights the whole route from a socket, including every consumer", () => {
    const store = hoverStore();
    store.getState().setHoveredEndpoint(SOCKET);

    expect(statusOf(store, SOCKET)).toBe("hovered");
    // One socket, two channels: the fan-out the mock's snapshot exists for.
    expect(statusOf(store, CH23)).toBe("on-route");
    expect(statusOf(store, CH28)).toBe("on-route");
    // The AES50 hop is on the route too, though no element renders it.
    expect(statusOf(store, endpointId(aes50Channel("A", 23)))).toBe("on-route");
    // A channel on an unrelated route stays dark.
    expect(statusOf(store, endpointId(mixerChannel(12)))).toBe("none");
  });

  it("lights the same route when hovered from the far end", () => {
    const store = hoverStore();

    const fromSocket = highlighted(store, SOCKET);
    const fromChannel = highlighted(store, CH28);

    expect(fromChannel).toEqual(fromSocket);
    expect(fromSocket).toContain(SOCKET);
    expect(fromSocket).toContain(CH23);
    expect(fromSocket).toContain(CH28);
  });

  it("traces a panel socket through its stagebox to the channel", () => {
    const store = hoverStore();
    const panel = endpointId(panelInput("front-left", 3));
    store.getState().setHoveredEndpoint(panel);

    expect(statusOf(store, panel)).toBe("hovered");
    expect(statusOf(store, endpointId(stageboxInput("stagebox-1", 3)))).toBe(
      "on-route",
    );
    expect(statusOf(store, endpointId(mixerChannel(3)))).toBe("on-route");
  });

  it("lights only the strip itself for an unmapped channel", () => {
    const store = hoverStore();
    const card = endpointId(mixerChannel(29)); // Card 1

    expect(highlighted(store, card)).toEqual([card]);
  });

  it("lights nothing when the pointer leaves", () => {
    const store = hoverStore();
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
    const store = hoverStore();
    const before = statusMap(store);

    store.getState().setHoveredEndpoint(SOCKET);

    const after = statusMap(store);
    const changed = ALL.filter(
      (endpoint) => before.get(endpoint) !== after.get(endpoint),
    );

    // The socket plus its two consumers — 3 of 72 rendered elements rerender,
    // not the whole schematic.
    expect(changed).toEqual([SOCKET, CH23, CH28]);
  });

  it("returns a primitive status, stable across unrelated store writes", () => {
    const store = hoverStore();
    store.getState().setHoveredEndpoint(SOCKET);
    const before = statusOf(store, CH23);

    store.getState().setChannelName(mixerChannelId(1), "Renamed");

    expect(typeof before).toBe("string");
    expect(statusOf(store, CH23)).toBe(before);
  });
});
