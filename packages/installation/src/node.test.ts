import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadInstallationFile } from "./node";

/**
 * The loader's own behaviour: reading a file, and naming it when either the
 * read or the validation fails. What a *particular* installation resolves to
 * — cascade arithmetic, panel renumbering, output blocks — is asserted
 * against the shared in-memory fixture instead
 * (`packages/domain/src/example-installation.test.ts`, issue #24), so no test
 * here depends on the contents of `config/installation.yaml`.
 */
/** A tiny invented document owned by this package, never `config/`. */
const EXAMPLE_YAML = fileURLToPath(
  new URL("./__fixtures__/example.yaml", import.meta.url),
);

describe("loadInstallationFile", () => {
  it("reads a file and maps it into a domain installation", () => {
    const installation = loadInstallationFile(EXAMPLE_YAML);

    expect(installation.devices.map((device) => device.id)).toEqual([
      "snake-a",
      "dsl-plate",
    ]);
    expect(installation.connections).toEqual([
      { from: { kind: "panel-input", device: "dsl-plate", input: 1 }, to: { kind: "stagebox-input", device: "snake-a", input: 1 } },
    ]);
  });

  it("names the file when it cannot be read", () => {
    const missing = fileURLToPath(
      new URL("../../../config/does-not-exist.yaml", import.meta.url),
    );

    expect(() => loadInstallationFile(missing)).toThrow(
      /Cannot read installation file .*does-not-exist\.yaml/,
    );
  });

  it("names the file path in validation errors", () => {
    const notYaml = fileURLToPath(new URL("./node.ts", import.meta.url));

    expect(() => loadInstallationFile(notYaml)).toThrow(/node\.ts/);
  });
});

/**
 * The one test that touches the shipped configuration, and the only thing it
 * may claim: whatever `config/installation.yaml` currently describes, it is
 * well-formed. No device names, no counts, no channel mappings — anyone may
 * replace that file with their own room.
 *
 * It skips rather than fails when the file is absent, so the file can be left
 * out of the repo entirely without the suite going red.
 */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../config/installation.yaml", import.meta.url),
);

describe.skipIf(!existsSync(VENUE_CONFIG))(
  "the shipped config/installation.yaml",
  () => {
    it("parses and validates", () => {
      const installation = loadInstallationFile(VENUE_CONFIG);

      expect(Array.isArray(installation.devices)).toBe(true);
      expect(Array.isArray(installation.connections)).toBe(true);
    });
  },
);

/**
 * Comments legitimately mention `node:fs`, so the guard below reads code only.
 * Crude but sufficient: string literals in these modules contain no comment
 * markers.
 */
function codeOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("the browser-safe entry point", () => {
  // `node.ts` is the only module here allowed to reach for Node. A stray
  // builtin or global elsewhere would break the web bundle, and nothing else
  // in the build would catch it: `types: ["node"]` covers the whole package.
  it.each(["index.ts", "parse.ts", "schema.ts"])(
    "%s reaches for nothing Node-only",
    (file) => {
      const code = codeOf(file);

      // Any specifier form: static import, `import()`, `require()`.
      expect(code).not.toMatch(/["']node:/);
      expect(code).not.toMatch(/\b(?:process|Buffer|__dirname|__filename)\b/);
    },
  );

  it("guards a module that does reach for Node", () => {
    // Proves the guard above can fail rather than passing vacuously.
    expect(codeOf("node.ts")).toMatch(/["']node:/);
  });
});
