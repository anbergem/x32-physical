/**
 * Disk-backed `InstallationRepository` (issue #27) — the venue's live
 * `installation.yaml`, read at startup and written by the edit pipeline.
 *
 * The interface, the in-memory implementation and the pipeline itself all live
 * in `@x32/installation`, which the web app shares; only this file knows about
 * the filesystem, exactly as `baselineStore.ts` is the only thing that knows
 * where `baseline.json` sits.
 *
 * Two properties are inherited deliberately from `DiskBaselineStore`, because
 * a second, subtly-different write path would be a defect rather than a
 * feature:
 *
 * - **Atomic**: the new text goes to a temp file next to the target and is
 *   `rename`d into place, so a crash mid-write cannot leave a half-written
 *   topology on disk (`rename` is atomic within one filesystem, and a sibling
 *   temp file always is).
 * - **Never silently destructive**: the previous contents are kept as
 *   `installation.yaml.bak` before the swap. There is no undo yet (epic #25's
 *   "known gaps"), so the last-known-good file stays within reach of a
 *   technician who is standing at the venue with the console in front of them.
 *
 * `read()` throws only when the file cannot be *read*. A file that reads but
 * does not parse or validate comes back with `installation: null` and the
 * loader's own layered message in `error`, which is what lets the bridge start
 * anyway (logging once and 404-ing `GET /api/installation`, issue #3) and what
 * lets the write pipeline read a broken file, reject the edit, and explain
 * itself instead of crashing.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  InstallationFileState,
  InstallationRepository,
} from "@x32/installation";
import {
  InstallationVersionConflictError,
  installationFileState,
} from "@x32/installation";

/** The previous contents, kept beside the live file on every successful write. */
export function backupPathFor(filePath: string): string {
  return `${filePath}.bak`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Best-effort cleanup of our own temp file: a leftover `.tmp` next to the
    // installation file is untidy, never harmful, and must not mask the real
    // error being reported.
  }
}

export class DiskInstallationRepository implements InstallationRepository {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  /** Where the live file is — used in log lines and in the parser's messages. */
  get filePath(): string {
    return this.#filePath;
  }

  async read(): Promise<InstallationFileState> {
    let text: string;
    try {
      text = await readFile(this.#filePath, "utf8");
    } catch (cause) {
      throw new Error(
        `Cannot read installation file "${this.#filePath}": ${errorMessage(cause)}`,
        { cause },
      );
    }
    return installationFileState(text, this.#filePath);
  }

  async write(text: string, expectedVersion: string): Promise<InstallationFileState> {
    // Re-checked here rather than trusted from the caller's earlier read: two
    // edits racing between read and write must not both land, and the file may
    // equally have been edited in Notepad in the meantime.
    const current = await this.read();
    if (current.version !== expectedVersion) {
      throw new InstallationVersionConflictError(expectedVersion, current.version);
    }

    await mkdir(dirname(this.#filePath), { recursive: true });

    // Back up first: if anything below fails, the venue still has both the
    // untouched live file and a copy of it.
    const backupTemp = `${this.#filePath}.${randomUUID()}.bak.tmp`;
    try {
      await writeFile(backupTemp, current.text, "utf8");
      await rename(backupTemp, backupPathFor(this.#filePath));
    } catch (error) {
      await removeQuietly(backupTemp);
      throw error;
    }

    const temp = `${this.#filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, text, "utf8");
      await rename(temp, this.#filePath);
    } catch (error) {
      await removeQuietly(temp);
      throw error;
    }

    return installationFileState(text, this.#filePath);
  }
}
