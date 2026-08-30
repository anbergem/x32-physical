/**
 * Disk-backed baseline persistence (architecture.md §7). The bridge's own
 * JSON file (`X32_BASELINE_FILE`, default `data/baseline.json` — see
 * `./config.ts`) — this writes ONLY the bridge's own disk, never the mixer
 * (CLAUDE.md invariant 5).
 *
 * Writes go through a temp-file + rename so a crash mid-write cannot corrupt
 * the previous baseline (`rename` is atomic on the same filesystem, and the
 * temp file lives next to the target so it always is). Loads tolerate a
 * missing or corrupt file: a fresh install has no baseline file yet, and a
 * hand-edited or truncated one must not crash the bridge on startup — both
 * are logged and treated as "no baseline".
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { MixerSnapshot } from "@x32/mixer-contracts";
import { parseMixerSnapshot } from "@x32/protocol";

export interface BaselineStore {
  /** `null` when no baseline has ever been saved, or the file could not be read. */
  load(): Promise<MixerSnapshot | null>;
  save(snapshot: MixerSnapshot): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class DiskBaselineStore implements BaselineStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<MixerSnapshot | null> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isEnoent(error)) return null;
      console.warn(
        `x32-bridge: could not read baseline file ${this.#filePath} (${errorMessage(error)}) — starting with no baseline`,
      );
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return parseMixerSnapshot(parsed, "baseline file");
    } catch (error) {
      console.warn(
        `x32-bridge: could not read the baseline file ${this.#filePath} (${errorMessage(error)}) — ` +
          `starting with no baseline. This is expected after an upgrade that added a field: ` +
          `re-save it with "Save as correct". Nothing was written or deleted.`,
      );
      return null;
    }
  }

  async save(snapshot: MixerSnapshot): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const tempPath = `${this.#filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(snapshot, null, 2), "utf8");
    await rename(tempPath, this.#filePath);
  }
}
