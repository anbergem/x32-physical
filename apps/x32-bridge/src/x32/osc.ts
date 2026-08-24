/**
 * Hand-rolled OSC 1.0 codec (docs/x32-protocol.md §OSC codec).
 *
 * Only the subset the bridge needs: one address, one type-tag string made of
 * `i`/`s`/`f`/`b` characters, and their arguments — everything 4-byte
 * aligned. No bundles, no other argument types. The doc explicitly prefers
 * this ~100-line codec over pulling in a general OSC dependency; this module
 * is it.
 *
 * `b` (blob) is used only for the `/meters/1` reply (docs/x32-protocol.md
 * §Meters): a plain OSC 1.0 blob — int32 **big-endian** byte count, then that
 * many bytes, then zero-padding to a 4-byte boundary. The blob's *contents*
 * (a meter-specific mini-format with a little-endian float count and
 * little-endian floats) are decoded separately in `./meters.ts` — this
 * module only knows the generic OSC blob envelope.
 *
 * Every OSC message — including a bare "read" request with zero arguments —
 * carries a type-tag string per OSC 1.0 (a zero-argument message's tag is
 * just `","`). That keeps encode/decode symmetric and matches the wire
 * format of the console's own replies, which is exactly what lets one
 * decoder handle both snapshot reads and live `/xremote` pushes
 * (docs/x32-protocol.md §Reading values).
 */

export type OscArgument =
  | { type: "i"; value: number }
  | { type: "f"; value: number }
  | { type: "s"; value: string }
  | { type: "b"; value: Buffer };

/** A blob's total wire footprint: 4-byte size prefix + data, padded to 4 bytes. */
function oscBlobByteLength(data: Buffer): number {
  return 4 + Math.ceil(data.length / 4) * 4;
}

export interface OscMessage {
  address: string;
  args: OscArgument[];
}

/** OSC strings are null-terminated and padded to a 4-byte boundary. */
function oscStringByteLength(text: string): number {
  return Math.ceil((text.length + 1) / 4) * 4;
}

/** Writes `text` as an OSC string at `offset`; returns its padded length. */
function writeOscString(buffer: Buffer, offset: number, text: string): number {
  const length = oscStringByteLength(text);
  // Latin-1, not ASCII: ASCII masks the high bit of any byte >= 0x80 (e.g.
  // 0xC3 -> 0x43), silently corrupting a non-ASCII channel name. OSC strings
  // are raw bytes; Latin-1 is a lossless 1:1 mapping for byte values 0-255.
  buffer.write(text, offset, "latin1");
  buffer.fill(0, offset + text.length, offset + length);
  return length;
}

/**
 * Reads one null-terminated, 4-byte-padded OSC string starting at `offset`.
 * `what` names the field being read (e.g. `"address"`) for error messages —
 * decoding must fail clearly, never crash, on a corrupt or truncated buffer.
 */
function readOscString(
  buffer: Buffer,
  offset: number,
  what: string,
): { value: string; next: number } {
  const terminator = buffer.indexOf(0, offset);
  if (terminator === -1) {
    throw new Error(
      `Malformed OSC message: ${what} starting at byte ${offset} is not null-terminated.`,
    );
  }

  const rawLength = terminator - offset;
  const paddedLength = Math.ceil((rawLength + 1) / 4) * 4;
  const end = offset + paddedLength;
  if (end > buffer.length) {
    throw new Error(
      `Malformed OSC message: ${what} starting at byte ${offset} runs past ` +
        `the end of the buffer (need ${paddedLength} bytes, ${buffer.length - offset} available).`,
    );
  }

  for (let i = terminator; i < end; i += 1) {
    if (buffer[i] !== 0) {
      throw new Error(
        `Malformed OSC message: non-zero padding byte at offset ${i} after ` +
          `${what} starting at byte ${offset}.`,
      );
    }
  }

  return { value: buffer.toString("latin1", offset, terminator), next: end };
}

/**
 * Encodes one OSC message. `args` defaults to `[]` — the wire form of an
 * address-only "read" request (docs/x32-protocol.md §Reading values).
 */
