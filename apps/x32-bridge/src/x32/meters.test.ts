/**
 * Byte-level fixtures for `decodeMeterBlob` (docs/x32-protocol.md §Meters).
 * Constructed by hand — mixed endianness (little-endian count and floats,
 * inside a blob whose own size prefix is big-endian per `osc.test.ts`) is
 * exactly where fixture tests earn their keep.
 */

import { describe, expect, it } from "vitest";

import {
  decodeMeterBlob,
  extractSourceMeterLevels,
  SOURCE_METER_FLOAT_COUNT,
} from "./meters";

/** IEEE754 single-precision bit patterns, little-endian byte order. */
const FLOAT_0_5_LE = [0x00, 0x00, 0x00, 0x3f]; // 0.5
const FLOAT_1_0_LE = [0x00, 0x00, 0x80, 0x3f]; // 1.0
const FLOAT_NEG_0_25_LE = [0x00, 0x00, 0x80, 0xbe]; // -0.25

describe("decodeMeterBlob", () => {
  it("decodes a 3-float blob (count little-endian, floats little-endian)", () => {
    const blob = Buffer.from([
      0x03, 0x00, 0x00, 0x00, // int32 3, LITTLE-endian float count
      ...FLOAT_0_5_LE,
      ...FLOAT_1_0_LE,
      ...FLOAT_NEG_0_25_LE,
    ]);

    expect(decodeMeterBlob(blob)).toEqual([0.5, 1, -0.25]);
  });

  it("decodes a zero-float blob", () => {
    const blob = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(decodeMeterBlob(blob)).toEqual([]);
  });

  it("decodes a realistic 96-float meter blob, all zero", () => {
    const blob = Buffer.alloc(4 + 96 * 4);
    blob.writeInt32LE(96, 0);
    expect(decodeMeterBlob(blob)).toEqual(new Array(96).fill(0));
  });

  it("ignores trailing bytes beyond the declared float count", () => {
    // Declares 1 float but the buffer carries extra bytes after it — the
    // real /meters/1 blob is exactly sized, but decoding must not choke on
    // (or silently misread) more data than declared.
    const blob = Buffer.from([
      0x01, 0x00, 0x00, 0x00,
      ...FLOAT_0_5_LE,
      0xde, 0xad, 0xbe, 0xef, // extra, unrelated bytes
    ]);
    expect(decodeMeterBlob(blob)).toEqual([0.5]);
  });
});

describe("decodeMeterBlob — malformed input never crashes, always throws clearly", () => {
  it("rejects a blob too short for the float count", () => {
    expect(() => decodeMeterBlob(Buffer.from([0x00, 0x00]))).toThrow(/too short for the float count/);
  });

  it("rejects a negative float count", () => {
    const blob = Buffer.from([0xff, 0xff, 0xff, 0xff]); // -1 as int32 LE
    expect(() => decodeMeterBlob(blob)).toThrow(/negative float count/);
  });

  it("rejects a declared count that overruns the buffer", () => {
    const blob = Buffer.from([0x05, 0x00, 0x00, 0x00, ...FLOAT_0_5_LE]); // declares 5, only 1 present
    expect(() => decodeMeterBlob(blob)).toThrow(/declares 5 float\(s\)/);
  });
});

describe("extractSourceMeterLevels (issue #36)", () => {
  /** A `/meters/0` reply whose every index holds its own index as a value. */
  function identityBlock(count = SOURCE_METER_FLOAT_COUNT): number[] {
    return Array.from({ length: count }, (_, index) => index);
  }

  it("slices buses from index 48 and matrices from index 64", () => {
    const levels = extractSourceMeterLevels(identityBlock());

    // Values equal their index, so these assert the offsets directly.
    expect(levels?.buses).toEqual([
      48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
    ]);
    expect(levels?.matrices).toEqual([64, 65, 66, 67, 68, 69]);
  });

  it("returns 16 buses and 6 matrices", () => {
    const levels = extractSourceMeterLevels(identityBlock());

    expect(levels?.buses).toHaveLength(16);
    expect(levels?.matrices).toHaveLength(6);
  });

  it("returns null for a block of any other length, rather than misaligned levels", () => {
    // A console whose layout differs must degrade to "no meters", never to
    // "wrong meters" — a bar beside the wrong speaker is worse than none.
    expect(extractSourceMeterLevels(identityBlock(69))).toBeNull();
    expect(extractSourceMeterLevels(identityBlock(71))).toBeNull();
    expect(extractSourceMeterLevels(identityBlock(96))).toBeNull();
    expect(extractSourceMeterLevels([])).toBeNull();
  });

  it("reads the last matrix without running off the end", () => {
    const block = identityBlock();
    block[69] = 0.42;

    expect(extractSourceMeterLevels(block)?.matrices[5]).toBe(0.42);
  });
});
