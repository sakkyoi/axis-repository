/**
 * MD5 (RFC 1321).
 *
 * Nothing here relies on MD5 being collision-resistant. Debian uses it as a
 * lookup key — `Description-md5` names an entry in a `Translation-*` index —
 * and lists an `MD5Sum` section in `Release` for tools that predate SHA256.
 * Integrity is carried by the SHA256 and SHA512 sections and by the OpenPGP
 * signature over `Release`. WebCrypto does not offer MD5, hence this.
 */

const SHIFTS = new Int32Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

const SINE_CONSTANTS = new Int32Array(
  Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000)),
);

const textEncoder = new TextEncoder();

export function md5Hex(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const bitLength = bytes.byteLength * 8;
  // Pad to a whole number of 64-byte blocks, leaving room for the 0x80
  // terminator and the 8-byte length.
  const paddedLength = (((bytes.byteLength + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;

  const block = new Int32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let word = 0; word < 16; word += 1) {
      block[word] = view.getInt32(offset + word * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let step = 0; step < 64; step += 1) {
      let mixed: number;
      let wordIndex: number;
      if (step < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = step;
      } else if (step < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * step + 1) % 16;
      } else if (step < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * step + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * step) % 16;
      }

      const rotated = (mixed + a + word(SINE_CONSTANTS, step) + word(block, wordIndex)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(rotated, word(SHIFTS, step))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0].map(littleEndianHex).join("");
}

function word(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function littleEndianHex(value: number): string {
  let hex = "";
  for (let byte = 0; byte < 4; byte += 1) {
    hex += ((value >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}
