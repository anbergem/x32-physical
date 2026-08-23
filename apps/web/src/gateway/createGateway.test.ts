/**
 * Mode selection (architecture.md §6): mock is the default, live is a seam.
 */

import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import { createAppStore } from "../state/store";

import { createGateway } from "./createGateway";
import { LocalMockGateway } from "./localMockGateway";
import { resolveGatewayMode } from "./mixerGateway";
import { WebSocketMixerGateway } from "./webSocketMixerGateway";

describe("resolveGatewayMode", () => {
  it("defaults to mock so the app always starts without an X32", () => {
    expect(resolveGatewayMode("")).toBe("mock");
    expect(resolveGatewayMode("?other=1")).toBe("mock");
  });

  it("reads the mode from the query string", () => {
    expect(resolveGatewayMode("?mode=live")).toBe("live");
    expect(resolveGatewayMode("?mode=mock")).toBe("mock");
  });

  it("falls back to mock on an unrecognised mode", () => {
    expect(resolveGatewayMode("?mode=typo")).toBe("mock");
  });
});

describe("createGateway", () => {
  it("builds a browser-local mock gateway in mock mode", () => {
    const store = createAppStore(venueInstallation());

    expect(createGateway(store, "mock")).toBeInstanceOf(LocalMockGateway);
  });

  it("builds a WebSocket gateway in live mode, without opening a socket", () => {
    const store = createAppStore(venueInstallation());

    const gateway = createGateway(store, "live", "ws://example.test:1234");

    expect(gateway).toBeInstanceOf(WebSocketMixerGateway);
  });

  it("falls back to the default bridge URL when live mode is requested bare", () => {
    const store = createAppStore(venueInstallation());

    expect(createGateway(store, "live")).toBeInstanceOf(WebSocketMixerGateway);
  });
});
