import { describe, expect, it } from "vitest";

import type { Aes50Chain } from "./aes50";
import { compareAes50Chain } from "./aes50";
import { venueInstallation } from "./__fixtures__/venue";

/**
 * The venue fixture declares two 16-in stageboxes on AES50-A (offsets 0 and
 * 16) — see `packages/domain/src/__fixtures__/venue.ts`.
 */
function s16Chain(bus: "A" | "B" = "A", count = 2): Aes50Chain {
  return {
    bus,
    boxes: Array.from({ length: count }, (_, index) => ({
      position: index + 1,
      model: "S16",
      rawLetter: "A",
    })),
  };
}

describe("compareAes50Chain", () => {
  it("no discrepancy when the declared count and models match", () => {
    const findings = compareAes50Chain(venueInstallation(), [s16Chain("A", 2)]);
    expect(findings).toEqual([]);
  });

  it("flags a count mismatch when fewer boxes are detected than declared", () => {
    const findings = compareAes50Chain(venueInstallation(), [s16Chain("A", 1)]);
    expect(findings).toEqual([
      { kind: "box-count-mismatch", bus: "A", expected: 2, actual: 1 },
    ]);
  });

  it("flags a count mismatch when more boxes are detected than declared", () => {
    const findings = compareAes50Chain(venueInstallation(), [s16Chain("A", 3)]);
    expect(findings).toEqual([
      { kind: "box-count-mismatch", bus: "A", expected: 2, actual: 3 },
    ]);
  });

  it("flags an input-count mismatch when a detected model's known input count disagrees with the declared inputs", () => {
    const chain: Aes50Chain = {
      bus: "A",
      boxes: [
        { position: 1, model: "S32", rawLetter: "W" }, // declared inputs: 16
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    };
    const findings = compareAes50Chain(venueInstallation(), [chain]);
    expect(findings).toEqual([
      {
        kind: "input-count-mismatch",
        bus: "A",
        position: 1,
        device: "stagebox-1",
        expectedInputs: 16,
        detectedModel: "S32",
        detectedInputs: 32,
      },
    ]);
  });

  it("an unknown/unrecognised letter (model: null) produces no discrepancy", () => {
    const chain: Aes50Chain = {
      bus: "A",
      boxes: [
        { position: 1, model: null, rawLetter: "?" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    };
    expect(compareAes50Chain(venueInstallation(), [chain])).toEqual([]);
  });

  it("empty chain data produces no discrepancy", () => {
    expect(compareAes50Chain(venueInstallation(), [{ bus: "A", boxes: [] }])).toEqual([]);
  });

  it("absent chain data (no entry for the bus at all) produces no discrepancy", () => {
    expect(compareAes50Chain(venueInstallation(), [])).toEqual([]);
  });

  it("never flags a bus the installation declares no stageboxes on", () => {
    // Bus B has no declared stageboxes in the venue fixture — even a
    // wildly mismatched detected chain on B must produce nothing.
    const findings = compareAes50Chain(venueInstallation(), [s16Chain("B", 5)]);
    expect(findings).toEqual([]);
  });

  it("is order-stable and never throws on malformed-looking input", () => {
    const findings1 = compareAes50Chain(venueInstallation(), [s16Chain("A", 1)]);
    const findings2 = compareAes50Chain(venueInstallation(), [s16Chain("A", 1)]);
    expect(findings1).toEqual(findings2);
  });
});
