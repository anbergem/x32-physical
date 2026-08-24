import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildHarvestXml, buildHarvestXmlFromTree } from "./generate-msi-harvest.mjs";

describe("buildHarvestXmlFromTree (pure, no filesystem)", () => {
  it("emits one Component per file, nested Directory elements per subdir, and a matching ComponentGroup", () => {
    const tree = {
      relPath: "",
      type: "dir",
      children: [
        { name: "server.mjs", type: "file", relPath: "server.mjs", absPath: "/abs/server.mjs" },
        { name: "VERSION", type: "file", relPath: "VERSION", absPath: "/abs/VERSION" },
        {
          name: "web",
          type: "dir",
          relPath: "web",
          children: [
            { name: "index.html", type: "file", relPath: "web/index.html", absPath: "/abs/web/index.html" },
            {
              name: "assets",
              type: "dir",
              relPath: "web/assets",
              children: [
                {
                  name: "index-abc123.js",
                  type: "file",
                  relPath: "web/assets/index-abc123.js",
                  absPath: "/abs/web/assets/index-abc123.js",
                },
              ],
            },
          ],
        },
      ],
    };

    const xml = buildHarvestXmlFromTree(tree, { directoryRefId: "INSTALLFOLDER", componentGroupId: "AppFiles" });

    // Well-formedness sanity: every opened tag we author closes.
    for (const tag of ["Wix", "Fragment", "DirectoryRef", "ComponentGroup"]) {
      expect((xml.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length).toBe(
        (xml.match(new RegExp(`</${tag}>`, "g")) ?? []).length,
      );
    }

    expect(xml).toContain('<DirectoryRef Id="INSTALLFOLDER">');
    expect(xml).toContain('Source="/abs/server.mjs" Name="server.mjs"');
    expect(xml).toContain('Source="/abs/VERSION" Name="VERSION"');
    expect(xml).toContain('<Directory Id="dir_');
    expect(xml).toContain('Name="web"');
    expect(xml).toContain('Name="assets"');
    expect(xml).toContain('Source="/abs/web/index.html" Name="index.html"');
    expect(xml).toContain('Source="/abs/web/assets/index-abc123.js" Name="index-abc123.js"');

    // Every Component Id in the Directory fragment has a matching ComponentRef.
    const componentIds = [...xml.matchAll(/<Component Id="(cmp_[0-9a-f]+)"/g)].map((m) => m[1]);
    expect(componentIds).toHaveLength(4); // server.mjs, VERSION, index.html, index-abc123.js
    for (const id of componentIds) {
      expect(xml).toContain(`<ComponentRef Id="${id}" />`);
    }
    // No duplicate ids (hash collisions would be a real bug, not just a test artifact).
    expect(new Set(componentIds).size).toBe(componentIds.length);
  });

  it("is deterministic: same tree twice yields byte-identical XML", () => {
    const tree = {
      relPath: "",
      type: "dir",
      children: [{ name: "a.txt", type: "file", relPath: "a.txt", absPath: "/x/a.txt" }],
    };
    expect(buildHarvestXmlFromTree(tree)).toBe(buildHarvestXmlFromTree(tree));
  });

  it("XML-escapes filenames with special characters", () => {
    const tree = {
      relPath: "",
      type: "dir",
      children: [{ name: "a & b.txt", type: "file", relPath: "a & b.txt", absPath: "/x/a & b.txt" }],
    };
    const xml = buildHarvestXmlFromTree(tree);
    expect(xml).toContain("a &amp; b.txt");
    expect(xml).not.toContain('"a & b.txt"'); // raw & inside an attribute would be malformed XML
  });
});

describe("buildHarvestXml (reads the real filesystem)", () => {
  let workDir;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("throws a clear error for a missing source directory", async () => {
    await expect(buildHarvestXml({ sourceDir: "/does/not/exist/at/all" })).rejects.toThrow(/does not exist/);
  });

  it("throws a clear error for an empty source directory", async () => {
    workDir = await mkdtemp(join(tmpdir(), "harvest-empty-"));
    await expect(buildHarvestXml({ sourceDir: workDir })).rejects.toThrow(/is empty/);
  });

  it("harvests a small staged-looking tree from disk and covers every file", async () => {
    workDir = await mkdtemp(join(tmpdir(), "harvest-real-"));
    await writeFile(join(workDir, "server.mjs"), "// fake\n");
    await writeFile(join(workDir, "VERSION"), "0.0.0+abc\n");
    await mkdir(join(workDir, "web", "assets"), { recursive: true });
    await writeFile(join(workDir, "web", "index.html"), "<html></html>");
    await writeFile(join(workDir, "web", "assets", "index-xyz.js"), "console.log(1)");
    await mkdir(join(workDir, "config"), { recursive: true });
    await writeFile(join(workDir, "config", "installation.yaml"), "devices: []\n");

    const xml = await buildHarvestXml({ sourceDir: workDir });

    for (const name of ["server.mjs", "VERSION", "index.html", "index-xyz.js", "installation.yaml"]) {
      expect(xml).toContain(`Name="${name}"`);
    }
    // Nested directories must use their own leaf name, not the full
    // relative path from the harvest root (regression check).
    expect(xml).toContain('<Directory Id="dir_');
    expect(xml).toMatch(/<Directory Id="dir_[0-9a-f]+" Name="assets">/);
    expect(xml).not.toContain('Name="web/assets"');
    // Every File's Source is an absolute path rooted at workDir.
    const sources = [...xml.matchAll(/Source="([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBe(5);
    for (const src of sources) {
      expect(src.startsWith(workDir)).toBe(true);
    }
  });
});
