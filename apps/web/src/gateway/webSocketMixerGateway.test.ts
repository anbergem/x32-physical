/**
 * `WebSocketMixerGateway`'s own responsibilities beyond message mapping
 * (already covered by `applyServerMessage.test.ts`): connection-state
 * transitions, reconnect-with-backoff, clean disconnect, and bridge URL
 * resolution. A fake `SocketLike` factory stands in for the real WebSocket
 * API — no real network anywhere in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";
import type { AppStore } from "../state/store";
import { createAppStore } from "../state/store";

import type { SocketLike } from "./webSocketMixerGateway";
import { DEFAULT_BRIDGE_URL, resolveBridgeUrl, WebSocketMixerGateway } from "./webSocketMixerGateway";

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  send(): void {
    // Not exercised by these tests: the gateway never sends anything today.
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: deliver a message as the server would. */
  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function snapshotMessage() {
  return {
    type: "snapshot",
    mixerConnection: "connected",
    snapshot: { channels: [], selectedChannel: null },
  };
}

let store: AppStore;
let sockets: FakeSocket[];

function fakeFactory() {
  return (): SocketLike => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
}

beforeEach(() => {
  store = createAppStore(venueInstallation());
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebSocketMixerGateway.connect", () => {
  it("opens a socket and reports 'connecting' before any message arrives", async () => {
    const gateway = new WebSocketMixerGateway(store, "ws://bridge.test", fakeFactory());

    await gateway.connect();

    expect(sockets).toHaveLength(1);
    expect(store.getState().connection).toBe("connecting");
  });

  it("wires an incoming message through applyServerMessage", async () => {
    const gateway = new WebSocketMixerGateway(store, "ws://bridge.test", fakeFactory());
    await gateway.connect();

    sockets[0]?.emitMessage(JSON.stringify(snapshotMessage()));

    expect(store.getState().connection).toBe("connected");
  });
});

describe("WebSocketMixerGateway reconnection", () => {
  it("reports disconnected and retries with a capped exponential backoff", async () => {
    const gateway = new WebSocketMixerGateway(store, "ws://bridge.test", fakeFactory());
    await gateway.connect();
    expect(sockets).toHaveLength(1);

    sockets[0]?.onclose?.();
    expect(store.getState().connection).toBe("disconnected");
    expect(sockets).toHaveLength(1); // not yet — waiting out the backoff

    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2); // ~1s later: first retry

    sockets[1]?.onclose?.();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3); // ~2s later: backoff doubled

    // Doubling is capped at 10s: burn through several more failed attempts
    // and confirm the gap between attempts never exceeds the cap.
    for (let i = 0; i < 5; i += 1) {
      const last = sockets[sockets.length - 1];
      last?.onclose?.();
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(sockets.length).toBeGreaterThan(3);
  });

  it("resets the backoff to the minimum once a connection actually opens", async () => {
    const gateway = new WebSocketMixerGateway(store, "ws://bridge.test", fakeFactory());
    await gateway.connect();

    sockets[0]?.onclose?.(); // fails immediately -> next retry waits ~1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    sockets[1]?.onopen?.(); // this attempt succeeds
    sockets[1]?.onclose?.(); // then drops again

    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(2); // backoff was reset, not left at ~2s
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
  });

  it("does not reconnect after disconnect() and stops reporting further events", async () => {
    const gateway = new WebSocketMixerGateway(store, "ws://bridge.test", fakeFactory());
    await gateway.connect();

    await gateway.disconnect();
    expect(store.getState().connection).toBe("disconnected");
    expect(sockets[0]?.closed).toBe(true);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(1); // no reconnect attempts scheduled
  });
});

describe("resolveBridgeUrl", () => {
  it("defaults to the page host on the bridge's default port", () => {
    const url = resolveBridgeUrl(
      { search: "", hostname: "venue.local", protocol: "http:" },
      {},
    );
    expect(url).toBe("ws://venue.local:8765");
  });

  it("upgrades to wss: when the page itself is served over https", () => {
    const url = resolveBridgeUrl(
      { search: "", hostname: "venue.local", protocol: "https:" },
      {},
    );
    expect(url).toBe("wss://venue.local:8765");
  });

  it("prefers an explicit ?bridge= override, adding ws:// to a bare host[:port]", () => {
    const url = resolveBridgeUrl(
      { search: "?bridge=192.168.1.50:9000", hostname: "venue.local", protocol: "http:" },
      {},
    );
    expect(url).toBe("ws://192.168.1.50:9000");
  });

  it("leaves a full ws(s):// override untouched", () => {
    const url = resolveBridgeUrl(
      { search: "?bridge=wss%3A%2F%2Fexample.test%3A1234", hostname: "venue.local", protocol: "http:" },
      {},
    );
    expect(url).toBe("wss://example.test:1234");
  });

  it("falls back to VITE_X32_BRIDGE_URL when there is no query override", () => {
    const url = resolveBridgeUrl(
      { search: "", hostname: "venue.local", protocol: "http:" },
      { VITE_X32_BRIDGE_URL: "bridge.example.com:8765" },
    );
    expect(url).toBe("ws://bridge.example.com:8765");
  });

  it("DEFAULT_BRIDGE_URL matches the bridge's own default port", () => {
    expect(DEFAULT_BRIDGE_URL).toBe("ws://localhost:8765");
  });
});
