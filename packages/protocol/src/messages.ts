/**
 * Wire protocol (architecture.md §7). JSON messages exchanged over the
 * bridge's WebSocket, expressed as discriminated unions so bridge and web
 * share one TS source of truth instead of hand-duplicated JSON shapes.
 *
 * Both message payloads reuse `mixer-contracts` types directly (`MixerSnapshot`,
 * `MixerEvent`, `MixerConnectionState`) — they are already plain
 * objects/arrays, so no separate wire encoding is needed.
 */

import type { InstallationOperation } from "@x32/installation";
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
      /**
       * The version of the `installation.yaml` the bridge currently holds
       * (issue #27) — the token an edit must send back as `baseVersion`. It
       * rides on `snapshot` rather than getting a message of its own because
       * the topology is the *slowest* lifecycle there is (CLAUDE.md invariant
       * 1), exactly like `baseline` and `updateAvailable`. The document
       * itself is not here: it is served as raw YAML at `GET
       * /api/installation`, and duplicating it on every snapshot would put a
       * whole file on the wire for every reconnect. `null` when the bridge
       * has no readable installation file at all.
       */
      installationVersion: string | null;
    }
  | { type: "event"; event: MixerEvent }
  | { type: "baseline-changed"; baseline: MixerSnapshot }
  | { type: "baseline-save-rejected"; reason: string }
  | { type: "meters"; levels: number[] }
  | { type: "update-available"; update: UpdateAvailable }
  /**
   * An edit landed (issue #27): the complete new document and its version,
   * broadcast to **every** client so a second browser on the venue LAN sees
   * the change without a reload. The whole text, not a diff — the receiving
   * client re-parses it with the same `parseInstallationYaml` it used at
   * startup, so the two can never disagree about what the file means, and the
   * document is small enough that a diff would only add a way to be wrong.
   */
  | { type: "installation-changed"; text: string; version: string }
  /**
   * An edit could not be honoured — a stale `baseVersion`, an operation
   * naming a device that is not there, or a result that fails validation.
   * Sent only to the requesting client, like `baseline-save-rejected`, and
   * worded for the operator: rejection is a normal outcome here, shown
   * plainly rather than retried or hidden.
   */
  | { type: "installation-edit-rejected"; reason: string };

/**
 * Web → bridge. `resync` asks for a fresh snapshot; `save-baseline` (step 13)
 * blesses the mixer's current resolved snapshot as the new baseline.
 *
 * `apply-installation-edit` (issue #27) is the second message with a side
 * effect. Like `save-baseline`, that side effect is confined to the bridge's
 * own disk — this writes the app's *own configuration*, never the mixer
 * (architecture.md §7, CLAUDE.md invariant 5 untouched).
 *
 * It carries a minimal typed `InstallationOperation`, never a whole document:
 * a re-serialised document loses its comments, which for this file is a
 * substantial part of its value, and an operation keeps validation errors
 * specific and conflicts fine-grained. New operation kinds are additive —
 * they are new members of `InstallationOperation` in `@x32/installation`, and
 * this message type does not change at all.
 */
export type ClientMessage =
  | { type: "resync" }
  | { type: "save-baseline" }
  | {
      type: "apply-installation-edit";
      /** The `installationVersion` the client believes it is editing. */
      baseVersion: string;
      operation: InstallationOperation;
    };
