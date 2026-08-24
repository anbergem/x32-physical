/**
 * Bridge entry point (architecture.md §6/§7). Owns the `MixerClient` and
 * serves the WebSocket API; `src/x32/` (the only module allowed to know OSC)
 * provides `X32MixerClient` for `X32_MIXER=x32`, interchangeable with
 * `MockMixerClient` behind the same interface.
 *
 * Env:
 *   X32_MIXER=mock|x32   which MixerClient backs the bridge (default: mock)
 *   X32_BRIDGE_PORT=n    WebSocket port (default: 8765)
 *   X32_HOST=host        console IP/hostname — required when X32_MIXER=x32
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
 */

import { MockMixerClient } from "@x32/mixer-contracts";

import { DiskBaselineStore } from "./baselineStore";
import {
  createMixerClient,
  resolveBaselineFilePath,
  resolveDemoMode,
  resolveMixerMode,
  resolvePort,
  resolveWebDistPath,
} from "./config";
import { startDemoMode } from "./demo";
import { startBridgeServer } from "./server/bridgeServer";

async function main(): Promise<void> {
  const mode = resolveMixerMode(process.env);
  const port = resolvePort(process.env);
  const demo = resolveDemoMode(process.env);
  const baselineStore = new DiskBaselineStore(resolveBaselineFilePath(process.env));
  const webDist = resolveWebDistPath(process.env);

  const mixerClient = createMixerClient(mode, process.env);
  const bridge = await startBridgeServer({ mixerClient, port, baselineStore, webDist });

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
