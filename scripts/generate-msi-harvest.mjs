#!/usr/bin/env node
/**
 * Generates a WiX v5 Fragment that harvests every file under a directory
 * (recursively) into <Directory>/<Component>/<File> elements plus a
 * <ComponentGroup> referencing them, mirroring what `heat.exe` produces —
 * but deterministic, dependency-free, and small enough to unit-test (plan
 * step 19).
 *
 * Why not `heat.exe`: it isn't available on macOS (this repo is built here;
 * CI runs the actual `wix build` on windows-latest), and by default it mints
 * fresh random GUIDs on every run, which would make the file list (and thus
 * the generated Component `Guid` values) non-reproducible across builds. This
 * script uses `Guid="*"` (WiX auto-derives a stable GUID from the Component
 * Id + parent Directory at build time) and derives every Id from a hash of
 * the file's path relative to the harvest root, so re-running it against an
 * unchanged directory tree produces byte-identical output.
 *
 * The file list itself must never be hand-maintained (docs/plan.md step 19):
 * this is what keeps `deploy/msi/Product.wxs` in sync with whatever
 * `pnpm release:build` actually staged, including the web app's
 * content-hashed asset filenames.
 *
 * Usage (library): `buildHarvestXml({ sourceDir, directoryRefId, componentGroupId })`
 * Usage (CLI):
 *   node scripts/generate-msi-harvest.mjs \
 *     --source dist/release/app \
 *     --out dist/release/wix-generated/AppFiles.wxs \
 *     --directory-ref INSTALLFOLDER \
 *     --component-group AppFiles
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable, WiX-identifier-legal id: a letter prefix + a hash of the path, immune to length/character-set issues from long or hashed (e.g. Vite asset) filenames. */
function idFor(prefix, relativePosixPath) {
  const hash = createHash("sha1").update(relativePosixPath).digest("hex").slice(0, 16);
  return `${prefix}${hash}`;
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Recursively reads `sourceDir` into a sorted tree of
 * `{ name, type: "dir" | "file", relPath, absPath, children? }`. Sorted so
 * output is deterministic regardless of the OS's directory-listing order.
 */
async function readTree(sourceDir, relPath = "", name = "") {
  const absPath = join(sourceDir, relPath);
  const entries = (await readdir(absPath, { withFileTypes: true }))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const children = [];
  for (const entry of entries) {
    const childRel = relPath === "" ? entry.name : `${relPath}/${entry.name}`;
    if (entry.isDirectory()) {
      children.push(await readTree(sourceDir, childRel, entry.name));
    } else if (entry.isFile()) {
      children.push({ name: entry.name, type: "file", relPath: childRel, absPath: join(sourceDir, childRel) });
    }
    // symlinks / other special files: deliberately skipped — none are
    // expected in a `pnpm release:build` output, and silently harvesting a
    // symlink target would be surprising.
  }
  // `name` is the leaf directory name (e.g. "assets"), used for the WiX
  // <Directory Name="...">; `relPath` (the full path from the harvest root,
  // e.g. "web/assets") stays around only as hashing/traceability input.
  return { name, type: "dir", relPath, absPath, children };
}

/** Renders one directory's contents (its file Components, then nested Directory elements) at the given indent depth. */
function renderDirChildren(dir, indent, componentIds) {
  const pad = "  ".repeat(indent);
  const lines = [];

  const files = dir.children.filter((c) => c.type === "file");
  const dirs = dir.children.filter((c) => c.type === "dir");

  for (const file of files) {
    const componentId = idFor("cmp_", file.relPath);
    const fileId = idFor("fil_", file.relPath);
    componentIds.push(componentId);
    lines.push(`${pad}<Component Id="${componentId}" Guid="*">`);
    lines.push(
      `${pad}  <File Id="${fileId}" Source="${xmlEscape(file.absPath)}" Name="${xmlEscape(file.name)}" KeyPath="yes" />`,
    );
    lines.push(`${pad}</Component>`);
  }

  for (const subdir of dirs) {
    const dirId = idFor("dir_", subdir.relPath);
    lines.push(`${pad}<Directory Id="${dirId}" Name="${xmlEscape(subdir.name)}">`);
    lines.push(...renderDirChildren(subdir, indent + 1, componentIds));
    lines.push(`${pad}</Directory>`);
  }

  return lines;
}

/**
 * Builds the Fragment XML (as a string) harvesting `sourceDir`'s full
 * contents under `directoryRefId`, plus a `componentGroupId` ComponentGroup
 * referencing every harvested Component. Pure w.r.t. the *filesystem* it's
 * handed (the tree comes in already-read — see `buildHarvestXmlForDir` for
 * the disk-reading CLI entry point) so it's straightforward to unit-test.
 */
function renderHarvestXml(tree, { directoryRefId, componentGroupId }) {
  const componentIds = [];
  const dirLines = renderDirChildren(tree, 3, componentIds);

  const componentRefLines = componentIds.map((id) => `    <ComponentRef Id="${id}" />`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/generate-msi-harvest.mjs — do not hand-edit.
     Regenerate via scripts/build-msi.mjs; the source directory is the input. -->
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Fragment>
    <DirectoryRef Id="${directoryRefId}">
${dirLines.join("\n")}
    </DirectoryRef>
  </Fragment>
  <Fragment>
    <ComponentGroup Id="${componentGroupId}">
${componentRefLines.join("\n")}
    </ComponentGroup>
  </Fragment>
</Wix>
`;
}

/** Reads `sourceDir` off disk and returns the harvest Fragment XML. Throws if `sourceDir` doesn't exist or is empty (an empty harvest is always a build misconfiguration, never intentional). */
export async function buildHarvestXml({
  sourceDir,
  directoryRefId = "INSTALLFOLDER",
  componentGroupId = "AppFiles",
}) {
  // Always absolute: `wix build` resolves relative `File/@Source` paths
  // against its own working directory, which may differ from the one this
  // script was invoked from — an absolute path removes that ambiguity.
  const absoluteSourceDir = isAbsolute(sourceDir) ? sourceDir : resolve(sourceDir);

  const st = await stat(absoluteSourceDir).catch(() => null);
  if (st === null || !st.isDirectory()) {
    throw new Error(`generate-msi-harvest: source directory does not exist: ${absoluteSourceDir}`);
  }

  const tree = await readTree(absoluteSourceDir);
  if (tree.children.length === 0) {
    throw new Error(`generate-msi-harvest: source directory is empty: ${sourceDir}`);
  }

  return renderHarvestXml(tree, { directoryRefId, componentGroupId });
}

/** Exported for unit tests: harvests an in-memory tree (no filesystem) so the XML-shape logic is testable without touching disk. */
export function buildHarvestXmlFromTree(tree, options) {
  return renderHarvestXml(tree, {
    directoryRefId: options?.directoryRefId ?? "INSTALLFOLDER",
    componentGroupId: options?.componentGroupId ?? "AppFiles",
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.out) {
    console.error(
      "Usage: node scripts/generate-msi-harvest.mjs --source <dir> --out <file.wxs> [--directory-ref ID] [--component-group ID]",
    );
    process.exit(1);
  }

  const xml = await buildHarvestXml({
    sourceDir: args.source,
    directoryRefId: args["directory-ref"] ?? "INSTALLFOLDER",
    componentGroupId: args["component-group"] ?? "AppFiles",
  });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, xml, "utf8");
  console.log(`generate-msi-harvest: wrote ${args.out} (source: ${relative(process.cwd(), args.source)})`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  cli().catch((error) => {
    console.error("generate-msi-harvest: failed:", error);
    process.exit(1);
  });
}
