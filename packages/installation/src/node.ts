/**
 * Node-only entry point (`@x32/installation/node`).
 *
 * The only module in this package that touches the filesystem; the package
 * index stays free of `node:fs` so the web app can import the schema and the
 * parser without a bundler shim.
 */

import type { Installation } from "@x32/domain";
import { readFileSync } from "node:fs";

import { parseInstallationYaml } from "./parse";

/**
 * Reads and validates an installation file.
 *
 * @throws Error if the file cannot be read, or if it fails YAML, schema or
 *         topology validation — every message names the file.
 */
export function loadInstallationFile(path: string): Installation {
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(
      `Cannot read installation file "${path}": ` +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
  }

  return parseInstallationYaml(text, path);
}
