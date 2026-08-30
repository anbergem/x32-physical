/**
 * Bridge <-> WebSocket integration (architecture.md §7). A real `ws` client
 * against a bridge server bound to an ephemeral port (`port: 0`) — the only
 * layer worth an end-to-end test; the pure cache/mapping logic is exercised
 * implicitly through it.
 */

import { mixerChannelId } from "@x32/domain";
import { installationVersion } from "@x32/installation";
import { MockMixerClient } from "@x32/mixer-contracts";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import type { ServerMessage } from "@x32/protocol";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      outputs: [],
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

/**
 * Seeding at startup (issue #26). The live installation file lives in the
 * bridge's state directory, which survives MSI upgrades; the copy a release
 * ships is only ever used to *create* it.
 */
describe("seeding the live installation file (issue #26)", () => {
  /** A different valid document, so "which file won" is never ambiguous. */
  const SHIPPED_INSTALLATION_YAML = VALID_INSTALLATION_YAML.replace(
    'label: "Stagebox 1"',
    'label: "Shipped stagebox"',
  );

  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x32-bridge-seeding-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("first run: creates the live file from the shipped copy and serves it", async () => {
    const seedPath = join(dir, "shipped", "installation.yaml");
    const livePath = join(dir, "state", "installation.yaml");
    await mkdir(join(dir, "shipped"), { recursive: true });
    await writeFile(seedPath, SHIPPED_INSTALLATION_YAML, "utf8");

    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      installationFilePath: livePath,
      installationSeedPath: seedPath,
    });

    // The state directory did not exist before startup; the live file does now.
    expect(await readFile(livePath, "utf8")).toBe(SHIPPED_INSTALLATION_YAML);

    const response = await httpGet(bridge.port, "/api/installation");
    expect(response.status).toBe(200);
    expect(response.body).toBe(SHIPPED_INSTALLATION_YAML);
  });

  it("an existing live file is served and left byte-for-byte alone", async () => {
    const seedPath = join(dir, "shipped", "installation.yaml");
    const livePath = join(dir, "state", "installation.yaml");
    await mkdir(join(dir, "shipped"), { recursive: true });
    await mkdir(join(dir, "state"), { recursive: true });
    await writeFile(seedPath, SHIPPED_INSTALLATION_YAML, "utf8");
    await writeFile(livePath, VALID_INSTALLATION_YAML, "utf8");

    const mock = new MockMixerClient();
    bridge = await startBridgeServer({
      mixerClient: mock,
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      installationFilePath: livePath,
      installationSeedPath: seedPath,
    });

    // What a venue would lose if seeding ever overwrote: its own topology.
    expect(await readFile(livePath, "utf8")).toBe(VALID_INSTALLATION_YAML);

    const response = await httpGet(bridge.port, "/api/installation");
    expect(response.status).toBe(200);
    expect(response.body).toBe(VALID_INSTALLATION_YAML);
    expect(response.body).not.toContain("Shipped stagebox");
  });

  it("no live file and no shipped copy: the bridge still starts, 404s, and serves WS", async () => {
    const livePath = join(dir, "state", "installation.yaml");
    const missingSeed = join(dir, "shipped", "installation.yaml");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const mock = new MockMixerClient();
      bridge = await startBridgeServer({
        mixerClient: mock,
        port: 0,
        baselineStore: inMemoryBaselineStore(),
        installationFilePath: livePath,
        installationSeedPath: missingSeed,
      });

      // Nothing invented on disk when there was nothing to seed from.
      expect(existsSync(livePath)).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      const response = await httpGet(bridge.port, "/api/installation");
      expect(response.status).toBe(404);

      const client = await connectClient(bridge.port);
      const message = asSnapshot(await client.next());
      expect(message.snapshot.channels).toHaveLength(32);
    } finally {
      errorSpy.mockRestore();
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

/**
 * The installation write path (issue #27). End-to-end through a real socket
 * and a real file, because the two claims worth making — "nothing was
 * written" and "the previous content is in the .bak" — are claims about
 * bytes on disk.
 */
describe("apply-installation-edit (issue #27)", () => {
  /** A document with commentary, so comment survival is visible end to end. */
  const COMMENTED_INSTALLATION_YAML = `# The venue's own notes live here, and must survive an edit.
version: 1

devices:
  # Reverse-engineered offset — do not "fix" without measuring.
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

  /**
   * Schema-valid, domain-invalid: two panel sockets feed the same stagebox
   * input. `validateInstallation` rejects it, so any edit whose *result* is
   * this document must be refused however sensible the operation itself was.
   */
  const DOMAIN_INVALID_YAML = `version: 1

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
  - from: { device: front-left, input: 2 }
    to: { device: stagebox-1, input: 1 }
`;

  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x32-bridge-edit-"));
    path = join(dir, "installation.yaml");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function startWith(yaml: string): Promise<BridgeServer> {
    await writeFile(path, yaml, "utf8");
    return startBridgeServer({
      mixerClient: new MockMixerClient(),
      port: 0,
      baselineStore: inMemoryBaselineStore(),
      installationFilePath: path,
    });
  }

  function renameStagebox(baseVersion: string, label = "Stagebox One") {
    return JSON.stringify({
      type: "apply-installation-edit",
      baseVersion,
      operation: { kind: "set-device-label", device: "stagebox-1", label },
    });
  }

  it("carries the current installation version in the on-connect snapshot", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const client = await connectClient(bridge.port);
    const message = asSnapshot(await client.next());

    expect(message.installationVersion).toBe(installationVersion(COMMENTED_INSTALLATION_YAML));
  });

  it("applies an edit, keeps every comment, and broadcasts to every connected client", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const first = await connectClient(bridge.port);
    const second = await connectClient(bridge.port);
    const { installationVersion: version } = asSnapshot(await first.next());
    asSnapshot(await second.next());
    expect(version).not.toBeNull();

    first.socket.send(renameStagebox(version as string));

    for (const client of [first, second]) {
      const message = await client.next();
      expect(message.type).toBe("installation-changed");
      if (message.type !== "installation-changed") continue;
      expect(message.text).toContain('label: "Stagebox One"');
      expect(message.version).toBe(installationVersion(message.text));
    }

    const written = await readFile(path, "utf8");
    expect(written).toContain('label: "Stagebox One"');
    expect(written).toContain("# The venue's own notes live here");
    expect(written).toContain("# Reverse-engineered offset");
  });

  it("keeps the previous content in a .bak beside the live file", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const client = await connectClient(bridge.port);
    const { installationVersion: version } = asSnapshot(await client.next());
    client.socket.send(renameStagebox(version as string));
    await client.next();

    expect(await readFile(`${path}.bak`, "utf8")).toBe(COMMENTED_INSTALLATION_YAML);
  });

  it("serves the edited document at GET /api/installation without a restart", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const client = await connectClient(bridge.port);
    const { installationVersion: version } = asSnapshot(await client.next());
    client.socket.send(renameStagebox(version as string));
    await client.next();

    const response = await httpGet(bridge.port, "/api/installation");
    expect(response.status).toBe(200);
    expect(response.body).toContain('label: "Stagebox One"');
  });

  it("rejects a stale baseVersion, tells only the requester, and writes nothing", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const first = await connectClient(bridge.port);
    const second = await connectClient(bridge.port);
    asSnapshot(await first.next());
    asSnapshot(await second.next());

    first.socket.send(renameStagebox("0000000000000000"));

    const message = await first.next();
    expect(message.type).toBe("installation-edit-rejected");
    if (message.type === "installation-edit-rejected") {
      expect(message.reason).toMatch(/changed since/i);
    }

    expect(await readFile(path, "utf8")).toBe(COMMENTED_INSTALLATION_YAML);
    expect(existsSync(`${path}.bak`)).toBe(false);

    // The other client heard nothing at all: a rejection is the requester's
    // business, exactly like `baseline-save-rejected`.
    second.socket.send(JSON.stringify({ type: "resync" }));
    expect((await second.next()).type).toBe("snapshot");
  });

  it("rejects an operation naming a device that does not exist, with a message naming it", async () => {
    bridge = await startWith(COMMENTED_INSTALLATION_YAML);

    const client = await connectClient(bridge.port);
    const { installationVersion: version } = asSnapshot(await client.next());

    client.socket.send(
      JSON.stringify({
        type: "apply-installation-edit",
        baseVersion: version,
        operation: { kind: "set-device-label", device: "ghost-box", label: "Nowhere" },
      }),
    );

    const message = await client.next();
    expect(message.type).toBe("installation-edit-rejected");
    if (message.type === "installation-edit-rejected") {
      expect(message.reason).toContain("ghost-box");
    }
    expect(await readFile(path, "utf8")).toBe(COMMENTED_INSTALLATION_YAML);
  });

  it("rejects an edit whose result fails validation, and writes nothing", async () => {
    // The file is already domain-invalid, so the bridge 404s the topology
    // route; the write path must still refuse to store the result of an
    // otherwise-sensible rename rather than persist an invalid installation.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      bridge = await startWith(DOMAIN_INVALID_YAML);

      const client = await connectClient(bridge.port);
      const { installationVersion: version } = asSnapshot(await client.next());
      expect(version).toBe(installationVersion(DOMAIN_INVALID_YAML));

      client.socket.send(renameStagebox(version as string));

      const message = await client.next();
      expect(message.type).toBe("installation-edit-rejected");
      if (message.type === "installation-edit-rejected") {
        expect(message.reason).toMatch(/leave the installation invalid/i);
      }

      expect(await readFile(path, "utf8")).toBe(DOMAIN_INVALID_YAML);
      expect(existsSync(`${path}.bak`)).toBe(false);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("ignores a malformed edit message without disturbing the file or the socket", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      bridge = await startWith(COMMENTED_INSTALLATION_YAML);

      const client = await connectClient(bridge.port);
      asSnapshot(await client.next());

      client.socket.send(
        JSON.stringify({
          type: "apply-installation-edit",
          baseVersion: "0000000000000000",
          operation: { kind: "set-device-label", device: "Not A Device Id", label: "x" },
        }),
      );

      // Nothing comes back for the ignored message; the socket still works.
      client.socket.send(JSON.stringify({ type: "resync" }));
      expect((await client.next()).type).toBe("snapshot");
      expect(await readFile(path, "utf8")).toBe(COMMENTED_INSTALLATION_YAML);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
