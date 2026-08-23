/**
 * Bridge entry point (architecture.md §6/§7). Owns the `MixerClient` and
 * serves the WebSocket API; the X32 adapter (`src/x32/`, the only module
 * allowed to know OSC) arrives in plan step 10 — until then `MockMixerClient`
 * behind the same interface is what the bridge hosts.
 *
 * Env:
 *   X32_MIXER=mock|x32   which MixerClient backs the bridge (default: mock;
 *                        "x32" is not implemented yet — see ./config.ts)
 *   X32_BRIDGE_PORT=n    WebSocket port (default: 8765)
 *   X32_DEMO=1           dev-only: cycles a scripted mock sequence every ~3s
 *                        so bridge -> browser events can be watched live
 *                        without an X32 connected. Off by default, mock mode
 *                        only.
 */

import { MockMixerClient } from "@x32/mixer-contracts";

import {
  createMixerClient,
  resolveDemoMode,
  resolveMixerMode,
  resolvePort,
} from "./config";
import { startDemoMode } from "./demo";
import { startBridgeServer } from "./server/bridgeServer";

async function main(): Promise<void> {
  const mode = resolveMixerMode(process.env);
  const port = resolvePort(process.env);
  const demo = resolveDemoMode(process.env);

  const mixerClient = createMixerClient(mode);
  const bridge = await startBridgeServer({ mixerClient, port });

  console.log(
    `x32-bridge: listening on ws://localhost:${bridge.port} (mixer: ${mode})`,
  );

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
