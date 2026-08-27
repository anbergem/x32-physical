import { describe, expect, it } from "vitest";

import {
  allSectionsVisible,
  readSectionVisibility,
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
        fakeStorage({ "x32-section-visibility": JSON.stringify({ console: false }) }),
      ),
    ).toEqual({ ...allSectionsVisible(), console: false });
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

describe("writeSectionVisibility", () => {
  it("write round-trips through read", () => {
    const storage = fakeStorage();
    const visibility = { ...allSectionsVisible(), console: false, outputs: false };
    writeSectionVisibility(storage, visibility);
    expect(readSectionVisibility(storage)).toEqual(visibility);
  });

  it("swallows a throwing storage without throwing", () => {
    expect(() => writeSectionVisibility(throwingStorage(), allSectionsVisible())).not.toThrow();
  });
});
