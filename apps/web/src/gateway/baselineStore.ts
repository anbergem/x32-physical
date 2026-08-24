/**
 * Mock-mode baseline persistence (architecture.md §7): a small seam so
 * `LocalMockGateway` can bless a snapshot without a bridge process. The
 * production implementation is `localStorage`; tests inject an in-memory
 * fake implementing `StorageLike` so nothing here touches a real browser API.
 */

import type { MixerSnapshot } from "@x32/mixer-contracts";
import { parseMixerSnapshot } from "@x32/protocol";

export interface BaselineStore {
  /** `null` when nothing has ever been saved, or the persisted value is corrupt. */
  load(): MixerSnapshot | null;
  save(snapshot: MixerSnapshot): void;
}

/** The slice of the `Storage` API this store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "x32-physical:baseline";

function resolveLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw just from being accessed (privacy mode, disabled
    // storage) — treated the same as "not available".
    return null;
  }
}

export class LocalStorageBaselineStore implements BaselineStore {
  readonly #storage: StorageLike | null;

  constructor(storage: StorageLike | null = resolveLocalStorage()) {
    this.#storage = storage;
  }

  load(): MixerSnapshot | null {
    if (this.#storage === null) return null;

    let raw: string | null;
    try {
      raw = this.#storage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("LocalStorageBaselineStore: could not read persisted baseline", error);
      return null;
    }
    if (raw === null) return null;

    try {
      return parseMixerSnapshot(JSON.parse(raw), "persisted baseline");
    } catch (error) {
      console.warn(
        "LocalStorageBaselineStore: ignoring corrupt persisted baseline",
        error,
      );
      return null;
    }
  }

  save(snapshot: MixerSnapshot): void {
    if (this.#storage === null) return;
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("LocalStorageBaselineStore: failed to persist baseline", error);
    }
  }
}
