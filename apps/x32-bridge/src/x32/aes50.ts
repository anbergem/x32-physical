/**
 * AES50 wire decoding (docs/x32-protocol.md §The messages we track,
 * `/-stat/aes50/[A,B]` and `/-stat/aes50/state`; issue #17). The only place
 * that knows the device-letter table and the state bitfield layout —
 * `resolve.ts`/`x32MixerClient.ts` store and fan out the decoded
 * `@x32/domain` shapes, never the raw string/int.
 *
 * Both decoders are non-throwing, matching `osc-tables.ts`'s stance: a
 * value outside the documented shape degrades to "ignore this reply"
 * (`null`) rather than crashing the bridge over one corrupt or unexpected
 * wire value. `parseAes50Chain` goes further and is defensive per-character:
 * an unrecognised letter becomes an unrecognised box (`model: null`) rather
 * than invalidating the whole string, and the caller logs the raw string
 * once at snapshot time (`x32MixerClient.ts`) so its real filler format can
 * be read off the venue console later — this module does not know or guess
 * what an empty chain position looks like on the wire.
 */

import type { Aes50Bus, Aes50Chain, Aes50ChainBox, Aes50LinkState } from "@x32/domain";

/**
 * Device letters `/-stat/aes50/[A,B]` reports, per the Maillot document
 * (docs/x32-protocol.md "Verified facts"). Only the letters the doc
 * actually lists are here — anything else is an unrecognised box, not a
 * guess.
 */
const DEVICE_LETTER_TO_MODEL: Readonly<Record<string, string>> = {
  A: "S16",
  B: "X32C",
  C: "X32",
  D: "DL251",
  E: "DL251HA",
  F: "S16B",
  G: "Z32",
  H: "T8",
  I: "X32P",
  J: "X32RACK",
  K: "X32CORE",
  L: "M32",
  M: "M32R",
  N: "DL16",
  O: "DL16B",
  P: "SD16",
  Q: "SD16B",
  R: "SD8",
  S: "SD8B",
  T: "DL15X",
  U: "DL15XHA",
  V: "DL231",
  W: "S32",
  X: "S32B",
  Y: "DL32",
  Z: "DL32B",
  a: "M32C",
};

const CHAIN_POSITIONS = 4;

/** A single ASCII letter — the shape every real device code takes. */
const LETTER_PATTERN = /^[A-Za-z]$/;

/**
 * `/-stat/aes50/[A,B]`: `string[4]` of device letters (chain positions),
 * followed by 6 chars of preamp type — the doc's `string[4]` + 6 chars
 * shape. Only the first 4 characters are chain positions; anything past
 * that (the preamp block) is parsed and kept nowhere yet (issue #17 "Out of
 * scope": preamp-type characters earn no screen space).
 *
 * Two different "not a box here" cases, deliberately told apart:
 *
 * - A character that *is* a letter but not in our device-letter table is a
 *   real, detected box our table doesn't yet know — kept as a box with
 *   `model: null` and the raw letter retained, so it isn't silently
 *   dropped (this is what `compareAes50Chain` treats as "no finding", not
 *   what this parser treats as "nothing").
 * - A character that isn't a letter at all (space, digit, null, or
 *   whatever the console actually pads empty positions with — undocumented,
 *   issue #17 "Verified facts") is filler, not a device: omitted entirely.
 *
 * Never throws: `raw` shorter than 4 characters just yields fewer/no boxes.
 */
export function parseAes50Chain(bus: Aes50Bus, raw: string): Aes50Chain {
  const boxes: Aes50ChainBox[] = [];
  for (let i = 0; i < CHAIN_POSITIONS && i < raw.length; i += 1) {
    const rawLetter = raw[i];
    if (rawLetter === undefined || !LETTER_PATTERN.test(rawLetter)) continue; // filler, not a device
    const model = DEVICE_LETTER_TO_MODEL[rawLetter] ?? null; // a letter, but not one our table knows
    boxes.push({ position: i + 1, model, rawLetter });
  }
  return { bus, boxes };
}

/**
 * `/-stat/aes50/state`: int bitfield — bit 0 A audio err, bit 1 B audio
 * err, bit 2 A aux err, bit 3 B aux err, bit 4 lock. Valid values are
 * therefore 0–31 (5 defined bits); anything outside that range —
 * including negative values — is out of spec and ignored (`null`), logged
 * once by the caller, rather than guessed at.
 */
export function parseAes50State(value: number): Aes50LinkState | null {
  if (!Number.isInteger(value) || value < 0 || value > 31) return null;

  return {
    buses: [
      { bus: "A", audioError: (value & 0b00001) !== 0, auxError: (value & 0b00100) !== 0 },
      { bus: "B", audioError: (value & 0b00010) !== 0, auxError: (value & 0b01000) !== 0 },
    ],
    locked: (value & 0b10000) !== 0,
  };
}
