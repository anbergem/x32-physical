#!/usr/bin/env node
/**
 * Stages a self-contained production release under `dist/release/app/`
 * (plan step 16, architecture.md §6/§7):
 *
 *   dist/release/app/
 *     server.mjs        esbuild-bundled apps/x32-bridge/src/main.ts
 *     web/               the web app's Vite build, VITE_DEFAULT_MODE=live
 *     config/installation.yaml   the installation *seed*: the copy first run
 *                                creates the live file from (issue #26)
 *     VERSION            package.json version + git short hash
 *
 * Run the staged server with `node dist/release/app/server.mjs`, pointing
 * `X32_WEB_DIST` at `dist/release/app/web` (or leave it — `main.ts` doesn't
 * default it; step 17's launch scripts will).
 *
 * `config/installation.yaml` here is **not** the copy the running app uses
 * (issue #26). It is installed into `%ProgramFiles%`, which every MSI upgrade
 * removes and reinstalls, so the bridge copies it once into its state
 * directory (`%ProgramData%\X32RoutingVisualizer\`) and reads it from there
 * ever after, never overwriting what it finds. A cabling correction at the
 * venue is editing *that* file and restarting the service — no admin rights,
 * no rebuilt release, and nothing an upgrade can undo.
 */

import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RELEASE_DIR = join(ROOT, "dist", "release", "app");

/**
 * Windows ships pnpm/npm/npx as `.cmd` batch shims, and Node refuses to spawn
 * them at all without a shell: first ENOENT (CreateProcess only appends
 * `.exe`, so a bare "pnpm" is not found), then EINVAL once the `.cmd` suffix
 * is supplied — Node >= 18.20.2 / 20.12.2 blocks direct `.cmd`/`.bat`
 * execution outright as the fix for CVE-2024-27980. Both were observed on
 * `windows-latest` (release runs 32756040461 and 32811782261).
 *
 * A shell is therefore mandatory for these shims. Arguments are quoted
 * defensively on that path so a future caller passing a path with spaces
 * cannot be split by cmd.exe. Real executables (`git` here, `wix.exe` in
 * build-msi.mjs) spawn normally and deliberately do not take this route.
 */
const WINDOWS_SHIMS = new Set(["pnpm", "npm", "npx"]);

function quoteForShell(value) {
  return /[\s"^&|<>()%!]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function run(command, args, options = {}) {
  console.log(`release:build $ ${command} ${args.join(" ")}`);
  const useShell = process.platform === "win32" && WINDOWS_SHIMS.has(command);
  execFileSync(command, useShell ? args.map(quoteForShell) : args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: useShell,
    ...options,
  });
}

async function buildWeb() {
  run("pnpm", ["--filter", "@x32/web", "run", "build"], {
    env: { ...process.env, VITE_DEFAULT_MODE: "live" },
  });
}

async function bundleBridge() {
  const external = [
    // node builtins, both bare and `node:`-prefixed — everything else
    // (ws, and anything @x32/* pulls in, e.g. yaml/zod if a future step
    // wires the bridge to @x32/installation) gets bundled into server.mjs.
    ...builtinModules,
    ...builtinModules.map((mod) => `node:${mod}`),
    // ws's optional native accelerators — guarded by try/catch in ws itself,
    // and not installed here, so esbuild must not try to resolve them.
    "bufferutil",
    "utf-8-validate",
  ];

  await build({
    entryPoints: [join(ROOT, "apps/x32-bridge/src/main.ts")],
    outfile: join(RELEASE_DIR, "server.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external,
    logLevel: "info",
    // `ws` (a CJS package) calls `require("events")` etc. for node builtins;
    // in ESM output esbuild otherwise emits a shim that throws "Dynamic
    // require ... is not supported". Defining a real `require` via
    // `createRequire` up front is esbuild's own documented fix.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
  });
}

async function copyWebDist() {
  await cp(join(ROOT, "apps/web/dist"), join(RELEASE_DIR, "web"), { recursive: true });
}

/**
 * Stages the installation **seed**. `config/installation.yaml` is gitignored
 * (issue #26) — it is a venue's own topology, not repo content — so a clean
 * CI checkout has only the sample. Whichever is present is staged under the
 * same name: the bridge copies it into its state directory on first run and
 * never overwrites it afterwards, so this file is a starting point, never the
 * file the venue runs on.
 */
async function copyInstallationYaml() {
  await mkdir(join(RELEASE_DIR, "config"), { recursive: true });
  const venue = join(ROOT, "config/installation.yaml");
  const source = existsSync(venue) ? venue : join(ROOT, "config/installation.sample.yaml");
  await cp(source, join(RELEASE_DIR, "config", "installation.yaml"));
  console.log(`release:build: staged the installation seed from ${relative(ROOT, source)}`);
}

async function writeVersionFile() {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  let gitHash = "unknown";
  try {
    gitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT })
      .toString()
      .trim();
  } catch (error) {
    console.warn(`release:build: could not determine git hash: ${error.message}`);
  }
  await writeFile(join(RELEASE_DIR, "VERSION"), `${pkg.version}+${gitHash}\n`);
}

async function main() {
  await rm(join(ROOT, "dist", "release"), { recursive: true, force: true });
  await mkdir(RELEASE_DIR, { recursive: true });

  await buildWeb();
  await bundleBridge();
  await copyWebDist();
  await copyInstallationYaml();
  await writeVersionFile();

  console.log(`release:build: staged ${RELEASE_DIR}`);
}

main().catch((error) => {
  console.error("release:build: failed:", error);
  process.exit(1);
});
