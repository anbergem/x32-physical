/**
 * Bridge -> web message handling (architecture.md §7/§8). The one place that
 * turns a raw WebSocket payload into store writes; `WebSocketMixerGateway`'s
 * `onmessage` handler is a one-line wrapper around this, which is what keeps
 * it testable without a real socket (see `applyServerMessage.test.ts`).
 *
 * Reuses `applyToStore`'s mapping verbatim — `LocalMockGateway` and this
 * gateway must not be able to disagree about which slice an event lands in.
 */

import { parseServerMessage } from "@x32/protocol";

import type { AppStore } from "../state/store";

import { applyBaseline, applyMixerEvent, applyMixerSnapshot } from "./applyToStore";

/**
 * @param data `MessageEvent.data` from the socket in production (a JSON
 *   string); tests may pass an already-parsed `ServerMessage`-shaped value
 *   directly. A malformed payload is logged and ignored — the guards in
 *   `@x32/protocol` exist precisely so one bad message cannot take the whole
 *   pipe down.
 */
export function applyServerMessage(store: AppStore, data: unknown): void {
  let raw: unknown;
  try {
    raw = typeof data === "string" ? JSON.parse(data) : data;
  } catch (error) {
    console.warn("WebSocketMixerGateway: ignoring unparsable server message", error);
    return;
  }

  let message;
  try {
    message = parseServerMessage(raw);
  } catch (error) {
    console.warn("WebSocketMixerGateway: ignoring malformed server message", error);
    return;
  }

  switch (message.type) {
    case "snapshot":
      applyMixerSnapshot(store, message.snapshot, message.mixerConnection);
      applyBaseline(store, message.baseline);
      return;
    case "event":
      applyMixerEvent(store, message.event);
      return;
    case "baseline-changed":
      applyBaseline(store, message.baseline);
      return;
    case "baseline-save-rejected":
      // Surfaced inline near the "Save as correct" button (plan step 14,
      // `DiagnosticsControl`) via the runtime `baselineSaveError` slice.
      store.getState().setBaselineSaveError(message.reason);
      return;
  }
}
