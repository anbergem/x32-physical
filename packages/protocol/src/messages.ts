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
 *
 * `baseline` (step 13) is the bridge's disk-persisted blessed snapshot, `null`
 * until the first save; the snapshot message always carries the current
 * value so a freshly connected client sees any existing baseline without a
 * second round trip. `baseline-changed` follows a successful `save-baseline`.
 * `baseline-save-rejected` answers a `save-baseline` that could not be
 * honoured (mixer not connected, or its cached snapshot incomplete) — sent
 * only to the requesting client, never broadcast.
 */
export type ServerMessage =
  | {
      type: "snapshot";
      snapshot: MixerSnapshot;
      mixerConnection: MixerConnectionState;
      baseline: MixerSnapshot | null;
    }
  | { type: "event"; event: MixerEvent }
  | { type: "baseline-changed"; baseline: MixerSnapshot }
  | { type: "baseline-save-rejected"; reason: string };

/**
 * Web → bridge. `resync` asks for a fresh snapshot; `save-baseline` (step 13)
 * blesses the mixer's current resolved snapshot as the new baseline — the
 * only client message with a side effect, and that side effect is confined
 * to the bridge's own disk (architecture.md §7, CLAUDE.md invariant 5).
 */
export type ClientMessage = { type: "resync" } | { type: "save-baseline" };
