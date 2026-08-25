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
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import type { BaselineStore } from "../baselineStore";
import { DiskBaselineStore } from "../baselineStore";
import type { UpdateChecker, UpdateInfo } from "../updateCheck";

import type { BridgeServer } from "./bridgeServer";
import { startBridgeServer } from "./bridgeServer";

const CH12 = mixerChannelId(12);

/** A small but complete valid installation document (issue #3's `GET /api/installation` tests). */
const VALID_INSTALLATION_YAML = `version: 1

devices:
  stagebox-1:
    kind: stagebox
    label: "Stagebox 1"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  front-left:
    kind: passive-panel
    label: "Front Left"
    inputs: 8

connections:
  - from: { device: front-left, input: 1 }
    to: { device: stagebox-1, input: 1 }
`;

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

/**
 * A fully manual `UpdateChecker` (step 20) — no timers, no fetch. Tests
 * control exactly when an update is "found" via `emit`, so the wiring in
 * `bridgeServer.ts` (snapshot's `updateAvailable`, the `update-available`
 * broadcast) can be exercised without real network/timer dependencies.
 */
function fakeUpdateChecker(): UpdateChecker & { emit(update: UpdateInfo): void } {
  let current: UpdateInfo | null = null;
  const listeners = new Set<(update: UpdateInfo) => void>();
  return {
    getUpdate: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      /* no-op — nothing scheduled */
    },
    emit(update) {
      current = update;
      for (const listener of listeners) listener(update);
    },
  };
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

  it("forwards meter levels as a rounded 'meters' message, never through 'event'", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

    const client = await connectClient(bridge.port);
    await client.next(); // initial snapshot

    mock.simulateMetersStart(5); // fast interval — the test doesn't care about real-time cadence
    const message = await client.next();

    expect(message.type).toBe("meters");
    if (message.type !== "meters") throw new Error("expected a meters message");
    expect(message.levels).toHaveLength(32);
    // Rounded to 3 decimals (architecture.md §7) — never more precision than that.
    for (const level of message.levels) {
      expect(level).toBe(Math.round(level * 1000) / 1000);
    }

    mock.simulateMetersStop();
  });

  it("skips sending meters when no client is connected", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({ mixerClient: mock, port: 0, baselineStore: inMemoryBaselineStore() });

    // No client connected yet — this must not throw or hang.
    mock.simulateMetersStart(5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    mock.simulateMetersStop();

    const client = await connectClient(bridge.port);
    const message = await client.next();
    expect(message.type).toBe("snapshot"); // not a stale/queued meters message
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

/** Raw HTTP GET against the bridge's own port, alongside the WS API (plan step 16). */
function httpGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("production static serving (plan step 16)", () => {
  let webDist: string;

  beforeEach(async () => {
    webDist = await mkdtemp(join(tmpdir(), "x32-bridge-web-"));
    await writeFile(join(webDist, "index.html"), "<html>the app</html>");
  });

  afterEach(async () => {
    await rm(webDist, { recursive: true, force: true });
  });

  it("serves the built web app over HTTP on the same port as the WS API", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      webDist,
    });

    const httpResponse = await httpGet(bridge.port, "/");
    expect(httpResponse.status).toBe(200);
    expect(httpResponse.body).toBe("<html>the app</html>");

    // WS still works on the very same port.
    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());
    expect(message.snapshot.channels).toHaveLength(32);
  });

  it("blocks path traversal outside webDist, including URL-encoded segments", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      webDist,
    });
    const outsideSecret = join(webDist, "..", `secret-${Date.now()}.txt`);
    await writeFile(outsideSecret, "top secret");
    try {
      // File extensions here so the SPA index.html fallback can't mask the
      // result — this specifically exercises the traversal guard.
      const plain = await httpGet(bridge.port, `/../${outsideSecret.split("/").pop()}`);
      expect(plain.status).toBe(404);
      expect(plain.body).not.toContain("top secret");

      const encoded = await httpGet(bridge.port, `/%2e%2e/${outsideSecret.split("/").pop()}`);
      expect(encoded.status).toBe(404);
      expect(encoded.body).not.toContain("top secret");
    } finally {
      await rm(outsideSecret, { force: true });
    }
  });

  it("without X32_WEB_DIST, HTTP GET gets a minimal 404 and WS is unaffected", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      // webDist intentionally omitted
    });

    const httpResponse = await httpGet(bridge.port, "/");
    expect(httpResponse.status).toBe(404);

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());
    expect(message.snapshot.channels).toHaveLength(32);
  });
});

