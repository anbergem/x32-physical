import { describe, expect, it } from "vitest";

import { isMeterHot, meterBarHeightPercent } from "./meter";

describe("meterBarHeightPercent", () => {
  it("maps the verified reference points (dB curve, -60 dBFS floor)", () => {
    // docs/x32-protocol.md §Meters — measured against the real console.
    expect(meterBarHeightPercent(1.0)).toBeCloseTo(100, 0);
    expect(meterBarHeightPercent(0.5)).toBeCloseTo(90, 0);
    expect(meterBarHeightPercent(0.25)).toBeCloseTo(80, 0);
    expect(meterBarHeightPercent(0.1)).toBeCloseTo(67, 0);
    expect(meterBarHeightPercent(0.01)).toBeCloseTo(33, 0);
    expect(meterBarHeightPercent(0.001)).toBeCloseTo(0, 0);
  });

  it("maps 0 -> 0", () => {
    expect(meterBarHeightPercent(0)).toBe(0);
  });

  it("clamps out-of-range input", () => {
    expect(meterBarHeightPercent(-0.5)).toBe(0);
    expect(meterBarHeightPercent(1.5)).toBe(100);
  });

  it("is monotonically non-decreasing", () => {
    const samples = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.7, 0.9, 1];
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
