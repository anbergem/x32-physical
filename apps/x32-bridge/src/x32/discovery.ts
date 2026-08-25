/**
 * X32 auto-discovery (docs/plan.md step 18, docs/x32-protocol.md §Discovery).
 *
 * Mirrors what X32-Edit does on a LAN: broadcast `/info` (no args) to
 * 255.255.255.255:10023 from a socket with `SO_BROADCAST` set, and collect
 * whichever consoles reply within a short window. Each reply's *source IP*
 * (not anything in its payload) is the console's address.
 *
 * `UdpTransport` (`./transport.ts`) doesn't fit here: it's a unicast seam —
 * `send` targets one fixed remote and `onMessage` never exposes the sender's
 * address, but discovery needs both broadcast send and per-datagram sender
 * IP. So this module defines its own narrow `DiscoverySocket` seam instead,
 * confined to this file — `node:dgram` still never leaks outside `src/x32/`.
 *
 * Two entry points:
 *
 * - `discoverX32` — one-shot: opens a socket, collects replies for
 *   `timeoutMs`, closes it. Fine for a single lookup, but calling it
 *   repeatedly (the reconnect path) opens a fresh ephemeral UDP port —
 *   i.e. a new client identity to the console — every time.
 * - `createX32Discoverer` — the reusing variant `config.ts` wires into the
 *   reconnect path (docs/x32-protocol.md §Discovery): one socket lives for
 *   the discoverer's whole lifetime, so repeated discovery presents the
 *   console with **one** identity, not one per attempt. It also owns an
 *   escalating backoff (2s/4s/8s/16s/30s, capped) so a genuine outage
 *   doesn't hammer the network at the caller's 5s poll cadence — an
 *   in-window call touches nothing and returns `[]` immediately.
 */

import dgram from "node:dgram";

import { X32_OSC_PORT } from "./addresses";
import { decodeOscMessage, encodeOscMessage } from "./osc";

export interface X32Discovered {
  host: string;
  serverVersion: string;
  serverName: string;
  model: string;
  firmware: string;
}

/** The seam `discoverX32` needs: broadcast one datagram, hear replies with their sender IP, shut down. */
export interface DiscoverySocket {
  sendBroadcast(buffer: Uint8Array): void;
  onMessage(callback: (buffer: Uint8Array, remoteAddress: string) => void): void;
  close(): void;
}

export interface DiscoverX32Options {
  /** How long to wait for replies. Default 1500ms. */
  timeoutMs?: number;
  /** The console's OSC port. Default 10023 (`X32_OSC_PORT`). */
  port?: number;
  /** Default 255.255.255.255 — the limited broadcast address. */
  broadcastAddress?: string;
  /** Injectable seam for tests; defaults to a real `node:dgram` broadcast socket. */
  createSocket?: () => DiscoverySocket;
}

/**
 * The real `DiscoverySocket`: an unconnected UDP4 socket bound to an
 * ephemeral local port with `SO_BROADCAST` enabled, used only for the
 * lifetime of one `discoverX32` call.
 */
