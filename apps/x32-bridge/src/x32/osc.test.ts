/**
 * Byte-level fixtures for the OSC codec (docs/x32-protocol.md §OSC codec).
 *
 * Each fixture's expected bytes are built independently of `encodeOscMessage`
 * — from the ASCII text plus the OSC padding rule applied by hand
 * (`ceil((length + 1) / 4) * 4`, shown inline per fixture) — so the test
 * actually checks the codec's byte layout rather than round-tripping through
 * itself.
 */

import { describe, expect, it } from "vitest";

import type { OscArgument, OscMessage } from "./osc";
import { decodeOscMessage, encodeOscMessage } from "./osc";

/** `text` as ASCII bytes, null-terminated and zero-padded to `paddedLength`. */
function oscString(text: string, paddedLength: number): Buffer {
  const bytes = Buffer.alloc(paddedLength);
  bytes.write(text, 0, "ascii");
  return bytes;
}

function fixture(address: Buffer, typeTag: Buffer, argBytes: number[] = []): Buffer {
  return Buffer.concat([address, typeTag, Buffer.from(argBytes)]);
}

describe("encodeOscMessage / decodeOscMessage — byte-level fixtures", () => {
  it("/xremote (no args)", () => {
    // "/xremote" is 8 chars -> 8+1=9 -> next multiple of 4 = 12.
    // "," is 1 char -> 1+1=2 -> next multiple of 4 = 4.
    const expected = fixture(oscString("/xremote", 12), oscString(",", 4));
    expect(expected).toHaveLength(16);

    expect(encodeOscMessage("/xremote")).toEqual(expected);
    expect(encodeOscMessage("/xremote", [])).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual({ address: "/xremote", args: [] });
  });

  it("/-stat/selidx ,i 11", () => {
    // "/-stat/selidx" is 13 chars -> 13+1=14 -> next multiple of 4 = 16.
    // ",i" is 2 chars -> 2+1=3 -> next multiple of 4 = 4.
    const expected = fixture(oscString("/-stat/selidx", 16), oscString(",i", 4), [
      0x00, 0x00, 0x00, 0x0b, // int32 11, big-endian
    ]);
    expect(expected).toHaveLength(24);

    const message: OscMessage = { address: "/-stat/selidx", args: [{ type: "i", value: 11 }] };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });

  it('/ch/01/config/name ,s "Kick In"', () => {
    // "/ch/01/config/name" is 18 chars -> 18+1=19 -> next multiple of 4 = 20.
    // ",s" is 2 chars -> 2+1=3 -> next multiple of 4 = 4.
    // "Kick In" is 7 chars -> 7+1=8 -> next multiple of 4 = 8.
    const expected = fixture(
      oscString("/ch/01/config/name", 20),
      oscString(",s", 4),
      [...oscString("Kick In", 8)],
    );
    expect(expected).toHaveLength(32);

    const message: OscMessage = {
      address: "/ch/01/config/name",
      args: [{ type: "s", value: "Kick In" }],
    };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });

  it("/config/routing/IN/1-8 ,i 20", () => {
    // "/config/routing/IN/1-8" is 22 chars -> 22+1=23 -> next multiple of 4 = 24.
    // ",i" -> 4, as above.
    const expected = fixture(oscString("/config/routing/IN/1-8", 24), oscString(",i", 4), [
      0x00, 0x00, 0x00, 0x14, // int32 20, big-endian
    ]);
    expect(expected).toHaveLength(32);

    const message: OscMessage = {
      address: "/config/routing/IN/1-8",
      args: [{ type: "i", value: 20 }],
    };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });

  it("a float message: /ch/01/mix/fader ,f 0.5", () => {
    // "/ch/01/mix/fader" is 16 chars -> 16+1=17 -> next multiple of 4 = 20.
    // ",f" -> 4, as above.
    // 0.5 is the exact IEEE754 single-precision bit pattern 0x3F000000.
    const expected = fixture(oscString("/ch/01/mix/fader", 20), oscString(",f", 4), [
      0x3f, 0x00, 0x00, 0x00,
    ]);
    expect(expected).toHaveLength(28);

    const message: OscMessage = { address: "/ch/01/mix/fader", args: [{ type: "f", value: 0.5 }] };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });
});

