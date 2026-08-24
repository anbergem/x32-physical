/**
 * `discoverX32` tests, driven entirely through a fake `DiscoverySocket` — no
 * real socket, no real network. Fake timers exercise the timeout window
 * without any real waiting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { X32Discovered } from "./discovery";
import { discoverX32 } from "./discovery";
import { encodeOscMessage } from "./osc";

type MessageHandler = (buffer: Uint8Array, remoteAddress: string) => void;

class FakeDiscoverySocket {
  sent: Uint8Array[] = [];
  closed = false;
  #handler: MessageHandler | null = null;

  sendBroadcast(buffer: Uint8Array): void {
    this.sent.push(buffer);
  }

  onMessage(callback: MessageHandler): void {
    this.#handler = callback;
  }

  close(): void {
    this.closed = true;
  }

  /** Test-only: simulate a UDP reply arriving from `remoteAddress`. */
  reply(remoteAddress: string, buffer: Uint8Array): void {
    this.#handler?.(buffer, remoteAddress);
  }
}

function infoReply(
  serverVersion: string,
  serverName: string,
  model: string,
  firmware: string,
): Uint8Array {
  return encodeOscMessage("/info", [
    { type: "s", value: serverVersion },
    { type: "s", value: serverName },
    { type: "s", value: model },
    { type: "s", value: firmware },
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs discovery against `socket`, advancing fake timers past the timeout, and returns the result. */
async function runDiscovery(
  socket: FakeDiscoverySocket,
  options: { timeoutMs?: number } = {},
): Promise<X32Discovered[]> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const resultPromise = discoverX32({ timeoutMs, createSocket: () => socket });
  await vi.advanceTimersByTimeAsync(timeoutMs);
  return resultPromise;
}

describe("discoverX32", () => {
  it("one responder: returns it", async () => {
    const socket = new FakeDiscoverySocket();
    const resultPromise = runDiscovery(socket);
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32C", "2.08"));
    const result = await resultPromise;

    expect(result).toEqual([
      { host: "192.168.1.10", serverVersion: "V2.05", serverName: "osc-server", model: "X32C", firmware: "2.08" },
    ]);
  });

  it("three responders: all returned", async () => {
    const socket = new FakeDiscoverySocket();
    const resultPromise = runDiscovery(socket);
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32C", "2.08"));
    socket.reply("192.168.1.20", infoReply("V2.05", "osc-server", "X32", "4.06"));
    socket.reply("192.168.1.30", infoReply("V2.05", "osc-server", "X32-Rack", "4.06"));
    const result = await resultPromise;

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.host).sort()).toEqual(["192.168.1.10", "192.168.1.20", "192.168.1.30"]);
  });

  it("zero responders: empty array, no throw, resolves after the timeout", async () => {
    const socket = new FakeDiscoverySocket();
    const result = await runDiscovery(socket);
    expect(result).toEqual([]);
    expect(socket.closed).toBe(true);
  });

  it("malformed/foreign UDP reply mixed in is ignored; the valid one is still returned", async () => {
    const socket = new FakeDiscoverySocket();
    const resultPromise = runDiscovery(socket);

    // Garbage bytes that don't even decode as OSC.
    socket.reply("192.168.1.99", new Uint8Array([1, 2, 3, 4]));
    // Valid OSC, but not an /info reply (foreign traffic on the port).
    socket.reply("192.168.1.98", encodeOscMessage("/xinfo", [{ type: "s", value: "irrelevant" }]));
    // Valid /info reply but missing string args (malformed reply).
    socket.reply("192.168.1.97", encodeOscMessage("/info", [{ type: "i", value: 1 }]));
    // The real one.
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32C", "2.08"));

    const result = await resultPromise;
    expect(result).toEqual([
      { host: "192.168.1.10", serverVersion: "V2.05", serverName: "osc-server", model: "X32C", firmware: "2.08" },
    ]);
  });

  it("dedupes duplicate replies from one host, keeping one entry", async () => {
    const socket = new FakeDiscoverySocket();
    const resultPromise = runDiscovery(socket);
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32C", "2.08"));
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32C", "2.08"));
    const result = await resultPromise;

    expect(result).toHaveLength(1);
    expect(result[0]?.host).toBe("192.168.1.10");
  });

  it("broadcast-permission error (throwing socket) resolves empty, never throws", async () => {
    const socket = new FakeDiscoverySocket();
    socket.sendBroadcast = () => {
      throw new Error("EACCES: broadcast not permitted");
    };
    const result = await discoverX32({ createSocket: () => socket });
    expect(result).toEqual([]);
  });

  it("a throwing createSocket also resolves empty, never throws", async () => {
    const result = await discoverX32({
      createSocket: () => {
        throw new Error("no network interface");
      },
    });
    expect(result).toEqual([]);
  });

  it("honours the configured timeout: a reply arriving after it is dropped, not returned", async () => {
    const socket = new FakeDiscoverySocket();
    const resultPromise = discoverX32({ timeoutMs: 500, createSocket: () => socket });

    await vi.advanceTimersByTimeAsync(500); // timeout fires, resolves []
    const result = await resultPromise;
    expect(result).toEqual([]);

    // A late reply after resolution must not throw or otherwise misbehave.
    expect(() => socket.reply("192.168.1.10", infoReply("V2.05", "s", "m", "f"))).not.toThrow();
  });
});
