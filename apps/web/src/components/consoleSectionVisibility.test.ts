import { describe, expect, it } from "vitest";

import {
  readConsoleSectionVisible,
  writeConsoleSectionVisible,
} from "./consoleSectionVisibility";

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

describe("readConsoleSectionVisible", () => {
  it("defaults to shown when nothing is stored", () => {
    expect(readConsoleSectionVisible(fakeStorage())).toBe(true);
  });

  it("reads a stored hidden preference", () => {
    expect(
      readConsoleSectionVisible(fakeStorage({ "x32-console-section-visible": "hidden" })),
    ).toBe(false);
  });

  it("defaults to shown when storage throws, without throwing itself", () => {
    expect(() => readConsoleSectionVisible(throwingStorage())).not.toThrow();
    expect(readConsoleSectionVisible(throwingStorage())).toBe(true);
  });

  it("defaults to shown for a garbage stored value", () => {
    expect(
      readConsoleSectionVisible(fakeStorage({ "x32-console-section-visible": "garbage" })),
    ).toBe(true);
  });
});

describe("writeConsoleSectionVisible", () => {
  it("persists shown and hidden", () => {
    const storage = fakeStorage();
    writeConsoleSectionVisible(storage, false);
    expect(readConsoleSectionVisible(storage)).toBe(false);
    writeConsoleSectionVisible(storage, true);
    expect(readConsoleSectionVisible(storage)).toBe(true);
  });

  it("swallows a throwing storage without throwing", () => {
    expect(() => writeConsoleSectionVisible(throwingStorage(), true)).not.toThrow();
  });
});
