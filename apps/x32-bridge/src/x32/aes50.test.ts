import { describe, expect, it } from "vitest";

import { parseAes50Chain, parseAes50State } from "./aes50";

describe("parseAes50State", () => {
  it("0 -> all clear", () => {
    expect(parseAes50State(0)).toEqual({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });
  });

  it("bit 0 -> A audio error only", () => {
    expect(parseAes50State(0b00001)).toEqual({
      buses: [
        { bus: "A", audioError: true, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });
  });

  it("bit 1 -> B audio error only", () => {
    expect(parseAes50State(0b00010)).toEqual({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: true, auxError: false },
      ],
      locked: false,
    });
  });

  it("bits 0+2 -> A audio + A aux error", () => {
    expect(parseAes50State(0b00101)).toEqual({
      buses: [
        { bus: "A", audioError: true, auxError: true },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: false,
    });
  });

  it("bit 4 -> locked", () => {
    expect(parseAes50State(0b10000)).toEqual({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: true,
    });
  });

  it("an out-of-range/negative int is ignored (returns null)", () => {
    expect(parseAes50State(-1)).toBeNull();
    expect(parseAes50State(32)).toBeNull();
    expect(parseAes50State(1.5)).toBeNull();
  });
});

describe("parseAes50Chain", () => {
  it("'AA'-style input yields two boxes both mapped to S16", () => {
    expect(parseAes50Chain("A", "AA")).toEqual({
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    });
  });

  it("an unknown letter (a letter our table doesn't know) yields model: null with the raw letter retained", () => {
    // "b" (lowercase) is a plausible-looking device code but is not in the
    // 27-letter table — a gap in our table, not evidence of "no box".
    expect(parseAes50Chain("A", "bA")).toEqual({
      bus: "A",
      boxes: [
        { position: 1, model: null, rawLetter: "b" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    });
  });

  it("a string with non-letter filler yields only the real boxes", () => {
    expect(parseAes50Chain("A", "A  A")).toEqual({
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 4, model: "S16", rawLetter: "A" },
      ],
    });
  });

  it("an empty string yields none", () => {
    expect(parseAes50Chain("A", "")).toEqual({ bus: "A", boxes: [] });
  });

  it("only reads the first 4 characters as chain positions (preamp type follows)", () => {
    expect(parseAes50Chain("A", "AA00000000")).toEqual({
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    });
  });
});
