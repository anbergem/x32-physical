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
 * A `connection-state-changed` transition to `"connected"` is treated as a
 * resync opportunity rather than a plain delta: the bridge re-reads the
 * mixer's ground truth and pushes a fresh `snapshot` to every client instead
 * of trusting incremental events across the gap (architecture.md §7 — "if the
 * bridge itself resyncs with the mixer, it pushes a fresh snapshot to all
 * clients"). Every other event is forwarded as-is.
 */

import { MIXER_CHANNEL_COUNT } from "@x32/domain";
import type { MixerChannelState } from "@x32/domain";
import type {
  MixerClient,
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";
import type { ClientMessage, ServerMessage } from "@x32/protocol";
import { parseClientMessage } from "@x32/protocol";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { BaselineStore } from "../baselineStore";
import { cloneSnapshot } from "../snapshot";

export interface BridgeServerOptions {
  mixerClient: MixerClient;
  /** WebSocket port; `0` binds an OS-assigned ephemeral port (tests). */
  port: number;
  /** Where the blessed baseline (architecture.md §7) is loaded from and persisted to. */
  baselineStore: BaselineStore;
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
    case "connection-state-changed":
      return `mixer connection -> ${event.state}`;
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

  const wss = new WebSocketServer({ port: options.port });

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
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  const address = wss.address();
  const boundPort = typeof address === "string" || address === null
    ? options.port
    : address.port;

  return {
    port: boundPort,
    async close() {
      unsubscribe();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
      await mixerClient.disconnect();
    },
  };
}
