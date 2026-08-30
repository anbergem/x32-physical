/**
 * Meter blob decoding (docs/x32-protocol.md §Meters).
 *
 * The `/meters/1` reply's OSC blob (already extracted from its `,b` envelope
 * by `./osc.ts`) has its own little tiny format, unlike the rest of the
 * protocol: an int32 **little-endian** float count, followed by that many
 * 32-bit **little-endian** floats — the one place in this codebase where
 * endianness flips mid-message. Decoding it here, separately from the
 * generic OSC blob envelope, keeps that surprise contained to one file.
 */

/**
 * Decodes a `/meters/1` blob into its float values (typically 96 for the
 * console's meter block; the adapter takes only the first 32 as the input
 * channel levels — see `x32MixerClient.ts`).
 *
 * Throws a descriptive `Error` on anything malformed — too short for the
 * count, a count that overruns the buffer, a trailing partial float — never
 * crashes; one corrupt UDP datagram must not take the bridge down.
 */
export function decodeMeterBlob(blob: Buffer): number[] {
  if (blob.length < 4) {
    throw new Error(
      `Malformed meter blob: ${blob.length} byte(s), too short for the float count.`,
    );
  }

  const count = blob.readInt32LE(0);
  if (count < 0) {
    throw new Error(`Malformed meter blob: negative float count ${count}.`);
  }

  const needed = 4 + count * 4;
  if (blob.length < needed) {
    throw new Error(
      `Malformed meter blob: declares ${count} float(s) (needs ${needed} bytes) but only ` +
        `${blob.length} byte(s) are present.`,
    );
  }

  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    values.push(blob.readFloatLE(4 + i * 4));
  }
  return values;
}

/**
 * `/meters/0`'s layout — **the single place this assumption lives** (issue
 * #36). If it is ever shown wrong, this block is the only thing to change.
 *
 * The console replies with exactly **70** floats, and the strip ordering
 * `/-stat/selidx` documents (docs/x32-protocol.md §The messages we track) is:
 *
 * ```text
 *   0–31  Ch 1–32        32–39  Aux In 1–8     40–47  FX return 1–8
 *  48–63  Bus 1–16       64–69  Matrix 1–6     70  L/R      71  M/C
 * ```
 *
 * `32 + 8 + 8 + 16 + 6 = 70` — the block is precisely that ordering truncated
 * immediately before the main strips, which is also why Main L/R and M/C are
 * absent from it and are reported as "not metered" rather than guessed.
 *
 * **Provenance and its limits.** This is corroborated but not proven:
 *
 * - The `selidx` ordering above is verified against the protocol document.
 * - The 70-value length matches that ordering exactly, and *only* with 16
 *   buses — 8 buses would give 62.
 * - Measured at the venue 2026-08-30 with all input channels at noise floor
 *   (max 0.0004) but a stereo source playing: indices 34–35 were the hottest
 *   values on the desk (Aux In 3/4, the playback feed), 64–69 were active
 *   while 48–63 were silent (music routed to zone matrices, not the monitor
 *   buses), and 64/65 carried values identical to 68/69 — which is what
 *   docs/venue-betania.md predicts, since Matrix 1/2 is the legacy recording
 *   feed and Matrix 5/6 now feeds Main L/R, so both pairs carry the same mix.
 *
 * What is still missing is a controlled test: drive one source at a time
 * (pink noise into Bus 1 alone, then Matrix 3) and confirm which index moves.
 * The project owner accepted the hypothesis without it (2026-08-30); this
 * comment exists so that decision stays visible rather than hardening into
 * assumed fact.
 */
export const SOURCE_METER_FLOAT_COUNT = 70;
/** Index of Bus 1 within a `/meters/0` reply. */
export const SOURCE_METER_BUS_OFFSET = 48;
export const SOURCE_METER_BUS_COUNT = 16;
/** Index of Matrix 1 within a `/meters/0` reply. */
export const SOURCE_METER_MATRIX_OFFSET = 64;
export const SOURCE_METER_MATRIX_COUNT = 6;

/**
 * Slices a decoded `/meters/0` reply into the bus and matrix levels.
 *
 * Returns `null` — rather than partial data — when the reply is not the
 * expected length. A block of a different size means the layout above does
 * not apply, and reading fixed offsets out of it would put a meter next to
 * the wrong speaker, which is worse than showing none. One console that
 * disagrees must degrade to "no meters", never to "wrong meters".
 */
export function extractSourceMeterLevels(
  values: number[],
): { buses: number[]; matrices: number[] } | null {
  if (values.length !== SOURCE_METER_FLOAT_COUNT) return null;

  return {
    buses: values.slice(
      SOURCE_METER_BUS_OFFSET,
      SOURCE_METER_BUS_OFFSET + SOURCE_METER_BUS_COUNT,
    ),
    matrices: values.slice(
      SOURCE_METER_MATRIX_OFFSET,
      SOURCE_METER_MATRIX_OFFSET + SOURCE_METER_MATRIX_COUNT,
    ),
  };
}
