/**
 * Live mode (architecture.md §6): `WebSocketMixerGateway` connects to the
 * bridge and feeds `applyServerMessage`'s mapping — the same store slices
 * `LocalMockGateway` writes to, so no component can tell which gateway
 * delivered an event.
 *
 * A WS-level disconnect does not blank the schematic: the connection slice
 * flips to "disconnected", topology and last-known configuration stay on
 * screen (main.tsx's contract, inherited unchanged), and a capped
 * exponential backoff keeps retrying. The bridge sends a fresh `snapshot`
 * the instant a new socket is accepted (architecture.md §7), so a successful
 * reconnect resyncs state with no extra logic here.
 */

import type { InstallationOperation } from "@x32/installation";

import type { AppStore } from "../state/store";

import { applyServerMessage } from "./applyServerMessage";
import type { MixerGateway } from "./mixerGateway";

/** Matches `apps/x32-bridge`'s `X32_BRIDGE_PORT` default. */
const DEFAULT_BRIDGE_PORT = 8765;
export const DEFAULT_BRIDGE_URL = `ws://localhost:${DEFAULT_BRIDGE_PORT}`;

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

/**
 * The slice of the WebSocket API this gateway needs — a seam so tests never
 * open a real socket (see `webSocketMixerGateway.test.ts`).
 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

/**
 * Adapts a real browser `WebSocket` to `SocketLike` (the production
 * default). Written by hand rather than assigned directly so its shape never
 * has to satisfy `SocketLike` structurally — `WebSocket`'s own handler
 * properties take an event argument `SocketLike`'s do not.
 */
function openWebSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
  ws.addEventListener("open", () => socket.onopen?.());
  ws.addEventListener("close", () => socket.onclose?.());
  ws.addEventListener("error", (event) => socket.onerror?.(event));
  ws.addEventListener("message", (event) => socket.onmessage?.({ data: event.data }));
  return socket;
}

interface MinimalLocation {
  search: string;
  hostname: string;
  /** `hostname[:port]` — used for the production same-origin default below. */
  host: string;
  protocol: string;
}

function normalizeBridgeUrl(value: string): string {
  return value.startsWith("ws://") || value.startsWith("wss://")
    ? value
    : `ws://${value}`;
}

/**
 * Resolves the bridge's WebSocket URL: a `?bridge=` query override (a full
 * `ws(s)://` URL, or a bare `host[:port]`) wins; then the build-time
 * `VITE_X32_BRIDGE_URL`; then a default that depends on how the page itself
 * was served (plan step 16):
 *
 * - Vite dev server (`env.DEV`): `ws(s)://<page hostname>:8765` — the bridge
 *   runs as its own dev process on its own port, so guessing the page's port
 *   would be wrong.
 * - Anything else (a release build, `vite preview`, the staged bridge's own
 *   static serving): `ws(s)://<page host>`, i.e. same origin — the release
 *   bridge serves the built web app and the WebSocket API from one port
 *   (architecture.md §6/§7, step 16), so the page's own host:port *is* the
 *   bridge.
 *
 * Either way the scheme matches the page's own protocol so an https-served
 * app does not attempt a mixed-content plain `ws://` connection.
 */
export function resolveBridgeUrl(
  location: MinimalLocation,
  env: ImportMetaEnv = import.meta.env,
): string {
  const override = new URLSearchParams(location.search).get("bridge");
  if (override !== null && override !== "") return normalizeBridgeUrl(override);

  if (env.VITE_X32_BRIDGE_URL) return normalizeBridgeUrl(env.VITE_X32_BRIDGE_URL);

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  if (!env.DEV) return `${wsProtocol}//${location.host}`;
  return `${wsProtocol}//${location.hostname}:${DEFAULT_BRIDGE_PORT}`;
}

export class WebSocketMixerGateway implements MixerGateway {
  readonly #store: AppStore;
  readonly #url: string;
  readonly #createSocket: SocketFactory;

  #socket: SocketLike | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #backoffMs = MIN_BACKOFF_MS;
  #closed = true;

  constructor(store: AppStore, url: string, createSocket: SocketFactory = openWebSocket) {
    this.#store = store;
    this.#url = url;
    this.#createSocket = createSocket;
  }

  /**
   * Kicks off the first connection attempt and returns immediately — it does
   * not wait for the handshake or the first snapshot. The store's
   * `connection` slice (already rendered by `ConnectionStatus`) is the
   * source of truth for how far along that attempt is, exactly as it would
   * be for a real console that has not answered yet.
   */
  async connect(): Promise<void> {
    this.#closed = false;
    this.#open();
  }

  async disconnect(): Promise<void> {
    this.#closed = true;
    this.#clearReconnectTimer();
    this.#socket?.close();
    this.#socket = null;
    this.#store.getState().setConnection("disconnected");
  }

  /**
   * Sends `save-baseline` to the bridge; fire-and-forget (the bridge answers
   * asynchronously with `baseline-changed` or `baseline-save-rejected`,
   * handled by `applyServerMessage`). Silently a no-op with no live socket —
   * matches every other write path here: nothing throws just because the
   * connection dropped between button-enable and click.
   */
  saveBaseline(): void {
    this.#socket?.send(JSON.stringify({ type: "save-baseline" }));
  }

  /**
   * Sends `apply-installation-edit` (issue #27); the bridge answers
   * asynchronously with `installation-changed` or
   * `installation-edit-rejected`, both handled by `applyServerMessage`.
   *
   * With no live socket this says so rather than going quietly nowhere, unlike
   * `saveBaseline`: a baseline save is gated behind a button that is already
   * disabled while the mixer is down, but a label field can be left at any
   * moment, and an edit that appeared to be accepted and simply was not is the
   * worst outcome available here.
   */
  applyInstallationEdit(baseVersion: string, operation: InstallationOperation): void {
    if (this.#socket === null) {
      this.#store
        .getState()
        .setInstallationEditError(
          "Not connected to the X32 Routing Visualizer service, so nothing was saved.",
        );
      return;
    }
    this.#socket.send(
      JSON.stringify({ type: "apply-installation-edit", baseVersion, operation }),
    );
  }

  #open(): void {
    this.#store.getState().setConnection("connecting");

    const socket = this.#createSocket(this.#url);
    this.#socket = socket;

    socket.onopen = () => {
      // The transport is up; the bridge's own `snapshot` message (sent the
      // moment it accepts the connection) carries the real mixer state.
      this.#backoffMs = MIN_BACKOFF_MS;
    };

    socket.onmessage = (event) => {
      applyServerMessage(this.#store, event.data);
    };

    socket.onclose = () => {
      this.#socket = null;
      if (this.#closed) return;
      this.#store.getState().setConnection("disconnected");
      this.#scheduleReconnect();
    };

    socket.onerror = () => {
      // A browser WebSocket always follows an error with a close event; the
      // close handler above owns the actual reconnect bookkeeping.
    };
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer !== null) return;

    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#closed) this.#open();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}
