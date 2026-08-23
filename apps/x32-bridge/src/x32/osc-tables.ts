/**
 * Raw X32 enum tables (docs/x32-protocol.md §The messages we track and
 * §Resolution algorithm). Pure numbers in, pure numbers/plain unions out — no
 * `@x32/domain` import here; `resolve.ts` is the layer that turns these into
 * `MixerSourceRef`. Keeping this file domain-free makes the tables trivially
 * testable against the doc's own worked examples.
 *
 * Every classifier here is deliberately non-throwing: a value outside the
 * documented range degrades to the safest reading ("off") rather than
 * throwing, mirroring `packages/domain/src/routing.ts`'s stance that a stray
 * value from an adapter must not take the whole schematic down. `resolve.ts`
 * builds on that guarantee to stay non-throwing too.
 */

/** `/ch/NN/config/source`, classified per docs/x32-protocol.md's table. */
export type ChannelSourceCategory =
  | { kind: "off" }
  | { kind: "input-slot"; slot: number } // 1–32
  | { kind: "aux"; input: number } // 1–6
  | { kind: "usb"; side: "L" | "R" }
  | { kind: "fx"; ret: number } // 1–4
  | { kind: "bus"; bus: number }; // 1–16

/**
 * 0 = off; 1–32 = input slot; 33–38 = aux 1–6; 39/40 = USB L/R;
 * 41–48 = FX 1L–4R (both channels of one return share `ret`, matching
 * `MixerSourceRef`'s `fx` shape which has no L/R side); 49–64 = bus 1–16.
 * Anything else (including negative values) is out of spec — treated as off.
 */
export function classifyChannelSourceValue(value: number): ChannelSourceCategory {
  if (!Number.isInteger(value)) return { kind: "off" };
  if (value === 0) return { kind: "off" };
  if (value >= 1 && value <= 32) return { kind: "input-slot", slot: value };
  if (value >= 33 && value <= 38) return { kind: "aux", input: value - 32 };
  if (value === 39) return { kind: "usb", side: "L" };
  if (value === 40) return { kind: "usb", side: "R" };
  if (value >= 41 && value <= 48) return { kind: "fx", ret: Math.floor((value - 41) / 2) + 1 };
  if (value >= 49 && value <= 64) return { kind: "bus", bus: value - 48 };
  return { kind: "off" };
}

/** One entry of the `/config/routing/IN/*` enum (0–23), per the doc's table. */
export type InBlockEntry =
  | { kind: "local"; base: number }
  | { kind: "aes50"; bus: "A" | "B"; base: number }
  | { kind: "card"; base: number }
  | { kind: "userin"; base: number };

/**
 * Index = the wire value (0–23). `base` is the 1-based slot number the block
 * starts at, e.g. index 5 is `A9-16` (AES50-A, base 9): input slot 12 in that
 * block (k = 12 − 9 = 3, 0-based) resolves to AES50-A channel 9 + 3 = 12.
 */
export const IN_BLOCK_TABLE: readonly InBlockEntry[] = [
  { kind: "local", base: 1 }, // 0  AN1-8
  { kind: "local", base: 9 }, // 1  AN9-16
  { kind: "local", base: 17 }, // 2  AN17-24
  { kind: "local", base: 25 }, // 3  AN25-32
  { kind: "aes50", bus: "A", base: 1 }, // 4  A1-8
  { kind: "aes50", bus: "A", base: 9 }, // 5  A9-16
  { kind: "aes50", bus: "A", base: 17 }, // 6  A17-24
  { kind: "aes50", bus: "A", base: 25 }, // 7  A25-32
  { kind: "aes50", bus: "A", base: 33 }, // 8  A33-40
  { kind: "aes50", bus: "A", base: 41 }, // 9  A41-48
  { kind: "aes50", bus: "B", base: 1 }, // 10 B1-8
  { kind: "aes50", bus: "B", base: 9 }, // 11 B9-16
  { kind: "aes50", bus: "B", base: 17 }, // 12 B17-24
  { kind: "aes50", bus: "B", base: 25 }, // 13 B25-32
  { kind: "aes50", bus: "B", base: 33 }, // 14 B33-40
  { kind: "aes50", bus: "B", base: 41 }, // 15 B41-48
  { kind: "card", base: 1 }, // 16 CARD1-8
  { kind: "card", base: 9 }, // 17 CARD9-16
  { kind: "card", base: 17 }, // 18 CARD17-24
  { kind: "card", base: 25 }, // 19 CARD25-32
  { kind: "userin", base: 1 }, // 20 UIN1-8
  { kind: "userin", base: 9 }, // 21 UIN9-16
  { kind: "userin", base: 17 }, // 22 UIN17-24
  { kind: "userin", base: 25 }, // 23 UIN25-32
];

/** The IN block quarter (0–3) an input slot (1–32) falls in. */
export function inBlockQuarterOf(slot: number): 0 | 1 | 2 | 3 {
  return Math.floor((slot - 1) / 8) as 0 | 1 | 2 | 3;
}

/** The 0-based position of an input slot (1–32) within its block of 8. */
export function inBlockPositionOf(slot: number): number {
  return (slot - 1) % 8;
}

/** `/config/userrout/in/NN`, resolved per docs/x32-protocol.md's table. */
export type UserRoutTarget =
  | { kind: "off" }
  | { kind: "local"; input: number } // 1–32
  | { kind: "aes50"; bus: "A" | "B"; channel: number } // 1–48
  | { kind: "card"; input: number } // 1–32
  | { kind: "aux"; input: number } // 1–6
  | { kind: "talkback"; which: "int" | "ext" };

/**
 * 0 = off; 1–32 = local; 33–80 = AES50-A (v−32); 81–128 = AES50-B (v−80);
 * 129–160 = card; 161–166 = aux; 167/168 = talkback int/ext. Out-of-range
 * values (including negatives) fall back to off, per this module's stance.
 */
export function resolveUserRoutValue(value: number): UserRoutTarget {
  if (!Number.isInteger(value)) return { kind: "off" };
  if (value === 0) return { kind: "off" };
  if (value >= 1 && value <= 32) return { kind: "local", input: value };
  if (value >= 33 && value <= 80) return { kind: "aes50", bus: "A", channel: value - 32 };
  if (value >= 81 && value <= 128) return { kind: "aes50", bus: "B", channel: value - 80 };
  if (value >= 129 && value <= 160) return { kind: "card", input: value - 128 };
  if (value >= 161 && value <= 166) return { kind: "aux", input: value - 160 };
  if (value === 167) return { kind: "talkback", which: "int" };
  if (value === 168) return { kind: "talkback", which: "ext" };
  return { kind: "off" };
}

/**
 * `/-stat/selidx`: 0–31 → Ch 1–32 (1-based); everything else (32–71's other
 * strip types, and any out-of-spec value) → no input channel selected.
 */
export function selIdxToChannel(value: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value >= 0 && value <= 31) return value + 1;
  return null;
}
