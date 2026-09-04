import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertXmlWellFormed } from "../../scripts/lib/xmlWellFormed.mjs";

// Hand-check only (docs/plan.md step 19, point 7): no XML parser is
// available anywhere in this repo's dependency tree, and WiX itself
// (the real authority — schema-validating, Windows-only) can't run on
// macOS. Real validation happens when `.github/workflows/release.yml`'s
// `build` job runs `wix build` on windows-latest.

const HERE = dirname(fileURLToPath(import.meta.url));

describe("deploy/msi source files are well-formed XML", () => {
  it("Product.wxs", async () => {
    const xml = await readFile(join(HERE, "Product.wxs"), "utf8");
    expect(() => assertXmlWellFormed(xml, { label: "Product.wxs" })).not.toThrow();
  });

  it("winsw/X32PhysicalRoutingVisualizer.xml", async () => {
    const xml = await readFile(join(HERE, "winsw", "X32PhysicalRoutingVisualizer.xml"), "utf8");
    expect(() => assertXmlWellFormed(xml, { label: "X32PhysicalRoutingVisualizer.xml" })).not.toThrow();
  });

  it("Product.wxs references only known WiX preprocessor variables", async () => {
    const xml = await readFile(join(HERE, "Product.wxs"), "utf8");
    const used = new Set([...xml.matchAll(/\$\(var\.(\w+)\)/g)].map((m) => m[1]));
    // Kept in sync by hand with scripts/build-msi.mjs's `-d` defines — a
    // Product.wxs variable this test doesn't know about is almost always a
    // typo that `wix build` would otherwise only catch on windows-latest CI.
    const definedByBuildScript = new Set(["ProductVersion", "NodeExePath", "WinSwExePath"]);
    for (const name of used) {
      expect(definedByBuildScript.has(name), `unexpected $(var.${name}) in Product.wxs`).toBe(true);
    }
  });
});
