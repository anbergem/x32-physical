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
 *
 * ## Groups
 *
 * Every section belongs to exactly one of two groups, by which half of the
 * signal path it shows: the console at FOH is *two* surfaces, not one, so
 * Mikserpult (FOH) is an input section and Console XLR outs is an output
 * section even though they are the same physical desk. That split is the
 * whole reason "all inputs" / "all outputs" can exist as toggles.
 */

const STORAGE_KEY = "x32-section-visibility";

/**
 * The id the pre-split build stored for the combined console section. Read
 * (and fanned out to both halves) but never written — see
 * `readSectionVisibility`.
 */
const LEGACY_CONSOLE_KEY = "console";

/** Input-side sections, in the order they appear in the popover. */
export const INPUT_SECTION_IDS = ["stage", "consoleInputs", "channels"] as const;

/** Output-side sections, in the order they appear in the popover. */
export const OUTPUT_SECTION_IDS = ["destinations", "consoleOutputs", "outputs"] as const;

export const SECTION_IDS = [...INPUT_SECTION_IDS, ...OUTPUT_SECTION_IDS] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type SectionVisibility = Record<SectionId, boolean>;

export type SectionGroupId = "inputs" | "outputs";

export const SECTION_GROUP_IDS: readonly SectionGroupId[] = ["inputs", "outputs"];

/** The sections a group covers. Every section is in exactly one group. */
export function sectionsInGroup(group: SectionGroupId): readonly SectionId[] {
  return group === "inputs" ? INPUT_SECTION_IDS : OUTPUT_SECTION_IDS;
}

function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

/** Everything visible — the fallback for absent, malformed, or failed storage. */
export function allSectionsVisible(): SectionVisibility {
  return {
    stage: true,
    consoleInputs: true,
    channels: true,
    destinations: true,
    consoleOutputs: true,
    outputs: true,
  };
}

/**
 * Reads the persisted preference. Any failure, absent value, or malformed
 * JSON means everything visible. An unknown section id in stored data is
 * ignored; a known id missing from stored data defaults to visible.
 *
 * One id gets special treatment: `console`, which older builds used for the
 * then-combined console section. It is applied to *both* halves before the
 * current ids are read, so a tech who had the console hidden still finds it
 * hidden after the split, and a record carrying both the legacy id and the
 * new ones lets the new ones win.
 */
export function readSectionVisibility(storage: Storage): SectionVisibility {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return allSectionsVisible();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return allSectionsVisible();

    const record = parsed as Record<string, unknown>;
    const result = allSectionsVisible();

    const legacyConsole = record[LEGACY_CONSOLE_KEY];
    if (typeof legacyConsole === "boolean") {
      result.consoleInputs = legacyConsole;
      result.consoleOutputs = legacyConsole;
    }

    for (const [key, value] of Object.entries(record)) {
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

/**
 * How much of a group is on screen. `some` is a real, reachable state — the
 * group toggle has to say "partly shown" rather than pick a side and lie, so
 * the checkbox renders indeterminate for it.
 */
export type GroupState = "all" | "some" | "none";

export function groupState(
  visibility: SectionVisibility,
  group: SectionGroupId,
): GroupState {
  const ids = sectionsInGroup(group);
  const shown = ids.filter((id) => visibility[id]).length;
  if (shown === ids.length) return "all";
  if (shown === 0) return "none";
  return "some";
}

/** Sets every section of one group at once, leaving the other group alone. */
export function setGroupVisibility(
  visibility: SectionVisibility,
  group: SectionGroupId,
  shown: boolean,
): SectionVisibility {
  const next = { ...visibility };
  for (const id of sectionsInGroup(group)) {
    next[id] = shown;
  }
  return next;
}

/**
 * What clicking a group toggle does: a fully shown group hides, and anything
 * else (none or partly shown) shows. The asymmetry is deliberate — from a
 * half-shown group the useful move is "give me all of this half", not "take
 * the rest away".
 */
export function toggleGroup(
  visibility: SectionVisibility,
  group: SectionGroupId,
): SectionVisibility {
  return setGroupVisibility(visibility, group, groupState(visibility, group) !== "all");
}
