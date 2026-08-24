#!/usr/bin/env node
/**
 * Stages a self-contained production release under `dist/release/app/`
 * (plan step 16, architecture.md §6/§7):
 *
 *   dist/release/app/
 *     server.mjs        esbuild-bundled apps/x32-bridge/src/main.ts
 *     web/               the web app's Vite build, VITE_DEFAULT_MODE=live
 *     config/installation.yaml   copied for future bridge/ops use — see the
 *                                caveat below
 *     VERSION            package.json version + git short hash
 *
 * Run the staged server with `node dist/release/app/server.mjs`, pointing
 * `X32_WEB_DIST` at `dist/release/app/web` (or leave it — `main.ts` doesn't
 * default it; step 17's launch scripts will).
 *
 * CAVEAT (deliberately not "fixed" here — see the plan-step-16 report): the
 * web app bakes `config/installation.yaml` into its JS bundle at build time
 * via a Vite `?raw` import (`apps/web/src/installation/loadInstallation.ts`).
 * The bridge itself never reads the YAML — it has no topology/route-index
 * concerns (architecture.md §2/§3). Copying the YAML into the release here
 * gives ops a copy alongside the app and a home for the bridge to read it
 * from if a future step needs to, but it is NOT the copy the running web
 * app actually uses. A change to `installation.yaml` on the venue machine
 * requires a rebuilt-and-restaged release, not a local file edit — editing
 * `dist/release/app/config/installation.yaml` in place does nothing.
 */

import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RELEASE_DIR = join(ROOT, "dist", "release", "app");

function run(command, args, options = {}) {
  console.log(`release:build $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
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

async function copyInstallationYaml() {
  await mkdir(join(RELEASE_DIR, "config"), { recursive: true });
  await cp(
    join(ROOT, "config/installation.yaml"),
    join(RELEASE_DIR, "config", "installation.yaml"),
  );
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
