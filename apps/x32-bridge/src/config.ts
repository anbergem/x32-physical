/**
 * Bridge configuration from environment variables. Kept separate from
 * `main.ts` so parsing/validation is unit-testable without spinning up a
 * WebSocket server.
 *
 * | Env                | Meaning                              | Default |
 * | ------------------ | ------------------------------------ | ------- |
 * | `X32_MIXER`        | which `MixerClient` backs the bridge | `mock`  |
 * | `X32_BRIDGE_PORT`  | WebSocket port                       | `8765`  |
 * | `X32_HOST`         | console IP/hostname (`x32` mode only) | required |
 * | `X32_PORT`         | console OSC port (`x32` mode only)    | `10023` |
 * | `X32_DEMO`         | dev-only scripted mock sequence      | off     |
 */

import type { MixerClient } from "@x32/mixer-contracts";
import { MockMixerClient } from "@x32/mixer-contracts";

import { X32_OSC_PORT } from "./x32/addresses";
import { createDgramTransport } from "./x32/dgramTransport";
import { X32MixerClient } from "./x32/x32MixerClient";

/** Which `MixerClient` backs the bridge. */
export type MixerMode = "mock" | "x32";

export const DEFAULT_PORT = 8765;

/** The X32's OSC port is protocol knowledge — defined in `./x32/addresses.ts`, re-exported here as the env default. */
export const DEFAULT_X32_PORT = X32_OSC_PORT;

export function resolveMixerMode(env: NodeJS.ProcessEnv): MixerMode {
  const requested = env.X32_MIXER;
  if (requested === undefined || requested === "mock") return "mock";
  if (requested === "x32") return "x32";

  throw new Error(
    `Unrecognised X32_MIXER "${requested}": expected "mock" or "x32".`,
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

/** Required in `x32` mode: the console has no discovery protocol we implement. */
export function resolveX32Host(env: NodeJS.ProcessEnv): string {
  const host = env.X32_HOST;
  if (host === undefined || host.trim() === "") {
    throw new Error(
      'X32_HOST is required when X32_MIXER=x32: set it to the console\'s ' +
        "IP address or hostname (e.g. X32_HOST=192.168.1.10).",
    );
  }
  return host;
}

export function resolveX32Port(env: NodeJS.ProcessEnv): number {
  const raw = env.X32_PORT;
  if (raw === undefined) return DEFAULT_X32_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `Invalid X32_PORT "${raw}": expected an integer between 0 and 65535.`,
    );
  }
  return port;
}

/**
 * The bridge's `MixerClient`, chosen by `X32_MIXER`. `x32` mode wires up
 * `X32MixerClient` (apps/x32-bridge/src/x32/, the only module allowed to
 * know OSC) with the real `node:dgram` transport — this mirrors the same
 * seam pattern as `apps/web/src/gateway/createGateway.ts`'s "live" branch.
 */
export function createMixerClient(mode: MixerMode, env: NodeJS.ProcessEnv): MixerClient {
  switch (mode) {
    case "mock":
      return new MockMixerClient();
    case "x32": {
      const host = resolveX32Host(env);
      const port = resolveX32Port(env);
      return new X32MixerClient(createDgramTransport(host, port));
    }
  }
}
