#!/usr/bin/env node
/**
 * Builds the Windows MSI installer (docs/plan.md step 19) from a staged
 * `pnpm release:build` output. Runs ONLY on Windows (`wix build` and the
 * toolchain it depends on are Windows-only) — this repo's own development
 * happens on macOS, so this script cannot be exercised there; it's exercised
 * end-to-end by `.github/workflows/release.yml`'s `build` job on
 * `windows-latest`, which is the entire point of the MSI approach (see the
 * step-17 supersession note in docs/plan.md).
 *
 * Usage:
 *   node scripts/build-msi.mjs \
 *     --app dist/release/app \
 *     --node C:\path\to\node.exe \
 *     --winsw C:\path\to\WinSW-x64.exe \
 *     --version 1.2.3 \
 *     [--out dist/release]
 *
 * Produces `<out>/X32RoutingVisualizer-<version>.msi`.
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildHarvestXml } from "./generate-msi-harvest.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MSI_SOURCE_DIR = join(ROOT, "deploy", "msi");

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

/** `x.y.z` only — MSI `ProductVersion` (via the `Package/@Version` field) requires a numeric dotted version; a `v` prefix or pre-release suffix (`1.2.3-rc1`) is invalid and must be stripped/rejected before this point. */
export function assertSemverTriple(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `build-msi: --version "${version}" is not a plain x.y.z version (MSI ProductVersion requires numeric dotted components; strip any leading "v" or pre-release suffix before calling this script).`,
    );
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.error(
      "build-msi: this script builds a Windows MSI via `wix build` and only runs on Windows " +
        `(current platform: ${process.platform}). Run it on windows-latest CI — see ` +
        ".github/workflows/release.yml's `build` job — not locally on macOS/Linux.",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const missing = ["app", "node", "winsw", "version"].filter((k) => args[k] === undefined);
  if (missing.length > 0) {
    console.error(
      `build-msi: missing required argument(s): ${missing.map((m) => `--${m}`).join(", ")}\n` +
        "Usage: node scripts/build-msi.mjs --app <dir> --node <node.exe> --winsw <WinSW.exe> --version <x.y.z> [--out <dir>]",
    );
    process.exit(1);
  }

  const appDir = resolve(args.app);
  const nodeExe = resolve(args.node);
  const winswExe = resolve(args.winsw);
  const version = args.version;
  const outDir = resolve(args.out ?? join(ROOT, "dist", "release"));

  assertSemverTriple(version);

  await mkdir(outDir, { recursive: true });

  const harvestFragment = join(outDir, "wix-generated", "AppFiles.wxs");
  console.log(`build-msi: harvesting ${appDir} -> ${harvestFragment}`);
  const harvestXml = await buildHarvestXml({
    sourceDir: appDir,
    directoryRefId: "INSTALLFOLDER",
    componentGroupId: "AppFiles",
  });
  await mkdir(dirname(harvestFragment), { recursive: true });
  await writeFile(harvestFragment, harvestXml, "utf8");

  const msiPath = join(outDir, `X32RoutingVisualizer-${version}.msi`);

  const wixArgs = [
    "build",
    join(MSI_SOURCE_DIR, "Product.wxs"),
    harvestFragment,
    "-ext",
    "WixToolset.Util.wixext",
    "-arch",
    "x64",
    "-d",
    `ProductVersion=${version}`,
    "-d",
    `NodeExePath=${nodeExe}`,
    "-d",
    `WinSwExePath=${winswExe}`,
    // License.rtf and winsw\X32RoutingVisualizer.xml are referenced from
    // Product.wxs with paths relative to that file — wix resolves relative
    // Source paths against the directory of the .wxs that declares them, so
    // no extra `-b` bind path is needed as long as `wix build` is invoked
    // with Product.wxs's own directory intact (it is, via the absolute path
    // above).
    "-out",
    msiPath,
  ];

  console.log(`build-msi $ wix ${wixArgs.join(" ")}`);
  execFileSync("wix", wixArgs, { cwd: ROOT, stdio: "inherit" });

  console.log(`build-msi: built ${msiPath}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("build-msi: failed:", error);
    process.exit(1);
  });
}
