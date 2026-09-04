/**
 * Locating and seeding the venue's `installation.yaml` at bridge startup, so
 * that a live file exists to be read, served over `GET /api/installation`
 * (architecture.md §7) and — since issue #27 — edited.
 *
 * Reading and writing that file is `DiskInstallationRepository`'s job
 * (`./installationRepository.ts`): one reader and one writer, so a startup
 * load and an edit can never disagree about what is on disk. The bridge
 * itself has no topology/route-index concerns (CLAUDE.md invariant 2) — it
 * re-serves the raw YAML bytes so the browser's own `parseInstallationYaml`
 * stays the single place text becomes an `Installation` (architecture.md §7's
 * "one parser" decision).
 *
 * **Two files, and the difference matters** (issue #26):
 *
 * - The **live** file is venue data. It lives in the bridge's state
 *   directory next to `baseline.json` (`%ProgramData%\X32PhysicalRoutingVisualizer\`
 *   under the MSI, `data/` in dev) — a directory the installer creates,
 *   grants `Users` Modify on, and **never removes or overwrites**, on
 *   upgrade or uninstall. `config.ts`'s `resolveInstallationFilePath`
 *   resolves it.
 * - The **shipped** copy (`shippedInstallationSeedPath()`, inside
 *   `%ProgramFiles%`) is only ever a *seed*. That folder is removed and
 *   reinstalled by every MSI upgrade, so anything edited there is destroyed
 *   by the next release — which is precisely why the live file moved out of
 *   it.
 *
 * Seeding therefore only ever *creates* the live file, never replaces one
 * (`seedInstallationFile`). A release must not silently overwrite a venue's
 * topology, the same rule `baselineStore.ts` already follows for the blessed
 * baseline.
 *
 * A missing or invalid live file is never fatal: it is logged once and the
 * route 404s (`bridgeServer.ts`). The web app renders its startup error in
 * that case rather than a topology from anywhere else — showing a stranger's
 * wiring would be worse than saying nothing (issue #26).
 */

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The live file's (and the shipped seed's) basename, in every location. */
export const INSTALLATION_FILE_NAME = "installation.yaml";

/**
 * The live installation file when nothing in the environment says otherwise:
 * `data/installation.yaml`, relative to the bridge process's cwd — the same
 * default state directory `config.ts`'s `DEFAULT_BASELINE_FILE` puts
 * `baseline.json` in. Under the MSI both are absolute `%ProgramData%` paths
 * instead (`deploy/msi/winsw/X32PhysicalRoutingVisualizer.xml`), so this default is
 * really the dev one.
 */
export const DEFAULT_INSTALLATION_FILE = join("data", INSTALLATION_FILE_NAME);

/**
 * The read-only copy a release ships, resolved next to the running server
 * module — the same pattern `updateCheck.ts`'s `defaultVersionFilePath` uses
 * for `VERSION`. After `scripts/release-build.mjs` bundles the bridge into
 * `dist/release/app/server.mjs`, this resolves to
 * `dist/release/app/config/installation.yaml`, which the MSI harvests into
 * `%ProgramFiles%\X32 Physical Routing Visualizer\config\`.
 *
 * This is a **seed only**. It is never the file the app reads at runtime and
 * never the file a technician edits: `MajorUpgrade` removes and reinstalls
 * that folder wholesale.
 */
export function shippedInstallationSeedPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "config", INSTALLATION_FILE_NAME);
}

/** What `seedInstallationFile` did — reported so the caller can log it. */
export type InstallationSeedOutcome =
  /** The live file already existed. Left exactly as it was. */
  | "already-present"
  /** The live file was absent and has been created from the shipped copy. */
  | "seeded"
  /** Nothing to seed from: no shipped copy at `seedPath`. */
  | "no-seed"
  /** The copy was attempted and failed; logged, and not fatal. */
  | "failed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best-effort cleanup of our own temp file; a leftover `.tmp` next to the
    // installation file is untidy, never harmful, and must not mask the real
    // error being reported.
  }
}

/**
 * Creates `targetPath` from `seedPath` **only when `targetPath` does not
 * exist** (issue #26).
 *
 * The condition is the entire point: the live file is venue data that must
 * outlive every release, so an existing one always wins — including one the
 * operator edited five minutes ago, and including one a previous release
 * seeded. A release that overwrote it would destroy a venue's topology
 * silently, discovered months later by someone who did not make the edits.
 *
 * The copy goes through a temp file + `rename`, the same crash-safety
 * `baselineStore.ts` uses: the target is either absent or the complete seed,
 * never half a file. Never throws — a read-only state directory or a missing
 * seed must not stop the bridge from starting.
 */
export function seedInstallationFile(
  targetPath: string,
  seedPath: string = shippedInstallationSeedPath(),
): InstallationSeedOutcome {
  if (existsSync(targetPath)) return "already-present";
  if (!existsSync(seedPath)) return "no-seed";

  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(seedPath, tempPath);

    // Re-checked after the copy, because `rename` would happily replace a
    // file that appeared in between — "never overwrite" is the invariant,
    // not "usually don't".
    if (existsSync(targetPath)) {
      removeQuietly(tempPath);
      return "already-present";
    }
    renameSync(tempPath, targetPath);
  } catch (error) {
    removeQuietly(tempPath);
    console.warn(
      `x32-bridge: could not seed ${targetPath} from ${seedPath} (${errorMessage(error)}) — continuing without it`,
    );
    return "failed";
  }

  console.log(
    `x32-bridge: no installation file at ${targetPath} — seeded it from the shipped copy ${seedPath}`,
  );
  return "seeded";
}
