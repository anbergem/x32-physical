import { deviceId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { formatAes50ChainDetail, formatAes50ChainWarning, formatAes50LinkWarning } from "./aes50";

describe("formatAes50LinkWarning", () => {
  it("names the bus and the physical thing to check", () => {
    expect(formatAes50LinkWarning("A")).toBe("AES50-A: link error — check the stage boxes");
    expect(formatAes50LinkWarning("B")).toBe("AES50-B: link error — check the stage boxes");
  });
});

describe("formatAes50ChainWarning", () => {
  it("is a quieter, non-specific headline", () => {
    expect(formatAes50ChainWarning()).toBe("Stage boxes differ from configuration");
  });
});

describe("formatAes50ChainDetail", () => {
  it("describes a box-count mismatch", () => {
    expect(
      formatAes50ChainDetail({ kind: "box-count-mismatch", bus: "A", expected: 2, actual: 1 }),
    ).toBe("AES50-A: 1 box(es) detected, 2 declared in installation.yaml");
  });

  it("describes an input-count mismatch", () => {
    expect(
      formatAes50ChainDetail({
        kind: "input-count-mismatch",
        bus: "A",
        position: 1,
        device: deviceId("stagebox-1"),
        expectedInputs: 16,
        detectedModel: "S32",
        detectedInputs: 32,
      }),
    ).toBe("AES50-A position 1: detected S32 (32 in) but stagebox-1 declares 16 in");
  });
});
