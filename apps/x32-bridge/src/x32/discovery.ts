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
      let decoded;
      try {
        decoded = decodeOscMessage(buffer);
      } catch {
        return; // malformed/foreign UDP traffic on this port — ignore
      }
      if (decoded.address !== "/info") return; // not a discovery reply — ignore

      const strings = decoded.args
        .filter((arg): arg is Extract<(typeof decoded.args)[number], { type: "s" }> => arg.type === "s")
        .map((arg) => arg.value);
      if (strings.length < 4) return; // malformed reply — ignore

      const [serverVersion, serverName, model, firmware] = strings as [string, string, string, string];
      // Dedupe by source IP: a console can answer more than once (retries,
      // multiple interfaces) and only the latest/most-recent reply is kept.
      found.set(remoteAddress, { host: remoteAddress, serverVersion, serverName, model, firmware });
    });

    try {
      socket.sendBroadcast(encodeOscMessage("/info", []));
    } catch {
      finish();
    }
  });
}
