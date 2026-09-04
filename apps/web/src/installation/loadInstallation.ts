/**
 * Loads the venue topology at startup, from the bridge and nowhere else:
 * `GET /api/installation` (issue #3, architecture.md §7) serves the raw YAML
 * of the live `installation.yaml`, the file a tech edits and restarts the
 * service for — no rebuild required.
 *
 * **There is deliberately no bundled fallback** (issue #26). This app used to
 * ship a build-time `?raw` copy of `config/installation.yaml` and fall back
 * to it whenever the endpoint failed. That guaranteed *something* rendered,
 * but the something could be a stale — or, once anyone else clones this repo,
 * an entirely foreign — installation, presented with exactly the same
 * confidence as the real one. For a tool whose whole job is answering "which
 * socket is this channel on?", a confident wrong answer is the worst possible
 * failure. So a failure here is a failure: `main.tsx` renders the full-page
 * startup error with `INSTALLATION_ERROR_HINT`, and the operator learns the
 * bridge is not serving its topology instead of being quietly misled.
 *
 * Dropping the bundled copy is also what lets `config/installation.yaml` stay
 * out of the repository entirely (issue #24) — the build no longer needs a
 * venue's wiring to exist.
 *
 * One code path, dev and production alike: under the Vite dev server the
 * `/api` proxy in `apps/web/vite.config.ts` forwards this same request to the
 * bridge's own port, so nothing here branches on `import.meta.env.DEV`.
 *
 * `parseInstallationYaml` (the browser-safe entry point of
 * `@x32/installation`) is the only thing that turns text into an
 * `Installation`, so the bridge and the browser can never disagree about what
 * a file means (architecture.md §7's "one parser" decision). The topology is
 * static (CLAUDE.md invariant 1), so this runs exactly once, before the store
 * exists.
 */

import type { Installation } from "@x32/domain";
import { parseInstallationYaml } from "@x32/installation";

/** The bridge's own copy, served raw (architecture.md §7). */
const API_PATH = "/api/installation";

/** How the fetched copy is named in parse/validation error messages. */
const API_SOURCE = API_PATH;

/**
 * What the operator can do about a failure *from this loader*. It travels with
 * the loader so no other failure inherits advice that does not apply to it.
 */
export const INSTALLATION_ERROR_HINT =
  "The venue topology comes from the bridge. Check that the X32 Physical " +
  "Routing Visualizer service is running, and that its installation.yaml loads " +
  "(the service log names the problem), then reload this page.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface LoadInstallationOptions {
  /** Injected for tests — never hits the network otherwise. Defaults to `fetch`. */
  fetch?: typeof fetch;
}

/**
 * The topology *and* the document it came from. The raw text is kept (issue
 * #27) because the editor needs it: mock mode applies operations to it in an
 * in-memory repository, and both modes hash it into the `version` an edit
 * quotes back as its `baseVersion`. It is the same text the bridge holds, byte
 * for byte — `GET /api/installation` serves the file verbatim.
 */
export interface LoadedInstallation {
  readonly installation: Installation;
  readonly text: string;
}

/**
 * Fetches and parses the topology. Throws — with the underlying failure as
 * `cause`, which `StartupError` renders — when the endpoint cannot be
 * reached, answers non-2xx (a missing or invalid file on the bridge 404s
 * here), or returns a body that fails to parse.
 */
export async function loadInstallation(
  options: LoadInstallationOptions = {},
): Promise<LoadedInstallation> {
  const fetchImpl = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(API_PATH);
  } catch (error) {
    throw new Error(`Could not reach ${API_PATH} to load the venue topology.`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }

  if (!response.ok) {
    throw new Error(
      `${API_PATH} returned ${response.status}. The bridge has no usable installation file.`,
    );
  }

  const text = await response.text();
  try {
    const installation = parseInstallationYaml(text, API_SOURCE);
    console.log(`x32: loaded installation topology from ${API_PATH}`);
    return { installation, text };
  } catch (error) {
    throw new Error(
      `${API_PATH} returned a document that is not a valid installation: ${errorMessage(error)}`,
    );
  }
}
