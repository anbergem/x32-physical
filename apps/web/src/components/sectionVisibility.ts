/**
 * Pure read/parse/default logic for which top-level schematic sections are
 * shown. Persisted in `localStorage` as one JSON record so a tech who hides
 * a section on this venue's always-on machine doesn't find it back on every
 * reload.
 *
 * Local UI state, not store state (architecture.md §5): this is neither
 * mixer configuration nor mixer runtime, so it lives in component state, the
 * same way `saveBaselineDialog.ts` keeps the confirmation dialog out of the
 * store. Factored out here so the read/parse/default logic is testable
 * without a DOM stack.
 *
 * Defaults to visible whenever storage is unavailable, empty, malformed, or
 * throws — a hidden-by-default section is a section nobody finds, and a
 * storage failure must never break rendering. The whole record is persisted
 * as one JSON value, so adding a section later is additive: an id missing
 * from stored data defaults to visible, and an id in stored data that this
 * build no longer recognises is ignored rather than crashing.
 */

const STORAGE_KEY = "x32-section-visibility";

export const SECTION_IDS = ["stage", "destinations", "console", "channels", "outputs"] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type SectionVisibility = Record<SectionId, boolean>;

function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

/** Everything visible — the fallback for absent, malformed, or failed storage. */
export function allSectionsVisible(): SectionVisibility {
  return {
    stage: true,
    destinations: true,
    console: true,
    channels: true,
    outputs: true,
  };
}

/**
 * Reads the persisted preference. Any failure, absent value, or malformed
 * JSON means everything visible. An unknown section id in stored data is
 * ignored; a known id missing from stored data defaults to visible.
 */
export function readSectionVisibility(storage: Storage): SectionVisibility {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return allSectionsVisible();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return allSectionsVisible();

    const result = allSectionsVisible();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSectionId(key) && typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return allSectionsVisible();
  }
}

/** Persists the whole record. A write failure is swallowed — never breaks rendering. */
export function writeSectionVisibility(storage: Storage, visibility: SectionVisibility): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Best-effort only: a tech's toggle should still work this session even
    // if it can't be remembered for the next one.
  }
}
