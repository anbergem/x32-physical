/**
 * Mixer output routing model (architecture.md §3).
 *
 * `MixerOutputSourceRef` is deliberately its own union, not an extension of
 * `MixerSourceRef` (`mixer.ts`): "Bus 3 feeds an output" and "a channel is
 * sourced from Bus 3" are different relationships in different semantic
 * spaces, and conflating them would let a route resolve nonsense (a mixer
 * channel "fed by" an output slot, say).
 */

import type { MixerChannelId } from "./ids";

/** Where a console Out slot (1–16) pulls its signal from. */
export type MixerOutputSourceRef =
  | { kind: "main"; side: "L" | "R" | "C" }
  | { kind: "bus"; bus: number } // 1–16
  | { kind: "matrix"; matrix: number } // 1–6
  | { kind: "direct-out-channel"; channel: MixerChannelId }
  | { kind: "direct-out-aux"; aux: number } // 1–8
  | { kind: "direct-out-fx"; ret: number } // 1L–4R encoded 1–8
  | { kind: "monitor"; side: "L" | "R" }
  | { kind: "talkback" }
  | { kind: "off" };

export interface MixerOutputState {
  output: number; // 1–16
  name?: string;
  source: MixerOutputSourceRef;
}

/**
 * Structural equality for `MixerOutputSourceRef`. Every field across every
 * variant is a primitive, so a generic key-wise comparison is exact — the
 * same approach `mixerSourceRefEquals` (`mixer.ts`) uses for the input-side
 * union, kept as a separate function rather than a shared one so the two
 * source spaces stay typed apart.
 */
export function mixerOutputSourceRefEquals(
  a: MixerOutputSourceRef,
  b: MixerOutputSourceRef,
): boolean {
  if (a.kind !== b.kind) return false;

  const left: Record<string, unknown> = a;
  const right: Record<string, unknown> = b;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

/**
 * Live levels for the console's *internal* sources — the things that feed
 * output slots (issue #36).
 *
 * Deliberately keyed by **source**, not by output slot. An output's meter is
 * the meter of whatever feeds it, so resolving it this way needs no new
 * topology: two destinations fed by the same bus correctly read the same
 * level, because they genuinely carry the same signal.
 *
 * Both arrays are 1-based by position: `buses[0]` is Bus 1, `matrices[0]` is
 * Matrix 1. Values are linear amplitude 0.0–1.0 (1.0 = full scale), the same
 * scale as the input-channel meters — see docs/x32-protocol.md §Meters.
 */
export interface MixerSourceMeterLevels {
  /** Mix buses 1–16, by position. */
  buses: number[];
  /** Matrices 1–6, by position. */
  matrices: number[];
}

/**
 * The live level for whatever feeds an output, or `null` when this source
 * kind is not metered.
 *
 * **`null` means "unknown", never "silent"**, and callers must render the two
 * differently: a missing meter has to look absent, not like a dead output. A
 * zero bar next to a working speaker is exactly the false alarm this tool
 * exists to avoid.
 *
 * Only buses and matrices are metered, because only they are carried by the
 * meter block the adapter reads (`/meters/0`, whose 70 values stop right
 * before the main strips). Main L/R, M/C, the monitor bus and talkback live
 * in a different block whose layout is **not** verified, so they return
 * `null` rather than a guessed value — at this venue that means Out 14 (M/C)
 * shows no meter. Direct-outs are excluded deliberately: a direct-out
 * channel's level is already the input-channel meter, and duplicating it here
 * would create a second source of truth for the same number.
 */
export function meterLevelForOutputSource(
  source: MixerOutputSourceRef,
  levels: MixerSourceMeterLevels | null,
): number | null {
  if (levels === null) return null;

  switch (source.kind) {
    case "bus":
      return levels.buses[source.bus - 1] ?? null;
    case "matrix":
      return levels.matrices[source.matrix - 1] ?? null;
    default:
      return null;
  }
}