describe("encodeOscMessage / decodeOscMessage — blob (`,b`) fixtures", () => {
  it("/meters/1 ,b with a 5-byte blob (needs 3 bytes of padding)", () => {
    // "/meters/1" is 9 chars -> 9+1=10 -> next multiple of 4 = 12.
    // ",b" is 2 chars -> 2+1=3 -> next multiple of 4 = 4.
    // blob: int32 BE size (5) + 5 data bytes + 3 padding bytes = 12 bytes total.
    const data = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const expected = fixture(oscString("/meters/1", 12), oscString(",b", 4), [
      0x00, 0x00, 0x00, 0x05, // int32 5, big-endian (blob byte length)
      0x01, 0x02, 0x03, 0x04, 0x05, // the 5 data bytes
      0x00, 0x00, 0x00, // padding to the next 4-byte boundary
    ]);
    expect(expected).toHaveLength(28);

    const message: OscMessage = { address: "/meters/1", args: [{ type: "b", value: data }] };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });

  it("a blob whose length is already a multiple of 4 needs no padding", () => {
    const data = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22]);
    const expected = fixture(oscString("/meters/1", 12), oscString(",b", 4), [
      0x00, 0x00, 0x00, 0x08, // int32 8, big-endian
      ...data,
    ]);
    expect(expected).toHaveLength(28);

    const message: OscMessage = { address: "/meters/1", args: [{ type: "b", value: data }] };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });

  it("a zero-length blob", () => {
    const expected = fixture(oscString("/meters/1", 12), oscString(",b", 4), [
      0x00, 0x00, 0x00, 0x00,
    ]);
    const message: OscMessage = { address: "/meters/1", args: [{ type: "b", value: Buffer.alloc(0) }] };
    expect(encodeOscMessage(message.address, message.args)).toEqual(expected);
    expect(decodeOscMessage(expected)).toEqual(message);
  });
});

describe("decodeOscMessage — malformed blobs never crash, always throw clearly", () => {
  it("rejects a blob with no room for the size prefix", () => {
    const buffer = Buffer.concat([oscString("/a", 4), oscString(",b", 4)]);
    expect(() => decodeOscMessage(buffer)).toThrow(/buffer too short for blob size/);
  });

  it("rejects a blob whose declared size runs past the end of the buffer", () => {
    const buffer = Buffer.concat([
      oscString("/a", 4),
      oscString(",b", 4),
      Buffer.from([0x00, 0x00, 0x00, 0x08]), // claims 8 bytes, none follow
    ]);
    expect(() => decodeOscMessage(buffer)).toThrow(/only 0 are available/);
  });

  it("rejects a negative blob size", () => {
    const buffer = Buffer.concat([
      oscString("/a", 4),
      oscString(",b", 4),
      Buffer.from([0xff, 0xff, 0xff, 0xff]), // -1 as int32 BE
    ]);
    expect(() => decodeOscMessage(buffer)).toThrow(/negative blob size/);
  });

  it("rejects non-zero padding bytes after a blob", () => {
    const buffer = Buffer.concat([
      oscString("/a", 4),
      oscString(",b", 4),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x00, 0x00, 0x01]), // 1-byte blob, corrupt padding
    ]);
    expect(() => decodeOscMessage(buffer)).toThrow(/non-zero padding byte/);
  });
});

describe("encodeOscMessage / decodeOscMessage — round-trips", () => {
  const cases: OscMessage[] = [
    { address: "/xinfo", args: [] },
    { address: "/config/routing/routswitch", args: [{ type: "i", value: 0 }] },
    { address: "/config/userrout/in/01", args: [{ type: "i", value: 55 }] },
    { address: "/ch/32/config/name", args: [{ type: "s", value: "Spare 32" }] },
    { address: "/-stat/selidx", args: [{ type: "i", value: 0 }] },
    { address: "/-stat/selidx", args: [{ type: "i", value: 71 }] },
    {
      address: "/mixed/args",
      args: [
        { type: "i", value: -7 },
        { type: "s", value: "hello world" },
        { type: "f", value: 3.25 },
      ],
    },
  ];

  it.each(cases)("round-trips $address", (message) => {
    const encoded = encodeOscMessage(message.address, message.args);
    expect(decodeOscMessage(encoded)).toEqual(message);
  });

  it("round-trips a high-bit byte in a string argument without ASCII-masking it", () => {
    // U+00C3 ("Ã") is a single Latin-1 byte, 0xC3 — under "ascii" encoding
    // Node would mask the high bit down to 0x43 ("C"), silently corrupting it.
    const value = `${String.fromCharCode(0xc3)}lex`;
    const message: OscMessage = { address: "/ch/01/config/name", args: [{ type: "s", value }] };

    const encoded = encodeOscMessage(message.address, message.args);
    // "/ch/01/config/name" pads to 20 bytes, ",s" pads to 4 -> the string
    // argument's first byte sits at offset 24.
    expect(encoded[24]).toBe(0xc3);
    expect(decodeOscMessage(encoded)).toEqual(message);
  });
});

