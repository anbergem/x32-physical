/**
 * The bridge's WebSocket server (architecture.md §6/§7/§8).
 *
 * Per client: send the cached `snapshot` immediately on connect (even if the
 * mixer is currently unreachable — the topology and last-known config still
 * render, per §7); forward every subsequent `MixerEvent` as an `event`
 * message to every connected client; on a client's `{type: "resync"}`,
 * re-send that one client a fresh snapshot.
 *
 * The bridge also maintains its own cache: the initial `getSnapshot()` result,
 * kept current by applying each `MixerEvent` (mirrors `apps/web`'s
 * `applyToStore`, independently — the bridge has no store and does not need
 * `routeIndex`, only the flat mixer state it re-serves to new clients).
 *
 * The WebSocket server shares one `node:http` server with the static file
 * handler (plan step 16, `staticFileServer.ts`) — one port serves both the
 * built web app and the WS API in production; unset `webDist` keeps today's
 * WS-only dev behaviour.
 *
 * A `connection-state-changed` transition to `"connected"` is treated as a
 * resync opportunity rather than a plain delta: the bridge re-reads the
 * mixer's ground truth and pushes a fresh `snapshot` to every client instead
 * of trusting incremental events across the gap (architecture.md §7 — "if the
 * bridge itself resyncs with the mixer, it pushes a fresh snapshot to all
 * clients"). Every other event is forwarded as-is.
 *
 * Since issue #27 the bridge also *writes* one file on request: the venue's
 * own `installation.yaml`, via `apply-installation-edit`. That is the app's
 * own configuration and nothing else — the mixer stays read-only (CLAUDE.md
 * invariant 5). The ordering of that pipeline is deliberate and lives in
 * `@x32/installation`'s `applyInstallationEdit`, shared with mock mode so
 * there is exactly one write path; this module owns the two ends of it that
 * are genuinely the server's business: the disk repository, and broadcasting
 * the result to every connected client.
 */