describe("GET /api/installation (issue #3)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x32-bridge-installation-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the file's exact bytes with text/yaml when the file loads", async () => {
    const path = join(dir, "installation.yaml");
    await writeFile(path, VALID_INSTALLATION_YAML, "utf8");

    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      installationFilePath: path,
    });

    const response = await httpGet(bridge.port, "/api/installation");
    expect(response.status).toBe(200);
    expect(response.body).toBe(VALID_INSTALLATION_YAML);
    expect(response.headers["content-type"]).toBe("text/yaml");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("404s on a missing file, and the server still starts and serves the app and WS", async () => {
    const missingPath = join(dir, "does-not-exist.yaml");
    const webDist = await mkdtemp(join(tmpdir(), "x32-bridge-web-installation-"));
    await writeFile(join(webDist, "index.html"), "<html>the app</html>");

    try {
      const mock = new MockMixerClient();
      bridge = await startBridgeServer({
        mixerClient: mock,
        port: 0,
        baselineStore: inMemoryBaselineStore(),
        installationFilePath: missingPath,
        webDist,
      });

      const apiResponse = await httpGet(bridge.port, "/api/installation");
      expect(apiResponse.status).toBe(404);

      const appResponse = await httpGet(bridge.port, "/");
      expect(appResponse.status).toBe(200);
      expect(appResponse.body).toBe("<html>the app</html>");

      const client = await connectClient(bridge.port);
      const message = asSnapshot(await client.next());
      expect(message.snapshot.channels).toHaveLength(32);
    } finally {
      await rm(webDist, { recursive: true, force: true });
    }
  });

  it("404s on invalid YAML/topology, logs exactly one error, and the server still starts", async () => {
    const path = join(dir, "installation.yaml");
    await writeFile(path, "not: [valid, installation, shape", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const mock = new MockMixerClient();
      bridge = await startBridgeServer({
        mixerClient: mock,
        port: 0,
        baselineStore: inMemoryBaselineStore(),
        installationFilePath: path,
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain(path);

      const response = await httpGet(bridge.port, "/api/installation");
      expect(response.status).toBe(404);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("honors installationFilePath (the resolved X32_INSTALLATION_FILE override)", async () => {
    const overridePath = join(dir, "venue-override.yaml");
    await writeFile(overridePath, VALID_INSTALLATION_YAML, "utf8");

    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      installationFilePath: overridePath,
    });

    const response = await httpGet(bridge.port, "/api/installation");
    expect(response.status).toBe(200);
    expect(response.body).toBe(VALID_INSTALLATION_YAML);
  });

  it("is matched before static resolution and isn't reachable via traversal tricks", async () => {
    const path = join(dir, "installation.yaml");
    await writeFile(path, VALID_INSTALLATION_YAML, "utf8");
    const webDist = await mkdtemp(join(tmpdir(), "x32-bridge-web-installation-"));
    await writeFile(join(webDist, "index.html"), "<html>the app</html>");

    try {
      const mock = new MockMixerClient();
      bridge = await startBridgeServer({
        mixerClient: mock,
        port: 0,
        baselineStore: inMemoryBaselineStore(),
        installationFilePath: path,
        webDist,
      });

      const direct = await httpGet(bridge.port, "/api/installation");
      expect(direct.status).toBe(200);
      expect(direct.body).toBe(VALID_INSTALLATION_YAML);

      // Dot-segment traversal into and back out of the route: the URL
      // parser collapses this to the exact route path, so it still hits the
      // installation route rather than the static handler at all.
      const dotSegment = await httpGet(bridge.port, "/api/../api/installation");
      expect(dotSegment.status).toBe(200);
      expect(dotSegment.body).toBe(VALID_INSTALLATION_YAML);

      // URL-encoded dot segment: `URL`'s own parsing normalizes `%2e%2e`
      // the same way, so this is really just `/api/installation` again —
      // not a traversal at all, and it "behaves sanely" by serving the same
      // route rather than doing anything surprising.
      const encoded = await httpGet(bridge.port, "/api/%2e%2e/api/installation");
      expect(encoded.status).toBe(200);
      expect(encoded.body).toBe(VALID_INSTALLATION_YAML);

      // A traversal attempt that does *not* collapse to the route itself
      // falls through to the static handler's own traversal guard (and, for
      // an extensionless result, its SPA fallback) — never to the
      // installation file.
      const outsideAttempt = await httpGet(bridge.port, "/api/installation/../../../../etc/passwd");
      expect(outsideAttempt.body).not.toContain(VALID_INSTALLATION_YAML);
      expect(outsideAttempt.headers["content-type"]).not.toBe("text/yaml");
    } finally {
      await rm(webDist, { recursive: true, force: true });
    }
  });
});

describe("in-app update notice (plan step 20)", () => {
  it("snapshot carries updateAvailable: null when no update has been found", async () => {
    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      updateChecker: fakeUpdateChecker(),
    });

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());
    expect(message.updateAvailable).toBeNull();
  });

  it("snapshot carries the checker's current update when one was already found", async () => {
    const mock = new MockMixerClient();
    const checker = fakeUpdateChecker();
    checker.emit({ version: "0.2.0", url: "https://example.com/release/v0.2.0" });

    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      updateChecker: checker,
    });

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());
    expect(message.updateAvailable).toEqual({
      version: "0.2.0",
      url: "https://example.com/release/v0.2.0",
    });
  });

  it("broadcasts update-available to already-connected clients when the checker finds one later", async () => {
    const mock = new MockMixerClient();
    const checker = fakeUpdateChecker();

    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      updateChecker: checker,
    });

    const client = await connectClient(bridge.port);
    asSnapshot(await client.next()); // consume the initial snapshot

    checker.emit({ version: "0.3.0", url: "https://example.com/release/v0.3.0" });

    const message = await client.next();
    expect(message).toEqual({
      type: "update-available",
      update: { version: "0.3.0", url: "https://example.com/release/v0.3.0" },
    });
  });
});
