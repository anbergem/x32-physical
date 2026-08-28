/**
 * Pinning at the store/selector level (no DOM) — the state half of the
 * touch interaction described in `components/endpointPointer.ts`.
 *
 * Three properties matter here:
 *
 * 1. A pinned endpoint highlights its route exactly like a hovered one, and
 *    survives the pointer leaving.
 * 2. A real hover always wins over a pin, so the mouse experience is
 *    unchanged: nothing a mouse user does can get stuck.
 * 3. Pinning and the console's SELECT are independent — both can be on the
 *    same channel at once, and neither disturbs the other.
 */

import type { EndpointId } from "@x32/domain";
import { deviceId, endpointId, mixerChannel, mixerChannelId, stageboxInput } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { selectHoverStatus, selectSelectionStatus } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

const installation = exampleRig();

/** Stagebox 1 input 1, and the channel the default snapshot feeds from it. */
const STAGEBOX = deviceId("stagebox-1");
const SOCKET: EndpointId = endpointId(stageboxInput(STAGEBOX, 1));
const OTHER_SOCKET: EndpointId = endpointId(stageboxInput(STAGEBOX, 5));

let store: AppStore;

beforeEach(() => {
  store = createAppStore(installation, createDefaultMockSnapshot().channels);
});

function statusOf(endpoint: EndpointId) {
  return selectHoverStatus(endpoint)(store.getState());
}

/** Everything the socket's route lights, hovered endpoint included. */
function litByRouteOf(endpoint: EndpointId): EndpointId[] {
  const routes = store.getState().routeIndex.byEndpoint.get(endpoint) ?? [];
  return routes.flatMap((route) => route.endpoints);
}

describe("pinning an endpoint", () => {
  it("marks it pinned rather than merely hovered", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    expect(statusOf(SOCKET)).toBe("pinned");
  });

  it("lights the same route a hover would", () => {
    const onRoute = litByRouteOf(SOCKET).filter((endpoint) => endpoint !== SOCKET);
    expect(onRoute.length).toBeGreaterThan(0);

    store.getState().setHoveredEndpoint(SOCKET);
    const hovered = onRoute.map(statusOf);
    store.getState().toggleEndpointPin(SOCKET, false);
    expect(onRoute.map(statusOf)).toEqual(hovered);
    expect(hovered.every((status) => status === "on-route")).toBe(true);
  });

  it("survives the pointer leaving", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().setHoveredEndpoint(null);
    expect(statusOf(SOCKET)).toBe("pinned");
  });

  it("moves to whichever endpoint is pinned next", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().toggleEndpointPin(OTHER_SOCKET, false);
    expect(statusOf(SOCKET)).toBe("none");
    expect(statusOf(OTHER_SOCKET)).toBe("pinned");
  });
});

describe("unpinning", () => {
  it("clears the highlight entirely for a finger (nothing is resting on it)", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().toggleEndpointPin(SOCKET, false);
    expect(statusOf(SOCKET)).toBe("none");
    expect(store.getState().hoveredEndpoint).toBeNull();
  });

  it("leaves the endpoint hovered for a mouse, which is still on it", () => {
    store.getState().toggleEndpointPin(SOCKET, true);
    store.getState().toggleEndpointPin(SOCKET, true);
    expect(statusOf(SOCKET)).toBe("hovered");
  });

  it("happens on `clearHover`, whatever put the pin there", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().clearHover();
    expect(statusOf(SOCKET)).toBe("none");
    expect(store.getState().hoverPinned).toBe(false);
  });
});

describe("a live hover always beats a pin", () => {
  it("drops the pin when the pointer moves onto another endpoint", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().setHoveredEndpoint(OTHER_SOCKET);
    expect(store.getState().hoverPinned).toBe(false);
    expect(statusOf(OTHER_SOCKET)).toBe("hovered");

    // And now leaving clears it, exactly as it always did.
    store.getState().setHoveredEndpoint(null);
    expect(statusOf(OTHER_SOCKET)).toBe("none");
  });

  it("drops the pin when the pointer re-enters the pinned endpoint itself", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().setHoveredEndpoint(SOCKET);
    expect(statusOf(SOCKET)).toBe("hovered");
    store.getState().setHoveredEndpoint(null);
    expect(statusOf(SOCKET)).toBe("none");
  });
});

describe("pinning and the console's SELECT stay independent", () => {
  const CH1 = mixerChannelId(1);
  const CH1_ENDPOINT = endpointId(mixerChannel(CH1));

  it("pinning never changes what is selected", () => {
    store.getState().setSelectedChannel(CH1);
    store.getState().toggleEndpointPin(SOCKET, false);
    expect(store.getState().selectedChannel).toBe(CH1);
  });

  it("selecting never clears a pin", () => {
    store.getState().toggleEndpointPin(SOCKET, false);
    store.getState().setSelectedChannel(CH1);
    expect(statusOf(SOCKET)).toBe("pinned");
  });

  it("reports both statuses on a channel that is pinned and selected at once", () => {
    store.getState().setSelectedChannel(CH1);
    store.getState().toggleEndpointPin(CH1_ENDPOINT, false);
    expect(statusOf(CH1_ENDPOINT)).toBe("pinned");
    expect(selectSelectionStatus(CH1_ENDPOINT)(store.getState())).toBe("selected");
  });
});
