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
