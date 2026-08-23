/**
 * The seam that makes `X32MixerClient` testable without a real socket:
 * everything it needs from UDP is "send a datagram", "hear datagrams", and
 * "shut down". `dgramTransport.ts` is the one real implementation (thin, on
 * top of `node:dgram`); tests supply a fake instead.
 */
export interface UdpTransport {
  send(buffer: Uint8Array): void;
  /** Registers the single handler for incoming datagrams (last write wins). */
  onMessage(callback: (buffer: Uint8Array) => void): void;
  close(): void;
}
