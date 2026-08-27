/**
 * Pure read/parse/default logic for whether the console section
 * (Mikserpult (FOH) + Console XLR outs, together as one unit) is shown or
 * collapsed. Persisted in `localStorage` so a tech who collapses it on this
 * venue's always-on machine doesn't find it back on every reload.
 *
 * Local UI state, not store state (architecture.md §5): this is neither
 * mixer configuration nor mixer runtime, so it lives in component state, the
 * same way `saveBaselineDialog.ts` keeps the confirmation dialog out of the
 * store. Factored out here so the read/parse/default logic is testable
 * without a DOM stack.
 *
 * Defaults to shown whenever storage is unavailable, empty, or throws — a
 * hidden-by-default section is a section nobody finds, and a storage failure
 * must never break rendering.
 */

const STORAGE_KEY = "x32-console-section-visible";

/** Reads the persisted preference. Any failure or garbage value means shown. */
export function readConsoleSectionVisible(storage: Storage): boolean {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw !== "hidden";
  } catch {
    return true;
  }
}

/** Persists the preference. A write failure is swallowed — never breaks rendering. */
export function writeConsoleSectionVisible(storage: Storage, visible: boolean): void {
  try {
    storage.setItem(STORAGE_KEY, visible ? "shown" : "hidden");
  } catch {
    // Best-effort only: a tech's toggle should still work this session even
    // if it can't be remembered for the next one.
  }
}
