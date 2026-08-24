/**
 * Bridge configuration from environment variables. Kept separate from
 * `main.ts` so parsing/validation is unit-testable without spinning up a
 * WebSocket server.
 *
 * | Env                | Meaning                              | Default |
 * | ------------------ | ------------------------------------ | ------- |
 * | `X32_MIXER`        | which `MixerClient` backs the bridge | `mock`  |
 * | `X32_BRIDGE_PORT`  | WebSocket port                       | `8765`  |
 * | `X32_HOST`         | console IP/hostname override (`x32` mode only) — wins over discovery when set | unset (auto-discovered, step 18) |
 * | `X32_PORT`         | console OSC port (`x32` mode only)    | `10023` |
 * | `X32_DEMO`         | dev-only scripted mock sequence      | off     |
 * | `X32_BASELINE_FILE`| disk path for the persisted baseline (architecture.md §7) | `data/baseline.json` |
 * | `X32_WEB_DIST`      | static root for the built web app (plan step 16); unset = WS only | unset |
 */

import type { MixerClient } from "@x32/mixer-contracts";
import { MockMixerClient } from "@x32/mixer-contracts";

import { X32_OSC_PORT } from "./x32/addresses";
import { createDgramTransport } from "./x32/dgramTransport";
import type { X32Discovered } from "./x32/discovery";
import { discoverX32 } from "./x32/discovery";
import type { UdpTransport } from "./x32/transport";
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

/** Default location of the bridge's own disk-persisted baseline (architecture.md §7), relative to the bridge process's cwd. */
export const DEFAULT_BASELINE_FILE = "data/baseline.json";

/** Where `DiskBaselineStore` reads/writes the blessed snapshot. */
export function resolveBaselineFilePath(env: NodeJS.ProcessEnv): string {
  const raw = env.X32_BASELINE_FILE;
  return raw !== undefined && raw.trim() !== "" ? raw : DEFAULT_BASELINE_FILE;
}

/**
 * Static root for the built web app (plan step 16, architecture.md §6/§7).
 * Unset means WS-only — today's dev behaviour, and the default when this
 * bridge is run standalone against a separately-served (e.g. Vite dev)
 * front end.
 */
export function resolveWebDistPath(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.X32_WEB_DIST;
  return raw !== undefined && raw.trim() !== "" ? raw : undefined;
}

/**
 * `X32_HOST` is now an *override*, not a requirement (step 18 replaces the
 * old "required" IP config with auto-discovery — see `pickDiscoveredHost`
 * / `createMixerClient`). `undefined` means "not set, use discovery".
 */
export function resolveX32HostOverride(env: NodeJS.ProcessEnv): string | undefined {
  const host = env.X32_HOST;
  return host !== undefined && host.trim() !== "" ? host.trim() : undefined;
}

/**
 * Ascending-IP ordering for picking a deterministic winner among several
 * discovery replies (docs/plan.md step 18). Inputs are always dotted-quad
 * IPv4 addresses (`rinfo.address` from a real UDP reply), so a plain
 * per-octet numeric comparison is enough — no need for a general IP-parsing
 * library.
 */
function compareIpv4Ascending(a: string, b: string): number {
  const octetsOf = (ip: string): number[] => ip.split(".").map(Number);
  const [pa, pb] = [octetsOf(a), octetsOf(b)];
  for (let i = 0; i < 4; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Picks the discovery winner: none found → `undefined`; one or more found →
 * the lowest IP, deterministically (docs/plan.md step 18: "found several:
 * log all, use the first by ascending IP").
 */
export function pickDiscoveredHost(found: X32Discovered[]): X32Discovered | undefined {
  if (found.length === 0) return undefined;
  return [...found].sort((a, b) => compareIpv4Ascending(a.host, b.host))[0];
}

/**
 * Runs discovery and logs its outcome (docs/plan.md step 18's exact wording:
 * found one → "Found X32 at <ip> (<model> fw <firmware>)"; found several →
 * log all, then that same line for the chosen one; found none → the
 * actionable "set X32_HOST=<ip>" message). Never throws — `discoverX32`
 * itself already can't, and this function does no I/O beyond that.
 */
async function discoverAndLog(discover: typeof discoverX32): Promise<X32Discovered | undefined> {
  const found = await discover();
  const chosen = pickDiscoveredHost(found);

  if (chosen === undefined) {
    console.warn(
      "x32-bridge: No X32 found on the network — set X32_HOST=<ip> to point at it directly.",
    );
    return undefined;
  }

  if (found.length > 1) {
    console.log(
      `x32-bridge: found ${found.length} X32 consoles on the network: ` +
        `${found.map((d) => d.host).join(", ")} — using the lowest IP, ${chosen.host}.`,
    );
  }
  console.log(`x32-bridge: Found X32 at ${chosen.host} (${chosen.model} fw ${chosen.firmware})`);
  return chosen;
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
 * A transport that is never actually used for sends: the placeholder that
 * satisfies `X32MixerClient`'s required constructor argument in discovery
 * mode, before the first `resolveTransport` call has run. `#acquireTransport`
 * (x32MixerClient.ts) always resolves and swaps in a real transport before
 * any address read happens, so this is closed and discarded without ever
 * sending a datagram — deliberately not backed by `node:dgram` at all, so no
 * socket is opened until a host is actually known.
 */
function createPendingTransport(): UdpTransport {
  return {
    send() {
      /* never called — replaced by #acquireTransport before any read */
    },
    onMessage() {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };
}

/**
 * The bridge's `MixerClient`, chosen by `X32_MIXER`. `x32` mode wires up
 * `X32MixerClient` (apps/x32-bridge/src/x32/, the only module allowed to
 * know OSC) with the real `node:dgram` transport — this mirrors the same
 * seam pattern as `apps/web/src/gateway/createGateway.ts`'s "live" branch.
 *
 * Host resolution (docs/plan.md step 18): `X32_HOST` wins whenever set — a
 * plain fixed-host `X32MixerClient`, identical to pre-step-18 behaviour, no
 * `resolveTransport`. When it's absent, discovery is wired in as the
 * client's `resolveTransport`, so it runs both for the very first
 * `connect()` (awaited by `bridgeServer.ts` before it starts serving, so
 * "no console yet" still starts the bridge disconnected per architecture.md
 * §7) *and* for every later reconnect attempt while disconnected — exactly
 * the DHCP-lease-change case docs/plan.md step 18 calls out, with no extra
 * plumbing needed here.
 */
export function createMixerClient(
  mode: MixerMode,
  env: NodeJS.ProcessEnv,
  discover: typeof discoverX32 = discoverX32,
): MixerClient {
  switch (mode) {
    case "mock":
      return new MockMixerClient();
    case "x32": {
      const port = resolveX32Port(env);
      const override = resolveX32HostOverride(env);

      if (override !== undefined) {
        return new X32MixerClient(createDgramTransport(override, port));
      }

      return new X32MixerClient(createPendingTransport(), {
        resolveTransport: async () => {
          const host = await discoverAndLog(discover);
          return host === undefined ? null : createDgramTransport(host.host, port);
        },
      });
    }
  }
}
