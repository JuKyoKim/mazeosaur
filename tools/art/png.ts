// A PNG encoder and its inverse, because the art is generated and generated
// art has to be written to a file somewhere. Node's zlib does the
// compression; this adds the chunk framing. RGBA8 only, no interlacing, no
// ancillary chunks.
//
// Nothing in `tools/` ships in any bundle. It exists so a sprite is a
// reviewable diff of numbers rather than an opaque binary someone has to
// take on trust.
//
// The encoder is not byte-deterministic and cannot be made so cheaply:
// `deflateSync` is a call into whichever zlib the running Node was linked
// against, and two zlib builds emit different level-9 streams for the same
// scanlines. The pixels are deterministic. So the decoder here is not a
// convenience — it is the only way to compare two frames by the thing about
// them that is actually reproducible.

import { deflateSync, inflateSync } from "node:zlib";

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ (buf[i] as number)) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** `rgba` is width*height*4 bytes, straight (non-premultiplied) alpha. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  // Filter type 0 (none) per scanline. Flat colour art deflates fine
  // without the paeth filter and this keeps the encoder honest.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    // These bytes are a product of the linked zlib as well as of the pixels.
    // Two level-9 builds measurably disagree: Node 24.21.0 (chromium zlib
    // 1.3.2.1-motley-8002e91) emits 12879 IDAT bytes for
    // `fossil-pixel-effects.png` where libz 1.3.1 with the same deflate
    // parameters emits 12878, differing from byte 6, and both inflate to the
    // same raw buffer. Nothing may compare two frames through this call; use
    // `pngHasPixels`.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * The same thing with more than one frame: APNG.
 *
 * It exists for one reason. The decision in front of the owner is about
 * *animation*, and a still strip cannot answer whether a one-pixel breath
 * reads at a 19.5pt cell — the honest artifact for that question has to move.
 * APNG rather than GIF because the framing is the only new code: `acTL`
 * declares the frame count, each frame gets an `fcTL`, and every frame after
 * the first carries its pixels in `fdAT` instead of `IDAT`. No LZW encoder,
 * no palette quantisation, and the alpha stays 8-bit.
 *
 * Frame 0 is also the still PNG as far as any decoder that ignores the
 * animation chunks is concerned, which is what makes these safe to hand to a
 * viewer that does not know APNG: it shows the sprite at rest.
 *
 * `delays` is one duration in milliseconds per frame. Sequence numbers run
 * across `fcTL` and `fdAT` together, which is the one part of the spec that
 * is easy to get wrong and silently produces a file that shows frame 0 only.
 */
export function encodeApng(width: number, height: number, frames: readonly Uint8Array[], delays: readonly number[]): Buffer {
  if (!frames.length) throw new Error("encodeApng: no frames");
  if (frames.length !== delays.length) throw new Error(`encodeApng: ${frames.length} frames, ${delays.length} delays`);

  const stride = width * 4;
  const scanlines = (rgba: Uint8Array): Buffer => {
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    return raw;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4); // play forever

  let seq = 0;
  const fctl = (ms: number): Buffer => {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(seq++, 0);
    b.writeUInt32BE(width, 4);
    b.writeUInt32BE(height, 8);
    b.writeUInt32BE(0, 12); // x offset
    b.writeUInt32BE(0, 16); // y offset
    // Milliseconds as a /1000 fraction rather than the customary /100: the
    // attack frames are 90 and 110ms, which /100 cannot express.
    b.writeUInt16BE(Math.round(ms), 20);
    b.writeUInt16BE(1000, 22);
    b[24] = 1; // dispose: clear to transparent black before the next frame
    b[25] = 0; // blend: replace, not over — every frame here is full-size
    return b;
  };

  const out: Buffer[] = [SIGNATURE, chunk("IHDR", ihdr), chunk("acTL", actl)];
  frames.forEach((rgba, i) => {
    out.push(chunk("fcTL", fctl(delays[i] as number)));
    const data = deflateSync(scanlines(rgba), { level: 9 });
    if (i === 0) {
      out.push(chunk("IDAT", data));
    } else {
      const fdat = Buffer.alloc(4 + data.length);
      fdat.writeUInt32BE(seq++, 0);
      data.copy(fdat, 4);
      out.push(chunk("fdAT", fdat));
    }
  });
  out.push(chunk("IEND", new Uint8Array(0)));
  return Buffer.concat(out);
}

/** Raw filter types, PNG spec 9.2. `bpp` here is always 4: RGBA8. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export type DecodedPng = { width: number; height: number; rgba: Uint8Array };

/**
 * The inverse of `encodePng`, for any RGBA8 non-interlaced PNG — not only the
 * ones this file writes. All five scanline filters are undone, and every
 * chunk's CRC is checked, so a truncated or corrupt frame throws rather than
 * decoding to plausible-looking garbage. Deliberately a decoder for the
 * format and not a mirror of the encoder above: a decoder that only reversed
 * our own choices could not catch a bug in them.
 */
export function decodePng(png: Uint8Array): DecodedPng {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG: bad signature");

  let width = 0;
  let height = 0;
  let seenIhdr = false;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const end = p + 12 + len;
    if (end > buf.length) throw new Error(`truncated ${type} chunk`);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (crc32(buf.subarray(p + 4, p + 8 + len)) !== buf.readUInt32BE(p + 8 + len)) throw new Error(`bad CRC on ${type} chunk`);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, compression, filter, interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6) throw new Error(`unsupported PNG: bit depth ${depth}, colour type ${colour} (want 8/6)`);
      if (compression !== 0 || filter !== 0) throw new Error(`unsupported PNG: compression ${compression}, filter method ${filter}`);
      if (interlace !== 0) throw new Error("unsupported PNG: interlaced");
      seenIhdr = true;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    p = end;
  }
  if (!seenIhdr) throw new Error("PNG has no IHDR");
  if (!idat.length) throw new Error("PNG has no IDAT");

  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error(`PNG raw data is ${raw.length} bytes, want ${(stride + 1) * height}`);

  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)] as number;
    if (ft > 4) throw new Error(`unknown filter type ${ft} on scanline ${y}`);
    const src = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = cur - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? (rgba[cur + x - 4] as number) : 0;
      const b = y > 0 ? (rgba[prev + x] as number) : 0;
      const c = x >= 4 && y > 0 ? (rgba[prev + x - 4] as number) : 0;
      const v = raw[src + x] as number;
      rgba[cur + x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  return { width, height, rgba };
}

/**
 * Whether `png` holds exactly these pixels. This is the comparison the
 * committed frames are checked by, because it is the only one that is a
 * function of the art alone — see the note on the IDAT chunk above.
 *
 * Throws, via `decodePng`, when `png` is not a readable RGBA8 PNG. A caller
 * that is generating may treat that as "needs writing"; a caller that is
 * verifying must report it.
 */
export function pngHasPixels(png: Uint8Array, width: number, height: number, rgba: Uint8Array): boolean {
  const got = decodePng(png);
  if (got.width !== width || got.height !== height || got.rgba.length !== rgba.length) return false;
  for (let i = 0; i < rgba.length; i++) if (got.rgba[i] !== rgba[i]) return false;
  return true;
}
