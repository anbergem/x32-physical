/**
 * Bridge configuration from environment variables. Kept separate from
 * `main.ts` so parsing/validation is unit-testable without spinning up a
 * WebSocket server.
 *
 * | Env                | Meaning                              | Default |
 * | ------------------ | ------------------------------------ | ------- |
 * | `X32_MIXER`        | which `MixerClient` backs the bridge | `mock`  |
 * | `X32_BRIDGE_PORT`  | WebSocket port                       | `8765`  |
 * | `X32_DEMO`         | dev-only scripted mock sequence      | off     |
 */

import type { MixerClient } from "@x32/mixer-contracts";
import { MockMixerClient } from "@x32/mixer-contracts";

/** Which `MixerClient` backs the bridge. `x32` arrives in plan step 10. */
export type MixerMode = "mock" | "x32";

export const DEFAULT_PORT = 8765;

export function resolveMixerMode(env: NodeJS.ProcessEnv): MixerMode {
  const requested = env.X32_MIXER;
  if (requested === undefined || requested === "mock") return "mock";
  if (requested === "x32") return "x32";

  throw new Error(
    `Unrecognised X32_MIXER "${requested}": expected "mock" (the only mode ` +
      `implemented so far — "x32" arrives in plan step 10).`,
  );
}

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.X32_BRIDGE_PORT;
  if (raw === undefined) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `Invalid X32_BRIDGE_PORT "${raw}": expected an integer between 0 and 65535.`,
    );
  }
  return port;
}

/** `X32_DEMO=1` — dev-only scripted mock sequence, off unless set exactly. */
export function resolveDemoMode(env: NodeJS.ProcessEnv): boolean {
  return env.X32_DEMO === "1";
}

/**
 * The bridge's `MixerClient`, chosen by `X32_MIXER`. `MockMixerClient` is the
 * only implementation today; the "x32" case is the one-line addition point
 * for plan step 10's `X32MixerClient` — this mirrors the same seam pattern as
 * `apps/web/src/gateway/createGateway.ts`'s "live" branch.
 */
export function createMixerClient(mode: MixerMode): MixerClient {
  switch (mode) {
    case "mock":
      return new MockMixerClient();
    case "x32":
      // Seam for plan step 10: `X32MixerClient` (apps/x32-bridge/src/x32/,
      // the only module allowed to know OSC) lands here. Failing loudly beats
      // silently serving mock data as if it were the console.
      throw new Error(
        "X32 mode is not implemented yet: the OSC adapter arrives in plan " +
          'step 10. Unset X32_MIXER (or set it to "mock") to run against the mock.',
      );
  }
}