import { MIXER_CHANNEL_COUNT } from "@x32/domain";
import type { MixerChannelState } from "@x32/domain";
import type { InstallationFileState, InstallationOperation } from "@x32/installation";
import { applyInstallationEdit, describeOperation } from "@x32/installation";
import type {
  MixerClient,
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";
import type { ClientMessage, ServerMessage } from "@x32/protocol";
import { parseClientMessage } from "@x32/protocol";
import { createServer } from "node:http";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { BaselineStore } from "../baselineStore";
import {
  DEFAULT_INSTALLATION_FILE,
  seedInstallationFile,
  shippedInstallationSeedPath,
} from "../installationFile";
import { DiskInstallationRepository } from "../installationRepository";
import { cloneSnapshot } from "../snapshot";
import type { UpdateChecker } from "../updateCheck";
import { startUpdateChecker } from "../updateCheck";

import {
  createInstallationAwareHandler,
  createStaticFileHandler,
  createWsOnlyHandler,
} from "./staticFileServer";

export interface BridgeServerOptions {
  mixerClient: MixerClient;
  /** WebSocket port; `0` binds an OS-assigned ephemeral port (tests). */
  port: number;
  /** Where the blessed baseline (architecture.md §7) is loaded from and persisted to. */
  baselineStore: BaselineStore;
  /**
   * Absolute path to the built web app (plan step 16). When set, plain HTTP
   * `GET`/`HEAD` requests on this same port serve it (hand-rolled static
   * handler, `staticFileServer.ts`); when unset, HTTP requests get a minimal
   * 404 and only the WebSocket API is served — today's dev behaviour,
   * unchanged.
   */
  webDist?: string;
  /**
   * Path to the **live** `installation.yaml`, served raw at
   * `GET /api/installation` (issue #3, architecture.md §7). `main.ts` always
   * supplies `config.ts`'s `resolveInstallationFilePath` here (the state
   * directory, or `X32_INSTALLATION_FILE`); the default is only for tests
   * and standalone embedding. A missing or invalid file is logged once and
   * the route 404s — never fatal to startup.
   */
  installationFilePath?: string;
  /**
   * The read-only copy a release ships, used **only** to create
   * `installationFilePath` when that file does not exist yet (issue #26).
   * Defaults to `shippedInstallationSeedPath()`. An existing live file is
   * never replaced from here.
   */
  installationSeedPath?: string;
  /**
   * The in-app update notice's checker (plan step 20, architecture.md §7).
   * Defaults to a real `startUpdateChecker()` (own VERSION file, real
   * GitHub API, real timers) — tests inject a fake here instead of waiting
   * on real timers/network.
   */
  updateChecker?: UpdateChecker;
}

export interface BridgeServer {
  /** The actually-bound port (relevant when `port: 0` was requested). */
  readonly port: number;
  close(): Promise<void>;
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeEvent(event: MixerEvent): string {
  switch (event.type) {
    case "selected-channel-changed":
      return `selected channel -> ${event.channel ?? "none"}`;
    case "channel-name-changed":
      return `CH${event.channel} renamed to "${event.name}"`;
    case "channel-source-changed":
      return `CH${event.channel} source changed (${event.source.kind})`;
    case "output-source-changed":
      return `Out ${event.output} source changed (${event.source.kind})`;
    case "connection-state-changed":
      return `mixer connection -> ${event.state}`;
    case "aes50-link-state-changed":
      return `AES50 link state changed (locked=${event.state.locked})`;
    case "aes50-chain-changed":
      return `AES50-${event.chain.bus} chain changed (${event.chain.boxes.length} box(es) detected)`;
  }
}

/**
 * Connects `mixerClient`, starts a WebSocket server on `port`, and wires the
 * fan-out described above. Resolves once the server is listening.
 */
export async function startBridgeServer(
  options: BridgeServerOptions,
): Promise<BridgeServer> {
  const { mixerClient, baselineStore } = options;
  const updateChecker = options.updateChecker ?? startUpdateChecker({});

  // Read at startup (CLAUDE.md invariant 1 — topology is the slowest
  // lifecycle, not a runtime concern); a bad or missing file logs loudly and
  // 404s the route rather than blocking the bridge from starting (issue #3).
  // The same repository is what the edit pipeline writes through (issue #27),
  // so there is one reader and one writer of this file, not two.
  //
  // First run creates the live file from the shipped copy; an existing one is
  // left exactly as it is, so no release can overwrite a venue's own topology
  // (issue #26).
  const installationFilePath = options.installationFilePath ?? DEFAULT_INSTALLATION_FILE;
  seedInstallationFile(
    installationFilePath,
    options.installationSeedPath ?? shippedInstallationSeedPath(),
  );
  const installationRepository = new DiskInstallationRepository(installationFilePath);

  /** `null` when the file could not be read at all; `installation: null` when it read but does not hold up. */
  let installationState: InstallationFileState | null = null;
  try {
    installationState = await installationRepository.read();
    if (installationState.installation === null) {
      console.error(
        `x32-bridge: failed to load installation file: ${installationState.error ?? "unknown error"}`,
      );
    }
  } catch (error) {
    console.error(`x32-bridge: failed to load installation file: ${errorMessage(error)}`);
  }

  /**
   * The bytes `GET /api/installation` serves. A document that does not
   * validate is served as nothing at all (404), never as a 200 the browser
   * would then fail to parse — the app renders its startup error instead of
   * half a schematic (issue #26).
   */
  function installationTextForRoute(): string | null {
    return installationState !== null && installationState.installation !== null
      ? installationState.text
      : null;
  }

  console.log(
    installationTextForRoute() !== null
      ? `x32-bridge: serving installation topology from ${installationFilePath}`
      : `x32-bridge: GET /api/installation will 404 until ${installationFilePath} loads (see docs/installation.md)`,
  );

  // Establish the baseline before subscribing: `getSnapshot()` returns
  // current truth regardless of anything that happened during `connect()`,
  // so there is no gap for an event to slip through unlike a UI gateway that
  // has no equivalent "re-read everything" fallback.
  await mixerClient.connect();
  let cachedSnapshot = cloneSnapshot(await mixerClient.getSnapshot());
  let cachedConnection: MixerConnectionState = mixerClient.getConnectionState();
  let cachedBaseline: MixerSnapshot | null = await baselineStore.load();

  function cloneNullableSnapshot(snapshot: MixerSnapshot | null): MixerSnapshot | null {
    return snapshot === null ? null : cloneSnapshot(snapshot);
  }

  function snapshotMessage(): ServerMessage {
    return {
      type: "snapshot",
      snapshot: cloneSnapshot(cachedSnapshot),
      mixerConnection: cachedConnection,
      baseline: cloneNullableSnapshot(cachedBaseline),
      updateAvailable: updateChecker.getUpdate(),
      // The token an edit must quote back as `baseVersion` (issue #27). The
      // document itself is not here — it is fetched once from
      // `GET /api/installation`; only its version rides along, so a client
      // always knows what it is editing against without a second round trip.
      installationVersion: installationState?.version ?? null,
    };
  }

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function broadcast(message: ServerMessage): void {
    for (const socket of wss.clients) send(socket, message);
  }

  function replaceChannel(
    channel: MixerChannelState["channel"],
    update: (current: MixerChannelState) => MixerChannelState,
  ): void {
    cachedSnapshot = {
      ...cachedSnapshot,
      channels: cachedSnapshot.channels.map((current) =>
        current.channel === channel ? update(current) : current,
      ),
    };
  }

  async function resync(): Promise<void> {
    try {
      cachedSnapshot = cloneSnapshot(await mixerClient.getSnapshot());
      cachedConnection = "connected";
      console.log(
        `x32-bridge: mixer resynced, pushing a fresh snapshot to ${wss.clients.size} client(s)`,
      );
      broadcast(snapshotMessage());
    } catch (error) {
      console.error("x32-bridge: resync after reconnect failed:", errorMessage(error));
    }
  }

  /**
   * Blesses `cachedSnapshot` as the new baseline (architecture.md §7). Only
   * confined to the bridge's own disk — never the mixer (CLAUDE.md invariant
   * 5). Rejected — reason sent only to the requesting client, never
   * broadcast — while the mixer is disconnected or the cached snapshot is
   * incomplete: nobody blesses a half-read state.
   */
  async function handleSaveBaseline(socket: WebSocket): Promise<void> {
    if (cachedConnection !== "connected") {
      send(socket, {
        type: "baseline-save-rejected",
        reason: "The mixer is not connected.",
      });
      return;
    }
    if (cachedSnapshot.channels.length !== MIXER_CHANNEL_COUNT) {
      send(socket, {
        type: "baseline-save-rejected",
        reason: `The current snapshot is incomplete (${cachedSnapshot.channels.length}/${MIXER_CHANNEL_COUNT} channels).`,
      });
      return;
    }

    const toSave = cloneSnapshot(cachedSnapshot);
    try {
      await baselineStore.save(toSave);
    } catch (error) {
      console.error("x32-bridge: failed to persist baseline:", errorMessage(error));
      send(socket, {
        type: "baseline-save-rejected",
        reason: `Failed to persist the baseline: ${errorMessage(error)}`,
      });
      return;
    }

    cachedBaseline = toSave;
    console.log(`x32-bridge: baseline saved, broadcasting to ${wss.clients.size} client(s)`);
    broadcast({ type: "baseline-changed", baseline: cloneSnapshot(cachedBaseline) });
  }

  /**
   * The installation write path (issue #27, epic #25). The ordered pipeline —
   * read, reject a stale `baseVersion`, apply surgically, validate the
   * *result*, write atomically with a `.bak` — is `applyInstallationEdit` in
   * `@x32/installation`, shared verbatim with the web app's mock mode so a
   * second write path cannot drift into existence. What is genuinely this
   * server's own is the two ends: the disk repository it runs against, and
   * the broadcast afterwards.
   *
   * A rejection goes only to the requesting client (like
   * `baseline-save-rejected`) and is worded for the operator; a success is
   * broadcast to everyone, because a second browser on the venue LAN is
   * showing the same schematic and must not keep displaying the old label.
   *
   * Nothing here touches the mixer (CLAUDE.md invariant 5) — this writes the
   * app's own configuration file and nothing else.
   */
  async function handleApplyInstallationEdit(
    socket: WebSocket,
    baseVersion: string,
    operation: InstallationOperation,
  ): Promise<void> {
    const result = await applyInstallationEdit(
      installationRepository,
      baseVersion,
      operation,
      installationFilePath,
    );

    if (!result.ok) {
      console.warn(
        `x32-bridge: installation edit rejected (${describeOperation(operation)}): ${result.reason}`,
      );
      send(socket, { type: "installation-edit-rejected", reason: result.reason });
      return;
    }

    installationState = result.state;
    console.log(
      `x32-bridge: installation edited (${describeOperation(operation)}), ` +
        `broadcasting to ${wss.clients.size} client(s)`,
    );
    broadcast({
      type: "installation-changed",
      text: result.state.text,
      version: result.state.version,
    });
  }

  /**
   * Meters (architecture.md §5/§7, step 15): forwarded as their own `meters`
   * message, never through `event` — too chatty for that fan-out. Rounded to
   * 3 decimals to keep frames small; skipped entirely when nobody is
   * listening rather than serializing and discarding on every tick.
   * `subscribeMeters` is an optional `MixerClient` capability — the mock
   * hosted directly by the bridge implements it too, but a hypothetical
   * future implementation that doesn't is tolerated here.
   */
  const unsubscribeMeters = mixerClient.subscribeMeters?.((levels) => {
    if (wss.clients.size === 0) return;
    broadcast({
      type: "meters",
      levels: levels.map((level) => Math.round(level * 1000) / 1000),
    });
  });

  /**
   * The output side's levels (issue #36) — same discipline as `meters` above:
   * its own message, rounded to 3 decimals, skipped when nobody is listening.
   * Also an optional capability, so an adapter that cannot read the console's
   * internal strips simply never sends it and the UI shows no output meters
   * rather than zeroes.
   */
  const round3 = (level: number): number => Math.round(level * 1000) / 1000;
  const unsubscribeSourceMeters = mixerClient.subscribeSourceMeters?.((levels) => {
    if (wss.clients.size === 0) return;
    broadcast({
      type: "source-meters",
      levels: { buses: levels.buses.map(round3), matrices: levels.matrices.map(round3) },
    });
  });

  /**
   * The in-app update notice (step 20): a check that completes after clients
   * are already connected still reaches them, via its own broadcast message
   * rather than piggybacking on `event`/`snapshot` (architecture.md §7).
   */
  const unsubscribeUpdateChecker = updateChecker.subscribe((update) => {
    console.log(`x32-bridge: broadcasting update-available (v${update.version}) to ${wss.clients.size} client(s)`);
    broadcast({ type: "update-available", update });
  });

  const unsubscribe = mixerClient.subscribe((event) => {
    if (event.type === "connection-state-changed") {
      if (event.state === "connected") {
        void resync();
        return;
      }
      cachedConnection = event.state;
      console.log(`x32-bridge: ${describeEvent(event)}`);
      broadcast({ type: "event", event });
      return;
    }

    if (event.type === "selected-channel-changed") {
      cachedSnapshot = { ...cachedSnapshot, selectedChannel: event.channel };
    } else if (event.type === "channel-name-changed") {
      replaceChannel(event.channel, (current) => ({ ...current, name: event.name }));
    } else if (event.type === "channel-source-changed") {
      replaceChannel(event.channel, (current) => ({
        ...current,
        source: { ...event.source },
      }));
    }

    console.log(`x32-bridge: ${describeEvent(event)}`);
    broadcast({ type: "event", event });
  });

  const baseHttpHandler =
    options.webDist !== undefined
      ? createStaticFileHandler(options.webDist)
      : createWsOnlyHandler();
  const httpServer = createServer(
    createInstallationAwareHandler(baseHttpHandler, installationTextForRoute),
  );
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    console.log(`x32-bridge: client connected (${wss.clients.size} total)`);
    send(socket, snapshotMessage());

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        console.warn("x32-bridge: ignoring unexpected binary client message");
        return;
      }

      let message: ClientMessage;
      try {
        message = parseClientMessage(JSON.parse(rawDataToString(raw)));
      } catch (error) {
        console.warn(
          `x32-bridge: ignoring malformed client message: ${errorMessage(error)}`,
        );
        return;
      }

      if (message.type === "resync") {
        console.log("x32-bridge: client requested resync");
        send(socket, snapshotMessage());
        return;
      }

      if (message.type === "save-baseline") {
        console.log("x32-bridge: client requested save-baseline");
        void handleSaveBaseline(socket);
        return;
      }

      if (message.type === "apply-installation-edit") {
        console.log(
          `x32-bridge: client requested installation edit (${describeOperation(message.operation)})`,
        );
        void handleApplyInstallationEdit(socket, message.baseVersion, message.operation);
      }
    });

    socket.on("close", () => {
      console.log(`x32-bridge: client disconnected (${wss.clients.size} total)`);
    });

    socket.on("error", (error) => {
      console.error("x32-bridge: client socket error:", errorMessage(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
    httpServer.listen(options.port);
  });

  const address = httpServer.address();
  const boundPort = typeof address === "string" || address === null
    ? options.port
    : address.port;

  return {
    port: boundPort,
    async close() {
      unsubscribe();
      unsubscribeMeters?.();
      unsubscribeSourceMeters?.();
      unsubscribeUpdateChecker();
      updateChecker.stop();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await mixerClient.disconnect();
    },
  };
}
