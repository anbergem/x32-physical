/**
 * Loads the venue topology at startup.
 *
 * In a production build, this first tries the bridge's own copy over
 * `GET /api/installation` (issue #3, architecture.md §7) — the file a tech
 * edits and restarts the service for, no rebuild required. If that request
 * fails outright, 404s (missing/invalid file — `apps/x32-bridge/src/
 * installationFile.ts`), or returns a body `parseInstallationYaml` cannot
 * parse, it falls back to the copy Vite bundled as raw text at build time.
 * That bundled copy is the one and only safety net: whatever else breaks,
 * the schematic still renders, never a blank page.
 *
 * Under the Vite dev server (`import.meta.env.DEV`) the fetch is skipped
 * entirely and the bundled copy is used directly — mock-mode development
 * needs no bridge running at all, matching how `resolveBridgeUrl` already
 * branches on `DEV`.
 *
 * Either way, `parseInstallationYaml` (the browser-safe entry point of
 * `@x32/installation`) is the only thing that turns text into an
 * `Installation`, so the bridge and the browser can never disagree about
 * what a file means (architecture.md §7's "one parser" decision). The
 * topology is static (CLAUDE.md invariant 1), so this runs exactly once,
 * before the store exists.
 *
 * Failures propagate only when *both* sources are unusable: a broken or
 * invalid bundled fallback must render as a clear startup error, never as a
 * blank page or half a schematic. Bootstrap catches it — see `main.tsx`.
 */

import type { Installation } from "@x32/domain";
import { parseInstallationYaml } from "@x32/installation";

import installationYaml from "../../../../config/installation.yaml?raw";

/** How the bundled fallback is named in parse/validation error messages. */
const SOURCE = "config/installation.yaml";

/** The bridge's own copy, served raw (architecture.md §7). */
const API_PATH = "/api/installation";

/** How the fetched copy is named in parse/validation error messages. */
const API_SOURCE = API_PATH;

/**
 * What the operator can do about a failure *from this loader*. It travels with
 * the loader so no other failure inherits advice that does not apply to it.
 */
export const INSTALLATION_ERROR_HINT = `Fix ${SOURCE} and reload.`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses the bundled copy — the guaranteed-available fallback. */
function loadBundledInstallation(): Installation {
  return parseInstallationYaml(installationYaml, SOURCE);
}

/**
 * Tries `GET /api/installation`. Returns the parsed `Installation` on
 * success; returns `null` (never throws) on any failure — a rejected fetch,
 * a non-200 response, or a body that fails to parse — logging which case it
 * was so the fallback is traceable in the console.
 */
async function tryFetchInstallation(
  fetchImpl: typeof fetch,
): Promise<Installation | null> {
  let response: Response;
  try {
    response = await fetchImpl(API_PATH);
  } catch (error) {
    console.warn(
      `x32: could not reach ${API_PATH} (${errorMessage(error)}); using the bundled installation copy instead`,
    );
    return null;
  }

  if (!response.ok) {
    console.warn(
      `x32: ${API_PATH} returned ${response.status}; using the bundled installation copy instead`,
    );
    return null;
  }

  const text = await response.text();
  try {
    const installation = parseInstallationYaml(text, API_SOURCE);
    console.log(`x32: loaded installation topology from ${API_PATH}`);
    return installation;
  } catch (error) {
    console.warn(
      `x32: ${API_PATH} returned a body that failed to parse (${errorMessage(error)}); using the bundled installation copy instead`,
    );
    return null;
  }
}

export interface LoadInstallationOptions {
  /** Injected for tests — never hits the network otherwise. Defaults to `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests. Defaults to `import.meta.env`. */
  env?: ImportMetaEnv;
}

export async function loadInstallation(
  options: LoadInstallationOptions = {},
): Promise<Installation> {
  const env = options.env ?? import.meta.env;

  if (!env.DEV) {
    const fetchImpl = options.fetch ?? fetch;
    const fetched = await tryFetchInstallation(fetchImpl);
    if (fetched !== null) return fetched;
  }

  console.log(`x32: using the bundled installation copy (${SOURCE})`);
  return loadBundledInstallation();
}
