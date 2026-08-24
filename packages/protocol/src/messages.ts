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
 *
 * `meters` (step 15) is the fourth, fastest state path (architecture.md §5):
 * live per-channel levels, forwarded as-is from the adapter's
 * `subscribeMeters` capability several times a second. It deliberately does
 * not reuse `event`/`MixerEvent` — that fan-out is for occasional
 * routing/selection changes, and folding meters into it would make every
 * other consumer of `event` pay for traffic it doesn't care about. `levels`
 * is always exactly 32 entries (one per input channel, 1-based index 0 =
 * channel 1), rounded to 3 decimals bridge-side to keep frames small.
 *
 * `updateAvailable` (step 20) is a config-lifecycle value, not runtime: the
 * bridge's GitHub Releases check runs at most every few hours, so it rides
 * along on `snapshot` the same way `baseline` does. `update-available` is the
 * one addition — a plain broadcast, not folded into `event` or `snapshot` —
 * because a check can complete well after every currently-connected client
 * already has its snapshot; without it, a client that connected during the
 * ~30s startup delay would never learn about an update found afterwards
 * short of its own reconnect. `url` is always an `https://` URL (enforced by
 * the parse guard in `parse.ts`) — never trust it to be safe to render as a
 * link otherwise.
 */
export interface UpdateAvailable {
  readonly version: string;
  readonly url: string;
}

export type ServerMessage =
  | {
      type: "snapshot";
      snapshot: MixerSnapshot;
      mixerConnection: MixerConnectionState;
      baseline: MixerSnapshot | null;
      updateAvailable: UpdateAvailable | null;
    }
  | { type: "event"; event: MixerEvent }
  | { type: "baseline-changed"; baseline: MixerSnapshot }
  | { type: "baseline-save-rejected"; reason: string }
  | { type: "meters"; levels: number[] }
  | { type: "update-available"; update: UpdateAvailable };

/**
 * Web → bridge. `resync` asks for a fresh snapshot; `save-baseline` (step 13)
 * blesses the mixer's current resolved snapshot as the new baseline — the
 * only client message with a side effect, and that side effect is confined
 * to the bridge's own disk (architecture.md §7, CLAUDE.md invariant 5).
 */
export type ClientMessage = { type: "resync" } | { type: "save-baseline" };