describe("encodeOscMessage — validation", () => {
  it("rejects an address that does not start with /", () => {
    expect(() => encodeOscMessage("xremote")).toThrow(/must start with/);
  });

  it("rejects a string argument containing a null byte", () => {
    const args: OscArgument[] = [{ type: "s", value: "bad\u0000name" }];
    expect(() => encodeOscMessage("/ch/01/config/name", args)).toThrow(/null byte/);
  });

  it("rejects a non-finite numeric argument", () => {
    const args: OscArgument[] = [{ type: "f", value: Number.NaN }];
    expect(() => encodeOscMessage("/ch/01/mix/fader", args)).toThrow(/not finite/);
  });
});

describe("decodeOscMessage — malformed buffers never crash, always throw clearly", () => {
  it("rejects an empty buffer", () => {
    expect(() => decodeOscMessage(Buffer.alloc(0))).toThrow(/empty buffer/);
  });

  it("rejects a buffer whose length is not a multiple of 4", () => {
    expect(() => decodeOscMessage(Buffer.alloc(5))).toThrow(/not a multiple of 4/);
  });

  it("rejects an address with no null terminator", () => {
    const buffer = Buffer.from([0x41, 0x41, 0x41, 0x41]); // "AAAA", no null byte anywhere
    expect(() => decodeOscMessage(buffer)).toThrow(/not null-terminated/);
  });

  it("rejects a message with no room for a type tag", () => {
    // "/a" padded to 4 bytes, and nothing else.
    const buffer = oscString("/a", 4);
    expect(() => decodeOscMessage(buffer)).toThrow(/missing type tag/);
  });

  it("rejects a type tag that does not start with a comma", () => {
    const buffer = Buffer.concat([oscString("/a", 4), oscString("xi", 4)]);
    expect(() => decodeOscMessage(buffer)).toThrow(/does not start with ","/);
  });

  it("rejects an unsupported type tag character", () => {
    // "b" (blob) is a supported type; "T"/"F" (OSC 1.0 booleans) are not part
    // of this codec's subset, so use one of those as the unsupported case.
    const buffer = Buffer.concat([oscString("/a", 4), oscString(",T", 4)]);
    expect(() => decodeOscMessage(buffer)).toThrow(/unsupported type tag character "T"/);
  });

  it("rejects a truncated int32 argument", () => {
    // ",i" type tag with no following 4 bytes for the int.
    const buffer = Buffer.concat([oscString("/a", 4), oscString(",i", 4)]);
    expect(() => decodeOscMessage(buffer)).toThrow(/buffer too short for int32/);
  });

  it("rejects a truncated string argument (no null terminator)", () => {
    const buffer = Buffer.concat([
      oscString("/a", 4),
      oscString(",s", 4),
      Buffer.from([0x41, 0x41, 0x41, 0x41]), // "AAAA", never terminated
    ]);
    expect(() => decodeOscMessage(buffer)).toThrow(/not null-terminated/);
  });

  it("rejects trailing bytes after the last declared argument", () => {
    const withTrailingGarbage = Buffer.concat([
      fixture(oscString("/-stat/selidx", 16), oscString(",i", 4), [0x00, 0x00, 0x00, 0x0b]),
      Buffer.alloc(4), // unaccounted-for extra bytes
    ]);
    expect(() => decodeOscMessage(withTrailingGarbage)).toThrow(/trailing byte/);
  });

  it("rejects non-zero padding bytes after a string", () => {
    // "/a" (1 real char + null) padded to 4, but the padding byte is corrupt.
    const buffer = Buffer.from([0x2f, 0x61, 0x00, 0x41]);
    expect(() => decodeOscMessage(buffer)).toThrow(/non-zero padding byte/);
  });
});
