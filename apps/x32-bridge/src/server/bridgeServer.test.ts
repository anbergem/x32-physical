/**
 * Bridge <-> WebSocket integration (architecture.md §7). A real `ws` client
 * against a bridge server bound to an ephemeral port (`port: 0`) — the only
 * layer worth an end-to-end test; the pure cache/mapping logic is exercised
 * implicitly through it.
 */

import { mixerChannelId } from "@x32/domain";
import { MockMixerClient } from "@x32/mixer-contracts";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import type { ServerMessage } from "@x32/protocol";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { BaselineStore } from "../baselineStore";
import { DiskBaselineStore } from "../baselineStore";

import type { BridgeServer } from "./bridgeServer";
import { startBridgeServer } from "./bridgeServer";

const CH12 = mixerChannelId(12);

/** A `BaselineStore` for tests that don't care about persistence at all. */
function inMemoryBaselineStore(initial: MixerSnapshot | null = null): BaselineStore {
  let stored = initial;
  return {
    async load() {
      return stored;
    },
    async save(snapshot) {
      stored = snapshot;
    },
  };
}

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
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.snapshot.channels).toHaveLength(32);
    expect(message.snapshot.selectedChannel).toBeNull();
    expect(message.mixerConnection).toBe("connected");
  });

  it("forwards a simulated mixer event to every connected client", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

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
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

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
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

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
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });
    mock.simulateConnectionLoss();

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.mixerConnection).toBe("disconnected");
  });

  it("pushes a fresh snapshot (not a plain event) when the mixer reconnects", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

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
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

    await connectClient(bridge.port); // deliberately left open

    await expect(bridge.close()).resolves.toBeUndefined();
    bridge = null; // already closed — afterEach must not close it again
  });
});

describe("baseline persistence (architecture.md §7)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x32-bridge-baseline-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function baselineFilePath(): string {
    return join(dir, "baseline.json");
  }

  it("persists a save-baseline while connected and broadcasts baseline-changed to every client", async () => {
    const mock = new MockMixerClient();
    const baselineStore = new DiskBaselineStore(baselineFilePath());
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore });

    const requester = await connectClient(bridge.port);
    const observer = await connectClient(bridge.port);
    const initial = asSnapshot(await requester.next());
    await observer.next();
    expect(initial.baseline).toBeNull();

    const [requesterChanged, observerChanged] = await Promise.all([
      requester.next(),
      observer.next(),
      Promise.resolve().then(() =>
        requester.socket.send(JSON.stringify({ type: "save-baseline" })),
      ),
    ]);

    expect(requesterChanged).toEqual({
      type: "baseline-changed",
      baseline: initial.snapshot,
    });
    expect(observerChanged).toEqual(requesterChanged);

    const onDisk: unknown = JSON.parse(await readFile(baselineFilePath(), "utf8"));
    expect(onDisk).toEqual(initial.snapshot);
  });

  it("carries the persisted baseline in the on-connect snapshot after a bridge restart", async () => {
    const filePath = baselineFilePath();

    const firstMock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: firstMock,
      port: 0,
      baselineStore: new DiskBaselineStore(filePath),
    });
    const firstClient = await connectClient(bridge.port);
    const initial = asSnapshot(await firstClient.next());

    const savedPromise = firstClient.next();
    firstClient.socket.send(JSON.stringify({ type: "save-baseline" }));
    await savedPromise;

    await bridge.close();
    bridge = null;
    clients = [];

    const secondMock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: secondMock,
      port: 0,
      baselineStore: new DiskBaselineStore(filePath),
    });
    const secondClient = await connectClient(bridge.port);
    const afterRestart = asSnapshot(await secondClient.next());

    expect(afterRestart.baseline).toEqual(initial.snapshot);
  });

  it("rejects save-baseline while the mixer is disconnected and writes no file", async () => {
    const mock = new MockMixerClient();
    const filePath = baselineFilePath();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: new DiskBaselineStore(filePath),
    });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot

    mock.simulateConnectionLoss();
    await client.next(); // connection-state-changed -> disconnected

    const rejectedPromise = client.next();
    client.socket.send(JSON.stringify({ type: "save-baseline" }));
    const rejected = await rejectedPromise;

    expect(rejected).toEqual({
      type: "baseline-save-rejected",
      reason: expect.stringContaining("not connected"),
    });
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("rejects save-baseline when the cached snapshot is incomplete and writes no file", async () => {
    const incomplete = new MockMixerClient({
      channels: [
        { channel: CH12, name: "Only one", source: { kind: "aes50", bus: "A", channel: 1 } },
      ],
      selectedChannel: null,
    });
    const filePath = baselineFilePath();
    bridge = await startBridgeServer({
      mixerClient: incomplete,
      port: 0,
      baselineStore: new DiskBaselineStore(filePath),
    });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot

    const rejectedPromise = client.next();
    client.socket.send(JSON.stringify({ type: "save-baseline" }));
    const rejected = await rejectedPromise;

    expect(rejected).toEqual({
      type: "baseline-save-rejected",
      reason: expect.stringContaining("incomplete"),
    });
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("starts with no baseline (and does not crash) when the baseline file is corrupt", async () => {
    const filePath = baselineFilePath();
    await writeFile(filePath, "{ not valid json at all", "utf8");

    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: new DiskBaselineStore(filePath),
    });

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.baseline).toBeNull();
  });
});
