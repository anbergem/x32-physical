/**
 * Mixer routing model (architecture.md §3).
 *
 * These are domain types on purpose: `buildRouteIndex` (plan step 5) consumes
 * them and `mixer-contracts` imports them from here — never the reverse. The
 * domain resolves routes from this normalized state and never sees OSC.
 */

import type { Aes50Bus, MixerChannelId } from "./ids";

/** Where a mixer input slot or channel ultimately pulls signal from. */
export type MixerSourceRef =
  | { kind: "aes50"; bus: Aes50Bus; channel: number } // 1–48
  | { kind: "local"; input: number } // console XLR 1–32
  | { kind: "card"; input: number }
  | { kind: "aux"; input: number }
  | { kind: "usb"; side: "L" | "R" }
  | { kind: "fx"; ret: number }
  | { kind: "bus"; bus: number }
  | { kind: "talkback"; which: "int" | "ext" }
  | { kind: "off" };

export interface MixerChannelState {
  channel: MixerChannelId;
  name: string;
  /**
   * Fully resolved source (input-block and user-in indirection already applied
   * by the adapter/mock — see docs/x32-protocol.md §Resolution).
   */
  source: MixerSourceRef;
}
