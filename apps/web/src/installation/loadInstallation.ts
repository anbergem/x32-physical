/**
 * Loads the venue topology at startup.
 *
 * `config/installation.yaml` is bundled as raw text by Vite and parsed with the
 * browser-safe entry point of `@x32/installation` (its `node:fs` loader lives
 * behind a separate subpath and never reaches a web bundle). The topology is
 * static (CLAUDE.md invariant 1), so this runs exactly once, before the store
 * exists.
 *
 * Failures propagate: a broken or invalid installation must render as a clear
 * startup error, never as a blank page or half a schematic. Bootstrap catches
 * it — see `main.tsx`.
 */

import type { Installation } from "@x32/domain";
import { parseInstallationYaml } from "@x32/installation";

import installationYaml from "../../../../config/installation.yaml?raw";

/** How the document is named in parse/validation error messages. */
const SOURCE = "config/installation.yaml";

/**
 * What the operator can do about a failure *from this loader*. It travels with
 * the loader so no other failure inherits advice that does not apply to it.
 */
export const INSTALLATION_ERROR_HINT = `Fix ${SOURCE} and reload.`;

export function loadInstallation(): Installation {
  return parseInstallationYaml(installationYaml, SOURCE);
}
