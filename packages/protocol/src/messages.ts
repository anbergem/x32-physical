/**
 * Wire protocol (architecture.md §7). JSON messages exchanged over the
 * bridge's WebSocket, expressed as discriminated unions so bridge and web
 * share one TS source of truth instead of hand-duplicated JSON shapes.
 *
 * Both message payloads reuse `mixer-contracts` types directly (`MixerSnapshot`,
 * `MixerEvent`, `MixerConnectionState`) — they are already plain
 * objects/arrays, so no separate wire encoding is needed.
 */

import type {
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";

/**
 * Bridge → web.
 *
 * On WS connect the bridge sends `snapshot` immediately from its cached
 * state, even if the mixer is currently unreachable (`mixerConnection:
 * "disconnected"` — the topology and last-known config still render). All
 * subsequent changes are `event` messages; if the bridge itself resyncs with
 * the mixer, it pushes a fresh `snapshot` to every client instead of an
 * `event`.
 */
export type ServerMessage =
  | { type: "snapshot"; snapshot: MixerSnapshot; mixerConnection: MixerConnectionState }
  | { type: "event"; event: MixerEvent };

/** Web → bridge. The only client-initiated message: ask for a fresh snapshot. */
export type ClientMessage = { type: "resync" };
