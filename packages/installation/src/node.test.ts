import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveStaticEdges, endpointId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { loadInstallationFile } from "./node";

/** The repo's real `config/installation.yaml`, not a fixture copy. */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../config/installation.yaml", import.meta.url),
);

/**
 * Only the *confirmed* facts of docs/installation.md are asserted here. The
 * passive panels and their cabling are placeholders that the docs promise can
 * be replaced by a YAML-only edit, so nothing below may depend on them;
 * mapping and derivation are covered against the fixture in `parse.test.ts`.
 */
describe("loadInstallationFile", () => {
  it("loads and validates the venue configuration", () => {
    const installation = loadInstallationFile(VENUE_CONFIG);

    expect(
      installation.devices
        .filter((device) => device.kind === "stagebox")
        .map((device) => ({
          id: device.id,
          inputs: device.inputs,
          aes50: device.aes50,
        })),
    ).toEqual([
      { id: "stagebox-1", inputs: 16, aes50: { bus: "A", offset: 0 } },
      { id: "stagebox-2", inputs: 16, aes50: { bus: "A", offset: 16 } },
    ]);
  });

  it("derives the cascade: stagebox-2 input 7 is AES50-A 23", () => {
    const edges = deriveStaticEdges(loadInstallationFile(VENUE_CONFIG));

    expect(
      edges.map((edge) => ({
        from: endpointId(edge.from),
        to: endpointId(edge.to),
      })),
    ).toContainEqual({ from: "stagebox:stagebox-2:7", to: "aes50:A:23" });
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
