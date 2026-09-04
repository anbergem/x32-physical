/**
 * Bridge entry point (architecture.md §6/§7). Owns the `MixerClient` and
 * serves the WebSocket API; `src/x32/` (the only module allowed to know OSC)
 * provides `X32MixerClient` for `X32_MIXER=x32`, interchangeable with
 * `MockMixerClient` behind the same interface.
 *
 * Env:
 *   X32_MIXER=mock|x32   which MixerClient backs the bridge (default: mock)
 *   X32_BRIDGE_PORT=n    WebSocket port (default: 8765)
 *   X32_HOST=host        console IP/hostname override — X32_MIXER=x32 only;
 *                        when unset the bridge auto-discovers the console on
 *                        the LAN instead (plan step 18)
 *   X32_PORT=n           console OSC port — x32 mode only (default: 10023)
 *   X32_DEMO=1           dev-only: cycles a scripted mock sequence every ~3s
 *                        so bridge -> browser events can be watched live
 *                        without an X32 connected. Off by default, mock mode
 *                        only.
 *   X32_BASELINE_FILE    disk path for the persisted baseline (architecture.md
 *                        §7); default data/baseline.json, relative to cwd.
 *   X32_WEB_DIST         static root for the built web app (plan step 16);
 *                        unset serves WebSocket only, matching today's dev
 *                        behaviour.
 *   X32_INSTALLATION_FILE override path for installation.yaml, served raw at
 *                        GET /api/installation (issue #3, architecture.md
 *                        §7); unset defaults to installation.yaml in the
 *                        bridge's state directory — the same directory as
 *                        the baseline, %ProgramData%\X32PhysicalRoutingVisualizer\
 *                        under the MSI (issue #26). That file is created
 *                        once from the copy a release ships, and never
 *                        overwritten afterwards, so a venue's own topology
 *                        survives every upgrade.
 *   X32_SETTINGS_FILE    optional path to a venue-editable `KEY=VALUE` file
 *                        (plan step 19's MSI override path — WinSW's own
 *                        config sets this to `%ProgramData%\...\settings.env`
 *                        on the venue machine); read once at startup, and
 *                        only fills in env vars not already set. Missing
 *                        file is silent and normal (most installs never
 *                        need an override); a read/parse error is logged and
 *                        otherwise ignored — it must never block startup.
 */

import { readFileSync } from "node:fs";

import { MockMixerClient } from "@x32/mixer-contracts";

import {
  applySettingsFileOverrides,
  createMixerClient,
  parseSettingsFileContents,
  resolveBaselineFilePath,
  resolveDemoMode,
  resolveInstallationFilePath,
  resolveMixerMode,
  resolvePort,
  resolveWebDistPath,
} from "./config";
import { DiskBaselineStore } from "./baselineStore";
import { startDemoMode } from "./demo";
import { startBridgeServer } from "./server/bridgeServer";

function loadEnv(): NodeJS.ProcessEnv {
  const settingsFile = process.env.X32_SETTINGS_FILE;
  if (settingsFile === undefined || settingsFile.trim() === "") return process.env;

  try {
    const contents = readFileSync(settingsFile, "utf8");
    const overrides = parseSettingsFileContents(contents);
    console.log(`x32-bridge: loaded overrides from ${settingsFile}: ${Object.keys(overrides).join(", ") || "(none)"}`);
    return applySettingsFileOverrides(process.env, overrides);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`x32-bridge: could not read X32_SETTINGS_FILE (${settingsFile}): ${(error as Error).message}`);
    }
    return process.env;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mode = resolveMixerMode(env);
  const port = resolvePort(env);
  const demo = resolveDemoMode(env);
  const baselineStore = new DiskBaselineStore(resolveBaselineFilePath(env));
  const webDist = resolveWebDistPath(env);
  const installationFilePath = resolveInstallationFilePath(env);

  const mixerClient = createMixerClient(mode, env);
  const bridge = await startBridgeServer({
    mixerClient,
    port,
    baselineStore,
    webDist,
    installationFilePath,
  });

  console.log(
    `x32-bridge: listening on ws://localhost:${bridge.port} (mixer: ${mode})`,
  );
  if (webDist !== undefined) {
    console.log(`x32-bridge: serving web app from ${webDist} on http://localhost:${bridge.port}`);
  }

  let stopDemo: (() => void) | null = null;
  if (demo) {
    if (mixerClient instanceof MockMixerClient) {
      stopDemo = startDemoMode(mixerClient);
      console.log(
        "x32-bridge: X32_DEMO=1 (dev only) — cycling a scripted mock sequence every ~3s",
      );
    } else {
      console.warn("x32-bridge: X32_DEMO=1 has no effect outside mock mode");
    }
  }

  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("x32-bridge: shutting down");
    stopDemo?.();
    bridge
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error("x32-bridge: error during shutdown:", error);
        process.exit(1);
      });
  });
}

main().catch((error: unknown) => {
  console.error("x32-bridge: fatal startup error:", error);
  process.exit(1);
});