function createRealDiscoverySocket(port: number, broadcastAddress: string): DiscoverySocket {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let handler: ((buffer: Uint8Array, remoteAddress: string) => void) | null = null;

  // A discovery failure (permission denied enabling broadcast, no interface,
  // etc.) must never crash the bridge — swallow socket-level errors here;
  // `discoverX32`'s timeout still resolves with whatever (possibly nothing)
  // was collected.
  socket.on("error", () => {
    /* intentionally ignored — see comment above */
  });
  socket.on("message", (message, rinfo) => {
    handler?.(message, rinfo.address);
  });

  return {
    sendBroadcast(buffer) {
      // `send()` before the socket is bound triggers an implicit bind; once
      // bound (or on that implicit bind's callback) `setBroadcast` can be
      // called. Node queues `send` calls made before binding completes, so
      // issuing setBroadcast via the 'listening' event and then sending is
      // the reliable order.
      socket.once("listening", () => {
        try {
          socket.setBroadcast(true);
          socket.send(buffer, port, broadcastAddress);
        } catch {
          /* permission or interface error — ignored, see class-level comment */
        }
      });
      try {
        socket.bind(0);
      } catch {
        /* ignored */
      }
    },
    onMessage(callback) {
      handler = callback;
    },
    close() {
      try {
        socket.close();
      } catch {
        /* already closed, or never successfully bound */
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decodes one candidate `/info` reply buffer, or returns `undefined` for anything not a well-formed reply. */
function parseInfoReply(buffer: Uint8Array): Omit<X32Discovered, "host"> | undefined {
  let decoded;
  try {
    decoded = decodeOscMessage(buffer);
  } catch {
    return undefined; // malformed/foreign UDP traffic on this port — ignore
  }
  if (decoded.address !== "/info") return undefined; // not a discovery reply — ignore

  const strings = decoded.args
    .filter((arg): arg is Extract<(typeof decoded.args)[number], { type: "s" }> => arg.type === "s")
    .map((arg) => arg.value);
  if (strings.length < 4) return undefined; // malformed reply — ignore

  const [serverVersion, serverName, model, firmware] = strings as [string, string, string, string];
  return { serverVersion, serverName, model, firmware };
}

/**
 * Broadcasts `/info` and collects replies for `timeoutMs`. Never throws —
 * any socket/permission failure resolves an empty array, letting the caller
 * (`config.ts`) fall back to "no console found" rather than crashing the
 * bridge on a machine that forbids broadcast.
 */
export function discoverX32(options: DiscoverX32Options = {}): Promise<X32Discovered[]> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const port = options.port ?? X32_OSC_PORT;
  const broadcastAddress = options.broadcastAddress ?? "255.255.255.255";
  const createSocket = options.createSocket ?? (() => createRealDiscoverySocket(port, broadcastAddress));

  return new Promise((resolve) => {
    const found = new Map<string, X32Discovered>();

    let socket: DiscoverySocket;
    try {
      socket = createSocket();
    } catch {
      resolve([]);
      return;
    }

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve([...found.values()]);
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.onMessage((buffer, remoteAddress) => {
      const reply = parseInfoReply(buffer);
      if (reply === undefined) return;
      // Dedupe by source IP: a console can answer more than once (retries,
      // multiple interfaces) and only the latest/most-recent reply is kept.
      found.set(remoteAddress, { host: remoteAddress, ...reply });
    });

    try {
      socket.sendBroadcast(encodeOscMessage("/info", []));
    } catch {
      finish();
    }
  });
}

/** One escalating attempt at a time; caps at 30s. Reset to the front on any successful attempt. */
const DISCOVERY_BACKOFF_SCHEDULE_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export interface X32Discoverer {
  /**
   * Runs one discovery attempt, reusing this discoverer's single socket
   * across every call. Inside the current backoff window this touches the
   * network not at all and resolves `[]` immediately — safe to call on
   * every poll tick. Never throws.
   */
  discover(options?: { timeoutMs?: number }): Promise<X32Discovered[]>;
  /**
   * Closes the underlying socket, if one was ever opened. Idempotent, and
   * safe even if `discover()` was never called. Must be called once the
   * owner is done (`X32MixerClient.disconnect()`) — no socket may outlive
   * the client.
   */
  close(): void;
}

export interface CreateX32DiscovererOptions {
  /** The console's OSC port. Default 10023 (`X32_OSC_PORT`). */
  port?: number;
  /** Default 255.255.255.255 — the limited broadcast address. */
  broadcastAddress?: string;
  /** Injectable seam for tests; defaults to a real `node:dgram` broadcast socket. */
  createSocket?: () => DiscoverySocket;
}

/**
 * The reusing, backing-off discovery seam (docs/x32-protocol.md §Discovery)
 * that the reconnect path goes through: `config.ts` constructs one of these
 * per `X32MixerClient` in discovery mode and calls `discover()` from
 * `resolveTransport` on every (re)connect attempt. Unlike `discoverX32`,
 * repeated attempts reuse one socket — so a bridge that can't reach the
 * console for an hour still presents the desk exactly one client identity,
 * not one per attempt — and a failed attempt escalates an internal backoff
 * rather than retrying at the caller's fixed poll cadence.
 */
export function createX32Discoverer(options: CreateX32DiscovererOptions = {}): X32Discoverer {
  const port = options.port ?? X32_OSC_PORT;
  const broadcastAddress = options.broadcastAddress ?? "255.255.255.255";
  const createSocket = options.createSocket ?? (() => createRealDiscoverySocket(port, broadcastAddress));

  let socket: DiscoverySocket | null = null;
  let backoffIndex = -1; // -1 = never failed yet; an actual attempt is always due.
  let nextAttemptAt = 0; // Date.now()-comparable; 0 means "due now".
  let lastLoggedBackoffIndex = -2; // sentinel distinct from -1 so the first failure always logs.

  function currentDelayMs(): number {
    const index = Math.min(Math.max(backoffIndex, 0), DISCOVERY_BACKOFF_SCHEDULE_MS.length - 1);
    return DISCOVERY_BACKOFF_SCHEDULE_MS[index]!;
  }

  /**
   * Escalates the backoff and logs `coreMessage`, but only once per
   * escalation step — the bug this fixes logged an identical line once per
   * 5s poll tick (26 times in one session); an attempt made once the window
   * has already elapsed and still fails is a new escalation step and does
   * get logged again.
   */
  function recordFailure(coreMessage: string): void {
    backoffIndex = Math.min(backoffIndex + 1, DISCOVERY_BACKOFF_SCHEDULE_MS.length - 1);
    nextAttemptAt = Date.now() + currentDelayMs();
    if (backoffIndex === lastLoggedBackoffIndex) return;
    lastLoggedBackoffIndex = backoffIndex;
    console.warn(`${coreMessage} (retrying, backing off to ${currentDelayMs() / 1000}s between attempts).`);
  }

  function recordSuccess(): void {
    backoffIndex = -1;
    nextAttemptAt = 0;
    lastLoggedBackoffIndex = -2;
  }

  async function discover(discoverOptions: { timeoutMs?: number } = {}): Promise<X32Discovered[]> {
    const timeoutMs = discoverOptions.timeoutMs ?? 1500;

    if (Date.now() < nextAttemptAt) {
      return []; // inside the backoff window — no network call.
    }

    if (socket === null) {
      try {
        socket = createSocket();
      } catch (error) {
        recordFailure(`x32-bridge: could not open/bind the discovery socket: ${errorMessage(error)}`);
        return [];
      }
    }
    const activeSocket = socket;

    const found = new Map<string, X32Discovered>();
    let broadcastFailed = false;

    const result = await new Promise<X32Discovered[]>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve([...found.values()]);
      };
      const timer = setTimeout(finish, timeoutMs);

      activeSocket.onMessage((buffer, remoteAddress) => {
        const reply = parseInfoReply(buffer);
        if (reply === undefined) return;
        found.set(remoteAddress, { host: remoteAddress, ...reply });
      });

      try {
        activeSocket.sendBroadcast(encodeOscMessage("/info", []));
      } catch (error) {
        broadcastFailed = true;
        recordFailure(`x32-bridge: broadcast not permitted: ${errorMessage(error)}`);
        finish();
      }
    });

    if (result.length > 0) {
      recordSuccess();
    } else if (!broadcastFailed) {
      recordFailure(
        `x32-bridge: no X32 console replied to discovery within ${timeoutMs}ms — ` +
          "set X32_HOST=<ip> to point at it directly if you know the console's address",
      );
    }
    return result;
  }

  function close(): void {
    if (socket === null) return;
    try {
      socket.close();
    } catch {
      /* already closed, or never successfully bound */
    }
    socket = null;
  }

  return { discover, close };
}
