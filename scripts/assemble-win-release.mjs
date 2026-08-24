#!/usr/bin/env node
/**
 * Assembles the Windows venue-distribution zip (plan step 17,
 * docs/plan.md). Takes the already-staged `dist/release/app/` (from
 * `pnpm release:build`, step 16), a `node.exe` to bundle, and a version,
 * and produces:
 *
 *   dist/release/x32-visualizer-win64-v<version>.zip
 *     app/            <- copy of the staged dist/release/app/
 *     node/node.exe   <- the provided node.exe
 *     install.ps1     <- deploy/windows/install.ps1
 *     update.ps1      <- deploy/windows/update.ps1
 *     start.cmd       <- deploy/windows/start.cmd
 *     VENUE-README.txt <- deploy/windows/VENUE-README.txt
 *     repo.txt        <- the --repo slug, read by install.ps1 to seed
 *                        GITHUB_REPO in settings.env
 *
 * Zipping uses the `zip` CLI via child_process (present on both the
 * ubuntu-latest GitHub Actions runner and macOS, so this is runnable both
 * in CI and locally for testing) — no archiving npm dependency, keeping to
 * the agreed stack (architecture.md, CLAUDE.md).
 *
 * Usage:
 *   node scripts/assemble-win-release.mjs \
 *     --app dist/release/app --node /path/to/node.exe \
 *     --version 1.2.3 --repo owner/repo [--out dist/release]
 *
 *   node scripts/assemble-win-release.mjs --self-test
 *     Builds a throwaway fake app/ and node.exe placeholder, assembles a
 *     zip from them into a temp dir, and verifies its contents with
 *     `unzip -l`. Exits non-zero on any mismatch. Safe to run on macOS —
 *     this script never executes the .ps1/.cmd files, only packages them.
 */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, cp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEPLOY_DIR = join(ROOT, "deploy", "windows");
const DEPLOY_FILES = ["install.ps1", "update.ps1", "start.cmd", "VENUE-README.txt"];

function parseArgs(argv) {
  const args = { out: join(ROOT, "dist", "release") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

/**
 * Builds the zip's staging tree under `stagingDir`, then zips it to
 * `zipPath`. `stagingDir`'s contents become the zip's root — i.e. app/,
 * node/, install.ps1 etc. sit directly at the zip's top level.
 */
async function assemble({ appDir, nodeExePath, version, repo, zipPath }) {
  if (!(await pathExists(appDir))) {
    throw new Error(`--app path does not exist: ${appDir} (run \`pnpm release:build\` first)`);
  }
  if (!(await pathExists(nodeExePath))) {
    throw new Error(`--node path does not exist: ${nodeExePath}`);
  }
  for (const file of DEPLOY_FILES) {
    const src = join(DEPLOY_DIR, file);
    if (!(await pathExists(src))) {
      throw new Error(`missing deploy script: ${src}`);
    }
  }

  const stagingDir = await mkdtemp(join(tmpdir(), "x32-win-release-"));
  try {
    await cp(appDir, join(stagingDir, "app"), { recursive: true });

    await mkdir(join(stagingDir, "node"), { recursive: true });
    await cp(nodeExePath, join(stagingDir, "node", "node.exe"));

    for (const file of DEPLOY_FILES) {
      await cp(join(DEPLOY_DIR, file), join(stagingDir, file));
    }

    await writeFile(join(stagingDir, "repo.txt"), `${repo ?? ""}\n`);

    await mkdir(dirname(zipPath), { recursive: true });
    await rm(zipPath, { force: true });

    // `zip -r` writes paths relative to cwd, so run it from inside the
    // staging dir with "." as the source — that's what puts app/, node/
    // etc. at the zip's root instead of nested under a temp-dir path.
    run("zip", ["-r", "-X", zipPath, "."], { cwd: stagingDir });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function listZipEntries(zipPath) {
  const result = spawnSync("unzip", ["-l", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`unzip -l failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\s/.test(line))
    .map((line) => line.split(/\s+/).slice(3).join(" "));
}

async function selfTest() {
  console.log("assemble-win-release: running self-test");
  const workDir = await mkdtemp(join(tmpdir(), "x32-win-release-selftest-"));
  try {
    const fakeApp = join(workDir, "app");
    await mkdir(join(fakeApp, "web", "assets"), { recursive: true });
    await mkdir(join(fakeApp, "config"), { recursive: true });
    await writeFile(join(fakeApp, "server.mjs"), "// fake bundled server\n");
    await writeFile(join(fakeApp, "VERSION"), "9.9.9+deadbee\n");
    await writeFile(join(fakeApp, "web", "index.html"), "<!doctype html><title>fake</title>");
    await writeFile(join(fakeApp, "web", "assets", "app.js"), "// fake asset\n");
    await writeFile(join(fakeApp, "config", "installation.yaml"), "panels: []\n");

    const fakeNodeExe = join(workDir, "fake-node.exe");
    await writeFile(fakeNodeExe, "not a real binary, just for zip-layout testing\n");

    const zipPath = join(workDir, "x32-visualizer-win64-v9.9.9.zip");
    await assemble({
      appDir: fakeApp,
      nodeExePath: fakeNodeExe,
      version: "9.9.9",
      repo: "example-org/x32-physical",
      zipPath,
    });

    if (!(await pathExists(zipPath))) {
      throw new Error("self-test: zip was not created");
    }

    const entries = await listZipEntries(zipPath);
    const required = [
      "app/server.mjs",
      "app/VERSION",
      "app/web/index.html",
      "app/config/installation.yaml",
      "node/node.exe",
      "install.ps1",
      "update.ps1",
      "start.cmd",
      "VENUE-README.txt",
      "repo.txt",
    ];
    const missing = required.filter((path) => !entries.includes(path));
    if (missing.length > 0) {
      console.error("self-test: zip listing:\n" + entries.join("\n"));
      throw new Error(`self-test: zip is missing expected entries: ${missing.join(", ")}`);
    }

    console.log(`assemble-win-release: self-test OK (${entries.length} entries, e.g.):`);
    for (const entry of required) {
      console.log(`  ${entry}`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args["self-test"] === undefined && args.selfTest === undefined) {
    // fallthrough to normal mode below
  }

  if (args.selfTest) {
    await selfTest();
    return;
  }

  const appDir = args.app ?? join(ROOT, "dist", "release", "app");
  const nodeExePath = args.node;
  const version = args.version;
  const repo = args.repo;
  const outDir = args.out;

  if (!nodeExePath) throw new Error("--node <path to node.exe> is required");
  if (!version) throw new Error("--version <version> is required");
  if (!repo) throw new Error("--repo <owner/repo> is required");

  const zipPath = join(outDir, `x32-visualizer-win64-v${version}.zip`);
  await assemble({ appDir, nodeExePath, version, repo, zipPath });
  console.log(`assemble-win-release: wrote ${zipPath}`);
}

main().catch((error) => {
  console.error("assemble-win-release: failed:", error);
  process.exit(1);
});
