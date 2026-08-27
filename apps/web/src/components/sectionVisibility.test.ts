import { describe, expect, it } from "vitest";

import {
  allSectionsVisible,
  groupState,
  readSectionVisibility,
  setGroupVisibility,
  toggleGroup,
  writeSectionVisibility,
} from "./sectionVisibility";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function throwingStorage(): Storage {
  return {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
    removeItem: () => {
      throw new Error("storage unavailable");
    },
    clear: () => {
      throw new Error("storage unavailable");
    },
    key: () => {
      throw new Error("storage unavailable");
    },
    length: 0,
  };
}

describe("readSectionVisibility", () => {
  it("defaults to all visible when nothing is stored", () => {
    expect(readSectionVisibility(fakeStorage())).toEqual(allSectionsVisible());
  });

  it("hides only the stored-false section, leaving the rest visible", () => {
    expect(
      readSectionVisibility(
        fakeStorage({ "x32-section-visibility": JSON.stringify({ consoleOutputs: false }) }),
      ),
    ).toEqual({ ...allSectionsVisible(), consoleOutputs: false });
  });

  it("defaults to all visible for malformed JSON, without throwing", () => {
    expect(() =>
      readSectionVisibility(fakeStorage({ "x32-section-visibility": "not json" })),
    ).not.toThrow();
    expect(readSectionVisibility(fakeStorage({ "x32-section-visibility": "not json" }))).toEqual(
      allSectionsVisible(),
    );
  });

  it("defaults to all visible when storage throws, without throwing itself", () => {
    expect(() => readSectionVisibility(throwingStorage())).not.toThrow();
    expect(readSectionVisibility(throwingStorage())).toEqual(allSectionsVisible());
  });

  it("ignores an unknown section id in stored data, and defaults a missing known id to visible", () => {
    expect(
      readSectionVisibility(
        fakeStorage({
          "x32-section-visibility": JSON.stringify({
            stage: false,
            madeUpSection: false,
          }),
        }),
      ),
    ).toEqual({ ...allSectionsVisible(), stage: false });
  });
});

describe("readSectionVisibility, across the console section split", () => {
  it("applies a legacy combined `console: false` to both halves", () => {
    expect(
      readSectionVisibility(
        fakeStorage({ "x32-section-visibility": JSON.stringify({ console: false }) }),
      ),
    ).toEqual({ ...allSectionsVisible(), consoleInputs: false, consoleOutputs: false });
  });

  it("lets the split ids win over a legacy `console` in the same record", () => {
    expect(
      readSectionVisibility(
        fakeStorage({
          "x32-section-visibility": JSON.stringify({
            console: false,
            consoleInputs: true,
          }),
        }),
      ),
    ).toEqual({ ...allSectionsVisible(), consoleInputs: true, consoleOutputs: false });
  });

  it("defaults both halves to visible when the record predates them entirely", () => {
    expect(
      readSectionVisibility(
        fakeStorage({ "x32-section-visibility": JSON.stringify({ channels: false }) }),
      ),
    ).toEqual({ ...allSectionsVisible(), channels: false });
  });

  it("ignores a non-boolean legacy `console` rather than throwing", () => {
    expect(
      readSectionVisibility(
        fakeStorage({ "x32-section-visibility": JSON.stringify({ console: "no" }) }),
      ),
    ).toEqual(allSectionsVisible());
  });
});

describe("section groups", () => {
  it("reports `all` when every section of the group is visible", () => {
    expect(groupState(allSectionsVisible(), "inputs")).toBe("all");
    expect(groupState(allSectionsVisible(), "outputs")).toBe("all");
  });

  it("reports `none` when every section of the group is hidden", () => {
    const hidden = setGroupVisibility(allSectionsVisible(), "outputs", false);
    expect(groupState(hidden, "outputs")).toBe("none");
    // The other group is untouched.
    expect(groupState(hidden, "inputs")).toBe("all");
  });

  it("reports `some` when the group is partly visible", () => {
    expect(groupState({ ...allSectionsVisible(), channels: false }, "inputs")).toBe("some");
    expect(groupState({ ...allSectionsVisible(), consoleOutputs: false }, "outputs")).toBe(
      "some",
    );
  });

  it("puts the two console halves in different groups", () => {
    const inputsOnly = setGroupVisibility(allSectionsVisible(), "outputs", false);
    expect(inputsOnly.consoleInputs).toBe(true);
    expect(inputsOnly.consoleOutputs).toBe(false);
  });

  it("toggling a fully visible group hides it", () => {
    expect(toggleGroup(allSectionsVisible(), "inputs")).toEqual({
      ...allSectionsVisible(),
      stage: false,
      consoleInputs: false,
      channels: false,
    });
  });

  it("toggling a hidden group shows it", () => {
    const hidden = setGroupVisibility(allSectionsVisible(), "inputs", false);
    expect(toggleGroup(hidden, "inputs")).toEqual(allSectionsVisible());
  });

  it("toggling a partly visible group shows the rest rather than hiding it", () => {
    const partial = { ...allSectionsVisible(), channels: false };
    expect(toggleGroup(partial, "inputs")).toEqual(allSectionsVisible());
  });
});

describe("writeSectionVisibility", () => {
  it("write round-trips through read", () => {
    const storage = fakeStorage();
    const visibility = { ...allSectionsVisible(), consoleInputs: false, outputs: false };
    writeSectionVisibility(storage, visibility);
    expect(readSectionVisibility(storage)).toEqual(visibility);
  });

  it("swallows a throwing storage without throwing", () => {
    expect(() => writeSectionVisibility(throwingStorage(), allSectionsVisible())).not.toThrow();
  });
});
