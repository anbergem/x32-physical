import { describe, expect, it } from "vitest";

import { resolveEndpointPointerAction } from "./endpointPointer";

describe("resolveEndpointPointerAction, with a mouse", () => {
  it("hovers on enter and clears on leave — the behaviour that already existed", () => {
    expect(resolveEndpointPointerAction("enter", "mouse")).toBe("hover");
    expect(resolveEndpointPointerAction("leave", "mouse")).toBe("clear");
  });

  it("pins on click, leaving the endpoint hovered if the click unpins it", () => {
    expect(resolveEndpointPointerAction("up", "mouse")).toBe("toggle-pin-keep-hover");
  });
});

describe("resolveEndpointPointerAction, with a finger", () => {
  it("ignores the synthetic enter/leave a tap produces", () => {
    expect(resolveEndpointPointerAction("enter", "touch")).toBe("ignore");
    expect(resolveEndpointPointerAction("leave", "touch")).toBe("ignore");
  });

  it("pins on tap, and unpins to nothing — no finger is left resting on it", () => {
    expect(resolveEndpointPointerAction("up", "touch")).toBe("toggle-pin-clear");
  });

  it("treats a pen the same as a finger", () => {
    expect(resolveEndpointPointerAction("enter", "pen")).toBe("ignore");
    expect(resolveEndpointPointerAction("up", "pen")).toBe("toggle-pin-clear");
  });

  it("degrades an unknown or empty pointerType to tap-to-pin, never to nothing", () => {
    expect(resolveEndpointPointerAction("up", "")).toBe("toggle-pin-clear");
    expect(resolveEndpointPointerAction("up", "something-new")).toBe("toggle-pin-clear");
    expect(resolveEndpointPointerAction("enter", "")).toBe("ignore");
  });
});
