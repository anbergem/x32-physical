/**
 * `LocalStorageBaselineStore` (architecture.md §7): round-trip, missing-key,
 * corrupt-value tolerance, and "storage unavailable" tolerance — all against
 * a fake `StorageLike`, never real `localStorage`.
 */

import { mixerChannelId } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it, vi } from "vitest";

import type { StorageLike } from "./baselineStore";
import { LocalStorageBaselineStore } from "./baselineStore";

function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function snapshot(): MixerSnapshot {
  return {
    channels: [
      {
        channel: mixerChannelId(3),
        name: "Overhead L",
        source: { kind: "aes50", bus: "A", channel: 3 },
      },
    ],
    selectedChannel: null,
  };
}

describe("LocalStorageBaselineStore", () => {
  it("returns null when nothing has been saved yet", () => {
    const store = new LocalStorageBaselineStore(fakeStorage());
    expect(store.load()).toBeNull();
  });

  it("round-trips a saved snapshot", () => {
    const storage = fakeStorage();
    const store = new LocalStorageBaselineStore(storage);

    store.save(snapshot());

    expect(store.load()).toEqual(snapshot());
    // A second store instance over the same storage sees the same value.
    expect(new LocalStorageBaselineStore(storage).load()).toEqual(snapshot());
  });

  it("tolerates a corrupt (non-JSON) persisted value: no baseline, no throw", () => {
    const storage = fakeStorage({ "x32-physical:baseline": "{ not json" });
    const store = new LocalStorageBaselineStore(storage);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(store.load()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tolerates a well-formed-JSON but malformed-shape persisted value", () => {
    const storage = fakeStorage({
      "x32-physical:baseline": JSON.stringify({ channels: "nope" }),
    });
    const store = new LocalStorageBaselineStore(storage);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(store.load()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("treats a null storage (unavailable) as always empty, without throwing", () => {
    const store = new LocalStorageBaselineStore(null);

    expect(store.load()).toBeNull();
    expect(() => store.save(snapshot())).not.toThrow();
  });

  it("tolerates a storage that throws on access", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    const store = new LocalStorageBaselineStore(throwing);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(store.load()).toBeNull();
    expect(() => store.save(snapshot())).not.toThrow();
    warn.mockRestore();
  });
});
