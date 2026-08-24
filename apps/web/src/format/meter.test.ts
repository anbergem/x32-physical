import { describe, expect, it } from "vitest";

import { isMeterHot, meterBarHeightPercent } from "./meter";

describe("meterBarHeightPercent", () => {
  it("maps 0 -> 0 and 1 -> 100", () => {
    expect(meterBarHeightPercent(0)).toBe(0);
    expect(meterBarHeightPercent(1)).toBe(100);
  });

  it("boosts quiet levels above their linear share (sqrt curve)", () => {
    // sqrt(0.25) = 0.5 -> 50, well above the linear 25.
    expect(meterBarHeightPercent(0.25)).toBeCloseTo(50, 5);
  });

  it("clamps out-of-range input", () => {
    expect(meterBarHeightPercent(-0.5)).toBe(0);
    expect(meterBarHeightPercent(1.5)).toBe(100);
  });

  it("is monotonically non-decreasing", () => {
    const samples = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1];
    for (let i = 1; i < samples.length; i += 1) {
      expect(meterBarHeightPercent(samples[i]!)).toBeGreaterThanOrEqual(
        meterBarHeightPercent(samples[i - 1]!),
      );
    }
  });
});

describe("isMeterHot", () => {
  it("is false below the threshold and true at/above it", () => {
    expect(isMeterHot(84.9)).toBe(false);
    expect(isMeterHot(85)).toBe(true);
    expect(isMeterHot(100)).toBe(true);
  });
});
