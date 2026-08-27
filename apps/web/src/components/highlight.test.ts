import { describe, expect, it } from "vitest";

import { hoverModifier, isHoveredEndpoint, selectionModifier } from "./highlight";

describe("hoverModifier", () => {
  it("maps the three transient states to one class each", () => {
    expect(hoverModifier("port", "none")).toBeNull();
    expect(hoverModifier("port", "hovered")).toBe("port--hovered");
    expect(hoverModifier("strip", "on-route")).toBe("strip--on-hovered-route");
  });

  it("gives a pinned endpoint the hovered class as well as the pinned one", () => {
    // Pinning is *what* is hovered, not a different kind of highlight, so
    // every hover rule must still apply to it.
    expect(hoverModifier("port", "pinned")).toBe("port--hovered port--pinned");
    expect(hoverModifier("strip", "pinned")).toBe("strip--hovered strip--pinned");
  });
});

describe("isHoveredEndpoint", () => {
  it("is true for the endpoint under the pointer and for a pinned one", () => {
    expect(isHoveredEndpoint("hovered")).toBe(true);
    expect(isHoveredEndpoint("pinned")).toBe(true);
  });

  it("is false for an endpoint merely on the route, or unrelated", () => {
    expect(isHoveredEndpoint("on-route")).toBe(false);
    expect(isHoveredEndpoint("none")).toBe(false);
  });
});

describe("hover and selection stay separate layers", () => {
  it("never produces the same class for a pinned endpoint and a selected one", () => {
    // The operator's pin and the console's SELECT can be on the same
    // element at once and must remain tellable apart.
    expect(hoverModifier("strip", "pinned")).not.toContain("selected");
    expect(selectionModifier("strip", "selected")).toBe("strip--selected");
  });
});
