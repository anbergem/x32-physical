/**
 * The real `UdpTransport` (`node:dgram`), used only when the bridge runs
 * against an actual console (`X32_MIXER=x32`). Deliberately thin: every
 * protocol behaviour — encoding, retries, resolution, reconnect — lives in
 * `x32MixerClient.ts` and its siblings, not here.
 */

import dgram from "node:dgram";

import type { UdpTransport } from "./transport";

export function createDgramTransport(host: string, port: number): UdpTransport {
  const socket = dgram.createSocket("udp4");
  let handler: ((buffer: Uint8Array) => void) | null = null;
  let closed = false;

  socket.on("message", (message) => {
    handler?.(message);
  });
  socket.on("error", (error) => {
    console.error(`x32-bridge: UDP socket error: ${error.message}`);
  });

  return {
    send(buffer) {
      if (closed) return;
      socket.send(buffer, port, host);
    },
    onMessage(callback) {
      handler = callback;
    },
    close() {
      if (closed) return;
      closed = true;
      socket.close();
    },
  };
}
