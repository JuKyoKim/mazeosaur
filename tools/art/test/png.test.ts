// The committed frames in `docs/art/` are guarded by pixel equality rather
// than byte equality, because `encodePng` compresses through whichever zlib
// the running Node links and two builds disagree. That makes `decodePng` and
// `pngHasPixels` load-bearing: if the decoder were wrong in the direction of
// "everything matches", the guard would pass silently forever.
//
// So these tests do two jobs. They prove the decoder is a decoder for the
// format and not a mirror of our own encoder — every filter type, a real CRC
// check — and they pin the property the guard depends on: same pixels,
// different compression, still equal.

import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, pngHasPixels } from "../png.js";

/** A deterministic image with every channel varying, so a mixed-up channel shows. */
function pixels(w: number, h: number, salt = 0): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 7 + salt) & 0xff;
      px[i + 1] = (y * 13 + salt) & 0xff;
      px[i + 2] = (x * y + salt) & 0xff;
      px[i + 3] = (200 + x + y) & 0xff;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * An independent encoder: every scanline written with the given filter type,
 * at the given deflate level. `encodePng` only ever emits filter 0 at level
 * 9, so this is what lets the tests exercise the other four filters and a
 * second compression setting.
 */
function encodeWith(w: number, h: number, rgba: Uint8Array, filter: 0 | 1 | 2 | 3 | 4, level: number): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x] as number;
      const a = x >= 4 ? (rgba[y * stride + x - 4] as number) : 0;
      const b = y > 0 ? (rgba[(y - 1) * stride + x] as number) : 0;
      const c = x >= 4 && y > 0 ? (rgba[(y - 1) * stride + x - 4] as number) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

describe("decodePng", () => {
  it("round-trips what encodePng writes", () => {
    const px = pixels(37, 19);
    const got = decodePng(encodePng(37, 19, px));
    expect([got.width, got.height]).toEqual([37, 19]);
    expect(Buffer.from(got.rgba)).toEqual(Buffer.from(px));
  });

  it("undoes every scanline filter", () => {
    const px = pixels(23, 11);
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const got = decodePng(encodeWith(23, 11, px, filter, 6));
      expect(Buffer.from(got.rgba), `filter ${filter}`).toEqual(Buffer.from(px));
    }
  });

  it("joins a stream split across several IDAT chunks", () => {
    // zlib's own stream encoder emits a chunk per write, so a PNG from any
    // other tool is likely to arrive this way.
    const px = pixels(16, 8);
    const one = encodePng(16, 8, px);
    const idatAt = one.indexOf("IDAT", 0, "ascii");
    const len = one.readUInt32BE(idatAt - 4);
    const body = one.subarray(idatAt + 4, idatAt + 4 + len);
    const split = Buffer.concat([
      one.subarray(0, idatAt - 4),
      chunk("IDAT", body.subarray(0, 5)),
      chunk("IDAT", body.subarray(5)),
      one.subarray(idatAt + 4 + len + 4),
    ]);
    expect(split.length).not.toBe(one.length);
    expect(Buffer.from(decodePng(split).rgba)).toEqual(Buffer.from(px));
  });

  it("refuses a file that is not a readable RGBA8 PNG", () => {
    const px = pixels(8, 8);
    expect(() => decodePng(Buffer.from("not a png at all"))).toThrow(/signature/);

    const corrupt = Buffer.from(encodePng(8, 8, px));
    const flip = corrupt.length - 20; // inside IDAT, so the chunk CRC no longer holds
    corrupt[flip] = (corrupt[flip] as number) ^ 0xff;
    expect(() => decodePng(corrupt)).toThrow(/CRC/);

    const truncated = Buffer.from(encodePng(8, 8, px)).subarray(0, 40);
    expect(() => decodePng(truncated)).toThrow();

    const greyscale = Buffer.from(encodePng(8, 8, px));
    const ihdr = greyscale.indexOf("IHDR", 0, "ascii");
    greyscale[ihdr + 4 + 9] = 0; // colour type 0
    greyscale.writeUInt32BE(crc32(greyscale.subarray(ihdr, ihdr + 4 + 13)), ihdr + 4 + 13);
    expect(() => decodePng(greyscale)).toThrow(/colour type/);
  });
});

describe("pngHasPixels", () => {
  it("ignores the compression and sees only the pixels", () => {
    // This is the property the frames guard rests on. Two encodings of the
    // same image that differ in bytes — as two zlib builds do — must still
    // compare equal, and the bytes must really differ or the test is vacuous.
    const px = pixels(64, 48);
    const nine = encodePng(64, 48, px);
    const cheap = encodeWith(64, 48, px, 4, 1);
    expect(Buffer.from(cheap).equals(nine)).toBe(false);
    expect(pngHasPixels(nine, 64, 48, px)).toBe(true);
    expect(pngHasPixels(cheap, 64, 48, px)).toBe(true);
  });

  it("sees a single changed pixel", () => {
    const px = pixels(32, 32);
    const png = encodePng(32, 32, px);
    const nudged = pixels(32, 32);
    const one = (17 * 32 + 9) * 4 + 1;
    nudged[one] = (nudged[one] as number) ^ 1;
    expect(pngHasPixels(png, 32, 32, nudged)).toBe(false);
  });

  it("sees a change of size, even when the pixels would match a prefix", () => {
    const png = encodePng(16, 16, pixels(16, 16));
    expect(pngHasPixels(png, 16, 8, pixels(16, 8))).toBe(false);
    expect(pngHasPixels(png, 8, 16, pixels(8, 16))).toBe(false);
  });
});
