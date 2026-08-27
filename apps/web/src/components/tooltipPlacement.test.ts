import { describe, expect, it } from "vitest";

import { placeTooltip } from "./tooltipPlacement";
import type { TooltipPlacementInput } from "./tooltipPlacement";

/** A socket in the middle of a desktop viewport, tooltip comfortably above. */
function input(overrides: Partial<TooltipPlacementInput> = {}): TooltipPlacementInput {
  return {
    anchor: { left: 500, right: 540, top: 400, bottom: 434 },
    tooltip: { width: 200, height: 60 },
    viewportWidth: 1440,
    safeTop: 56,
    gap: 7,
    margin: 8,
    ...overrides,
  };
}

describe("placeTooltip", () => {
  it("leaves a tooltip with room on both sides exactly where CSS put it", () => {
    expect(placeTooltip(input())).toEqual({ shiftX: 0, below: false });
  });

  it("nudges a tooltip that would run off the left edge back inside", () => {
    // Centred on a socket 20px from the left: natural left is -80.
    const { shiftX, below } = placeTooltip(
      input({ anchor: { left: 0, right: 40, top: 400, bottom: 434 } }),
    );
    expect(shiftX).toBe(88); // -80 -> +8, the margin
    expect(below).toBe(false);
  });

  it("nudges a tooltip that would run off the right edge back inside", () => {
    const { shiftX } = placeTooltip(
      input({ anchor: { left: 1400, right: 1440, top: 400, bottom: 434 } }),
    );
    // Natural left 1320, allowed max 1440 - 8 - 200 = 1232.
    expect(shiftX).toBe(-88);
  });

  it("pins a tooltip too wide for the viewport to the left margin, keeping its title readable", () => {
    const { shiftX } = placeTooltip(
      input({
        viewportWidth: 320,
        tooltip: { width: 400, height: 60 },
        anchor: { left: 140, right: 180, top: 400, bottom: 434 },
      }),
    );
    // Natural left 160 - 200 = -40; clamped to the margin, 8.
    expect(shiftX).toBe(48);
  });

  it("flips below when there is no room above the anchor", () => {
    // Anchor top 100: 100 - 7 - 60 = 33, above the 56px safe line.
    expect(placeTooltip(input({ anchor: { left: 500, right: 540, top: 100, bottom: 134 } })).below).toBe(
      true,
    );
  });

  it("stays above when the tooltip clears the safe line exactly", () => {
    // 123 - 7 - 60 = 56, not less than safeTop.
    expect(placeTooltip(input({ anchor: { left: 500, right: 540, top: 123, bottom: 157 } })).below).toBe(
      false,
    );
  });

  it("is independent of any correction already applied — one pass, no feedback", () => {
    const first = placeTooltip(input({ anchor: { left: 0, right: 40, top: 400, bottom: 434 } }));
    const second = placeTooltip(input({ anchor: { left: 0, right: 40, top: 400, bottom: 434 } }));
    expect(second).toEqual(first);
  });
});
