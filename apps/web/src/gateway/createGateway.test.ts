/**
 * Mode selection (architecture.md §6): mock is the default, live is a seam.
 */

import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import { createAppStore } from "../state/store";

import { createGateway } from "./createGateway";
import { LocalMockGateway } from "./localMockGateway";
import { resolveGatewayMode } from "./mixerGateway";

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

  it("refuses live mode until the WebSocket gateway exists", () => {
    const store = createAppStore(venueInstallation());

    expect(() => createGateway(store, "live")).toThrow(/step 9/);
  });
});
