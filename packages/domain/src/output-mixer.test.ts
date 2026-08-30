/**
 * `meterLevelForOutputSource` (issue #36).
 *
 * The contract these tests exist to protect is the difference between
 * **silent** (a real 0.0 reading) and **not metered** (`null`). Collapsing
 * the two would draw a working speaker as dead, which is precisely the false
 * alarm this tool exists to avoid.
 */

import { describe, expect, it } from "vitest";

import { meterLevelForOutputSource } from "./output-mixer";
import type { MixerSourceMeterLevels } from "./output-mixer";

function levels(): MixerSourceMeterLevels {
  return {
    buses: Array.from({ length: 16 }, (_, i) => (i + 1) / 100),
    matrices: Array.from({ length: 6 }, (_, i) => (i + 1) / 10),
  };
}

describe("meterLevelForOutputSource", () => {
  it("reads a bus level 1-based", () => {
    expect(meterLevelForOutputSource({ kind: "bus", bus: 1 }, levels())).toBe(0.01);
    expect(meterLevelForOutputSource({ kind: "bus", bus: 16 }, levels())).toBe(0.16);
  });

  it("reads a matrix level 1-based", () => {
    expect(meterLevelForOutputSource({ kind: "matrix", matrix: 1 }, levels())).toBe(0.1);
    expect(meterLevelForOutputSource({ kind: "matrix", matrix: 6 }, levels())).toBeCloseTo(0.6);
  });

  it("distinguishes a genuine zero from not-metered", () => {
    const silent: MixerSourceMeterLevels = {
      buses: Array.from({ length: 16 }, () => 0),
      matrices: Array.from({ length: 6 }, () => 0),
    };

    // A metered but silent bus is 0 — a real reading, rendered as an empty bar.
    expect(meterLevelForOutputSource({ kind: "bus", bus: 3 }, silent)).toBe(0);
    // An unmetered source is null — rendered as no bar at all.
    expect(meterLevelForOutputSource({ kind: "off" }, silent)).toBeNull();
  });

  it("returns null for every source kind the console's block does not carry", () => {
    // Main L/R, M/C, monitor and talkback live beyond /meters/0's 70 values,
    // in a block whose layout is not verified. At the maintainer's venue this
    // is Out 14 (M/C), which correctly shows no meter rather than a guess.
    const l = levels();
    expect(meterLevelForOutputSource({ kind: "main", side: "L" }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "main", side: "C" }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "monitor", side: "R" }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "talkback" }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "off" }, l)).toBeNull();
  });

  it("returns null for direct-outs, which are the input channel's own meter", () => {
    const l = levels();
    expect(meterLevelForOutputSource({ kind: "direct-out-aux", aux: 2 }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "direct-out-fx", ret: 3 }, l)).toBeNull();
  });

  it("returns null when no source-meter data is flowing at all", () => {
    expect(meterLevelForOutputSource({ kind: "bus", bus: 1 }, null)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "matrix", matrix: 1 }, null)).toBeNull();
  });

  it("returns null for an out-of-range index rather than undefined", () => {
    const l = levels();
    expect(meterLevelForOutputSource({ kind: "bus", bus: 17 }, l)).toBeNull();
    expect(meterLevelForOutputSource({ kind: "matrix", matrix: 7 }, l)).toBeNull();
  });
});
