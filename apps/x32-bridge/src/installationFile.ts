/**
 * Loads the venue's `installation.yaml` at bridge startup so it can be
 * served to the web app over `GET /api/installation` (architecture.md §7).
 *
 * The bridge itself has no topology/route-index concerns (CLAUDE.md
 * invariant 2) — it only re-serves the raw YAML bytes so the browser's own
 * `parseInstallationYaml` stays the single place text becomes an
 * `Installation` (architecture.md §7's "one parser" decision). Validation
 * happens here anyway, via `@x32/installation/node`, purely to catch a bad
 * file at startup and log it loudly rather than silently serving garbage.
 *
 * A missing or invalid file is never fatal: it is logged once and the route
 * 404s (`bridgeServer.ts`) so the web app's bundled fallback takes over
 * (`apps/web/src/installation/loadInstallation.ts`) and the schematic still
 * renders.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadInstallationFile } from "@x32/installation/node";

/**
 * `config/installation.yaml`, resolved next to the running server module —
 * the same pattern `updateCheck.ts`'s `defaultVersionFilePath` uses for
 * `VERSION`. After `scripts/release-build.mjs` bundles the bridge into
 * `dist/release/app/server.mjs`, this resolves to
 * `dist/release/app/config/installation.yaml`, exactly where
 * `copyInstallationYaml` stages the venue's file.
 */
export function defaultInstallationFilePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "config", "installation.yaml");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads and validates the installation file at `path`, returning its exact
 * raw text on success — the bytes `GET /api/installation` serves verbatim.
 *
 * On any failure (unreadable file, invalid YAML, schema, or topology) logs
 * one `console.error` naming the file and the loader's own layered message,
 * and returns `null`. Never throws — a bad venue file must not stop the
 * bridge from starting or from serving the WS API and the built app.
 */
export function loadInstallationText(path: string): string | null {
  try {
    // Validates via the same layered parser the browser uses
    // (YAML syntax / schema / topology); throws a message naming `path`.
    loadInstallationFile(path);
  } catch (error) {
    console.error(`x32-bridge: failed to load installation file: ${errorMessage(error)}`);
    return null;
  }

  // Re-read for the exact source bytes — `loadInstallationFile` only
  // returns the parsed domain object, not the text it parsed.
  return readFileSync(path, "utf8");
}
