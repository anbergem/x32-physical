/**
 * Bridge <-> WebSocket integration (architecture.md §7). A real `ws` client
 * against a bridge server bound to an ephemeral port (`port: 0`) — the only
 * layer worth an end-to-end test; the pure cache/mapping logic is exercised
 * implicitly through it.
 */

import { mixerChannelId } from "@x32/domain";
import { MockMixerClient } from "@x32/mixer-contracts";
import type { ServerMessage } from "@x32/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { BridgeServer } from "./bridgeServer";
import { startBridgeServer } from "./bridgeServer";

const CH12 = mixerChannelId(12);

interface TestClient {
  socket: WebSocket;
  /** Resolves with the next message, queuing any that arrive before it is called. */
  next(): Promise<ServerMessage>;
}

let bridge: BridgeServer | null = null;
let clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients) client.socket.terminate();
  clients = [];

  if (bridge !== null) {
    await bridge.close();
    bridge = null;
  }
});

/**
 * The message listener is attached synchronously, before anything is
 * `await`ed — the bridge sends the initial snapshot the instant it sees the
 * connection, which can otherwise arrive and fire "message" before a
 * listener registered after `await`ing "open" gets the chance to hear it.
 */
function connectClient(port: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://localhost:${port}`);
  const pending: ServerMessage[] = [];
  const waiters: Array<(message: ServerMessage) => void> = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else pending.push(message);
  });

  const client: TestClient = {
    socket,
    next: () =>
      new Promise((resolve) => {
        const queued = pending.shift();
        if (queued !== undefined) resolve(queued);
        else waiters.push(resolve);
      }),
  };
  clients.push(client);

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(client));
    socket.once("error", reject);
  });
}

function asSnapshot(message: ServerMessage) {
  if (message.type !== "snapshot") throw new Error(`expected a snapshot, got ${message.type}`);
  return message;
}

describe("startBridgeServer", () => {
  it("sends a snapshot immediately on connect", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.snapshot.channels).toHaveLength(32);
    expect(message.snapshot.selectedChannel).toBeNull();
    expect(message.mixerConnection).toBe("connected");
  });

  it("forwards a simulated mixer event to every connected client", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot

    const eventPromise = client.next();
    mock.simulateSelect(CH12);

    await expect(eventPromise).resolves.toEqual({
      type: "event",
      event: { type: "selected-channel-changed", channel: 12 },
    });
  });

  it("fans an event out to multiple clients", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    const a = await connectClient(bridge.port);
    const b = await connectClient(bridge.port);
    await a.next();
    await b.next();

    const [aEvent, bEvent] = await Promise.all([
      a.next(),
      b.next(),
      Promise.resolve().then(() => mock.simulateRename(CH12, "Lead Vox")),
    ]);

    expect(aEvent).toEqual({
      type: "event",
      event: { type: "channel-name-changed", channel: 12, name: "Lead Vox" },
    });
    expect(bEvent).toEqual(aEvent);
  });

  it("re-sends a fresh snapshot on an explicit client resync", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot
    mock.simulateSelect(CH12);
    await client.next(); // the selection event

    const resyncPromise = client.next();
    client.socket.send(JSON.stringify({ type: "resync" }));
    const resynced = asSnapshot(await resyncPromise);

    expect(resynced.snapshot.selectedChannel).toBe(12);
    expect(resynced.mixerConnection).toBe("connected");
  });

  it("reports the mixer as disconnected to a client that connects while it is down", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });
    mock.simulateConnectionLoss();

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.mixerConnection).toBe("disconnected");
  });

  it("pushes a fresh snapshot (not a plain event) when the mixer reconnects", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot

    mock.simulateConnectionLoss();
    await client.next(); // connection-state-changed -> disconnected

    const resyncPromise = client.next();
    mock.simulateReconnect();
    const message = asSnapshot(await resyncPromise);

    expect(message.mixerConnection).toBe("connected");
    expect(message.snapshot.channels).toHaveLength(32);
  });

  it("shuts down cleanly even with a client still connected", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0 });

    await connectClient(bridge.port); // deliberately left open

    await expect(bridge.close()).resolves.toBeUndefined();
    bridge = null; // already closed — afterEach must not close it again
  });
});
