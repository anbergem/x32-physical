/**
 * `discoverX32` tests, driven entirely through a fake `DiscoverySocket` — no
 * real socket, no real network. Fake timers exercise the timeout window
 * without any real waiting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { X32Discovered } from "./discovery";
import { createX32Discoverer, discoverX32 } from "./discovery";
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

describe("createX32Discoverer", () => {
  /** Advances fake timers past `timeoutMs` and returns the settled result. */
  async function runAttempt(
    discoverer: ReturnType<typeof createX32Discoverer>,
    timeoutMs = 100,
  ): Promise<X32Discovered[]> {
    const resultPromise = discoverer.discover({ timeoutMs });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    return resultPromise;
  }

  it("repeated attempts reuse one socket (the factory is called only once)", async () => {
    const factory = vi.fn(() => new FakeDiscoverySocket());
    const discoverer = createX32Discoverer({ createSocket: factory });

    await runAttempt(discoverer); // fails (nothing replies) -> 2s backoff
    await vi.advanceTimersByTimeAsync(2_000); // clear the backoff window
    await runAttempt(discoverer); // a second, independent attempt

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("a successful attempt returns the responder and resets backoff", async () => {
    const socket = new FakeDiscoverySocket();
    const discoverer = createX32Discoverer({ createSocket: () => socket });

    const resultPromise = discoverer.discover({ timeoutMs: 100 });
    socket.reply("192.168.1.10", infoReply("V2.05", "osc-server", "X32", "4.06"));
    await vi.advanceTimersByTimeAsync(100);

    expect(await resultPromise).toEqual([
      { host: "192.168.1.10", serverVersion: "V2.05", serverName: "osc-server", model: "X32", firmware: "4.06" },
    ]);
  });

  it("backoff: an attempt inside the window makes no network call at all", async () => {
    const socket = new FakeDiscoverySocket();
    const factory = vi.fn(() => socket);
    const discoverer = createX32Discoverer({ createSocket: factory });

    await runAttempt(discoverer); // first failure -> schedules a 2s backoff
    expect(socket.sent).toHaveLength(1);

    // Called again immediately, well inside the 2s window.
    const skippedResult = await discoverer.discover({ timeoutMs: 100 });
    expect(skippedResult).toEqual([]);
    expect(socket.sent).toHaveLength(1); // nothing broadcast for the skipped call
    expect(factory).toHaveBeenCalledTimes(1); // and no new socket, either
  });

  it("backoff escalates 2s -> 4s -> 8s -> 16s -> 30s and caps there; a success resets it to 2s", async () => {
    const socket = new FakeDiscoverySocket();
    const discoverer = createX32Discoverer({ createSocket: () => socket });
    const schedule = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]; // 6th failure still capped at 30s

    for (const delayMs of schedule) {
      await runAttempt(discoverer); // fails — nothing replies
      // One tick short of the expected delay: still inside the window, no call.
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      const sentBefore = socket.sent.length;
      expect(await discoverer.discover({ timeoutMs: 100 })).toEqual([]);
      expect(socket.sent.length).toBe(sentBefore); // still gated — the last 1ms hadn't elapsed
      await vi.advanceTimersByTimeAsync(1); // now the window has fully elapsed
    }

    // Next attempt succeeds — resets backoff to the base.
    const successPromise = discoverer.discover({ timeoutMs: 100 });
    socket.reply("192.168.1.20", infoReply("V2.05", "osc-server", "X32", "4.06"));
    await vi.advanceTimersByTimeAsync(100);
    expect(await successPromise).toHaveLength(1);

    // A failure right after a success is throttled at 2s again, not 30s.
    const sentBeforeReset = socket.sent.length;
    await runAttempt(discoverer);
    expect(socket.sent.length).toBe(sentBeforeReset + 1);
    expect(await discoverer.discover({ timeoutMs: 100 })).toEqual([]); // inside the fresh 2s window
    expect(socket.sent.length).toBe(sentBeforeReset + 1);
    await vi.advanceTimersByTimeAsync(2_000);
    await runAttempt(discoverer); // the window has now elapsed — this one actually attempts
    expect(socket.sent.length).toBe(sentBeforeReset + 2);
  });

  it("close() closes the socket once opened, and is a harmless no-op if discover() was never called", async () => {
    const socket = new FakeDiscoverySocket();
    const discoverer = createX32Discoverer({ createSocket: () => socket });

    expect(() => discoverer.close()).not.toThrow(); // no socket opened yet
    expect(socket.closed).toBe(false);

    await runAttempt(discoverer);
    discoverer.close();
    expect(socket.closed).toBe(true);

    expect(() => discoverer.close()).not.toThrow(); // idempotent
  });

  it("a socket-creation failure resolves empty, logs the socket-error variant, and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const discoverer = createX32Discoverer({
      createSocket: () => {
        throw new Error("no network interface");
      },
    });

    const result = await discoverer.discover({ timeoutMs: 100 });

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/could not open\/bind the discovery socket.*no network interface/);
    warn.mockRestore();
  });

  it("no-reply failures log once per backoff escalation, not once per attempt", async () => {
    const socket = new FakeDiscoverySocket();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const discoverer = createX32Discoverer({ createSocket: () => socket });

    await runAttempt(discoverer); // 1st failure -> logs (escalates to 2s)
    expect(warn).toHaveBeenCalledTimes(1);

    // A second call still inside the backoff window makes no attempt, so it logs nothing new.
    await discoverer.discover({ timeoutMs: 100 });
    expect(warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await runAttempt(discoverer); // 2nd real attempt -> a new escalation (2s -> 4s) -> logs again
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});
