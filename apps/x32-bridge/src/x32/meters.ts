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