export function encodeOscMessage(address: string, args: OscArgument[] = []): Buffer {
  if (!address.startsWith("/")) {
    throw new Error(`Invalid OSC address "${address}": must start with "/".`);
  }
  if (address.includes("\u0000")) {
    throw new Error(`Invalid OSC address "${address}": must not contain a null byte.`);
  }

  const typeTag = "," + args.map((arg) => arg.type).join("");

  let argsByteLength = 0;
  for (const arg of args) {
    if (arg.type === "s") {
      if (arg.value.includes("\u0000")) {
        throw new Error(
          `Invalid OSC string argument for "${address}": must not contain a null byte.`,
        );
      }
      argsByteLength += oscStringByteLength(arg.value);
    } else if (arg.type === "b") {
      argsByteLength += oscBlobByteLength(arg.value);
    } else {
      if (!Number.isFinite(arg.value)) {
        throw new Error(
          `Invalid OSC ${arg.type} argument for "${address}": ${arg.value} is not finite.`,
        );
      }
      argsByteLength += 4;
    }
  }

  const addressBytes = oscStringByteLength(address);
  const typeTagBytes = oscStringByteLength(typeTag);
  const buffer = Buffer.alloc(addressBytes + typeTagBytes + argsByteLength);

  let offset = 0;
  offset += writeOscString(buffer, offset, address);
  offset += writeOscString(buffer, offset, typeTag);

  for (const arg of args) {
    if (arg.type === "i") {
      buffer.writeInt32BE(Math.trunc(arg.value), offset);
      offset += 4;
    } else if (arg.type === "f") {
      buffer.writeFloatBE(arg.value, offset);
      offset += 4;
    } else if (arg.type === "b") {
      const blobLength = oscBlobByteLength(arg.value);
      buffer.writeInt32BE(arg.value.length, offset);
      arg.value.copy(buffer, offset + 4);
      buffer.fill(0, offset + 4 + arg.value.length, offset + blobLength);
      offset += blobLength;
    } else {
      offset += writeOscString(buffer, offset, arg.value);
    }
  }

  return buffer;
}

/**
 * Decodes one OSC message. Throws a descriptive `Error` on any malformed
 * input — truncation, bad padding, an unsupported type character, trailing
 * garbage — rather than crashing; a single corrupt UDP datagram must not take
 * the bridge down (docs/x32-protocol.md: "UDP is lossy").
 */
export function decodeOscMessage(buffer: Buffer | Uint8Array): OscMessage {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (buf.length === 0) {
    throw new Error("Malformed OSC message: empty buffer.");
  }
  if (buf.length % 4 !== 0) {
    throw new Error(
      `Malformed OSC message: total length ${buf.length} is not a multiple of 4.`,
    );
  }

  const { value: address, next: afterAddress } = readOscString(buf, 0, "address");
  if (!address.startsWith("/")) {
    throw new Error(`Malformed OSC message: address "${address}" does not start with "/".`);
  }

  if (afterAddress >= buf.length) {
    throw new Error(`Malformed OSC message to "${address}": missing type tag string.`);
  }
  const { value: typeTag, next: afterTypeTag } = readOscString(
    buf,
    afterAddress,
    `type tag for "${address}"`,
  );
  if (!typeTag.startsWith(",")) {
    throw new Error(
      `Malformed OSC message to "${address}": type tag "${typeTag}" does not start with ",".`,
    );
  }

  const args: OscArgument[] = [];
  let offset = afterTypeTag;
  for (const typeChar of typeTag.slice(1)) {
    if (typeChar === "i") {
      if (offset + 4 > buf.length) {
        throw new Error(
          `Malformed OSC message to "${address}": buffer too short for int32 argument at byte ${offset}.`,
        );
      }
      args.push({ type: "i", value: buf.readInt32BE(offset) });
      offset += 4;
    } else if (typeChar === "f") {
      if (offset + 4 > buf.length) {
        throw new Error(
          `Malformed OSC message to "${address}": buffer too short for float32 argument at byte ${offset}.`,
        );
      }
      args.push({ type: "f", value: buf.readFloatBE(offset) });
      offset += 4;
    } else if (typeChar === "s") {
      const { value, next } = readOscString(buf, offset, `string argument for "${address}"`);
      args.push({ type: "s", value });
      offset = next;
    } else if (typeChar === "b") {
      if (offset + 4 > buf.length) {
        throw new Error(
          `Malformed OSC message to "${address}": buffer too short for blob size at byte ${offset}.`,
        );
      }
      const size = buf.readInt32BE(offset);
      if (size < 0) {
        throw new Error(
          `Malformed OSC message to "${address}": negative blob size ${size} at byte ${offset}.`,
        );
      }
      const dataStart = offset + 4;
      const paddedLength = Math.ceil(size / 4) * 4;
      const dataEnd = dataStart + paddedLength;
      if (dataEnd > buf.length) {
        throw new Error(
          `Malformed OSC message to "${address}": blob at byte ${offset} declares ${size} ` +
            `byte(s) but only ${buf.length - dataStart} are available.`,
        );
      }
      for (let i = dataStart + size; i < dataEnd; i += 1) {
        if (buf[i] !== 0) {
          throw new Error(
            `Malformed OSC message to "${address}": non-zero padding byte at offset ${i} ` +
              `after blob starting at byte ${offset}.`,
          );
        }
      }
      args.push({ type: "b", value: Buffer.from(buf.subarray(dataStart, dataStart + size)) });
      offset = dataEnd;
    } else {
      throw new Error(
        `Malformed OSC message to "${address}": unsupported type tag character "${typeChar}".`,
      );
    }
  }

  if (offset !== buf.length) {
    throw new Error(
      `Malformed OSC message to "${address}": ${buf.length - offset} trailing byte(s) after the last argument.`,
    );
  }

  return { address, args };
}
