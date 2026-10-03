// Turning a silhouette plus a direction into a sprite. Four passes, in this
// order, because the order is the whole look:
//
//   1. ink      the union of every solid part, grown by the outline weight
//   2. body     each part in its tone, flat
//   3. sculpt   darken toward the belly, rim-light the top edge
//   4. detail   eyes, claws, teeth, plates — on top, never sculpted
//
// Sculpting the body but not the detail is what keeps a 24px eye from
// turning to mud, and growing the ink from the *union* rather than per part
// is what stops a leg reading as a separate animal.

import { ARCHETYPE_SILHOUETTE, KIND_SILHOUETTE, type Archetype, type Part } from "./bestiary.js";
import { ARCHETYPE_BLOCKS, BLOCK_SPAN, KIND_BLOCKS } from "./blocks.js";
import { KIND_HUE, type Direction, type Kind, type Palette } from "./directions.js";
import { Raster, lighten, darken, scaleShape, union, type Rgb } from "./raster.js";
import { fitFor, outlined, renderBoxes, type Box } from "./voxel.js";

function toneColor(tone: Part["tone"], p: Palette): Rgb {
  return p[tone];
}

/**
 * Darken toward the bottom of each column and rim-light the top edge. The
 * pixel direction bands the result into four steps; the vector ones leave
 * it smooth. Operates on a body-only raster so the ink stays flat.
 */
function sculpt(r: Raster, d: Direction): void {
  const bands = d.samples === 1 ? 4 : 0;
  for (let x = 0; x < r.w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < r.h; y++) {
      if (r.get(x, y)[3] > 8) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0 || bottom <= top) continue;
    const span = bottom - top;
    for (let y = top; y <= bottom; y++) {
      const px = r.get(x, y);
      if (px[3] <= 8) continue;
      let t = (y - top) / span;
      if (bands) t = Math.floor(t * bands) / (bands - 1 || 1);
      const depth = Math.min(1, t) * d.shade;
      const up = y - top;
      const rimAmount = up < d.rim ? 0.26 * (1 - up / d.rim) : 0;
      let c: Rgb = [px[0], px[1], px[2]];
      if (depth > 0) c = darken(c, depth);
      if (rimAmount > 0) c = lighten(c, rimAmount);
      const i = (y * r.w + x) * 4;
      r.px[i] = Math.round(c[0]);
      r.px[i + 1] = Math.round(c[1]);
      r.px[i + 2] = Math.round(c[2]);
    }
  }
}

/** Render parts authored in the 0..1 unit box into an n-by-n sprite. */
export function renderParts(parts: Part[], d: Direction, p: Palette, n: number): Raster {
  const solids = parts.filter((x) => !x.detail).map((x) => scaleShape(x.shape, n));
  const out = new Raster(n, n);

  if (solids.length && d.outline > 0) {
    out.fill(union(...solids).expand(d.outline), p.ink, 1, d.samples);
  }

  const body = new Raster(n, n);
  for (const part of parts) {
    if (part.detail) continue;
    body.fill(scaleShape(part.shape, n), toneColor(part.tone, p), 1, d.samples);
  }
  sculpt(body, d);
  out.blit(body, 0, 0);

  for (const part of parts) {
    if (!part.detail) continue;
    out.fill(scaleShape(part.shape, n), toneColor(part.tone, p), 1, d.samples);
  }
  return out;
}

const FACES = { top: 1.1, front: 0.9, side: 0.7 };

/** Render a block model in a direction's palette, with its ink outline. */
function renderBlocks(model: Box[], d: Direction, p: Palette, n: number): Raster {
  const body = renderBoxes(model, n, (t) => p[t], d.faces ?? FACES, fitFor(model, BLOCK_SPAN), d.samples);
  return outlined(body, d.outline, p.ink);
}

export function dinoSprite(kind: Kind, stage: 1 | 2 | 3, d: Direction): Raster {
  const p = d.palette(KIND_HUE[kind]);
  if (d.model === "blocks") return renderBlocks(KIND_BLOCKS[kind](stage), d, p, d.spritePx);
  const parts = KIND_SILHOUETTE[kind](stage, d.proportions);
  return renderParts(parts, d, p, d.spritePx);
}

/**
 * Invaders are rendered at the same authored size as dinosaurs and scaled
 * down by the frame, so one atlas cell size covers everything and a swarm
 * invader is small because its silhouette is small, not because the sprite
 * is.
 */
export function invaderSprite(archetype: Archetype, kind: Kind, d: Direction): Raster {
  const p = d.palette(KIND_HUE[kind]);
  const n = archetype === "boss" ? d.spritePx * 2 : d.spritePx;
  if (d.model === "blocks") return renderBlocks(ARCHETYPE_BLOCKS[archetype](), d, p, n);
  const parts = ARCHETYPE_SILHOUETTE[archetype](d.proportions);
  return renderParts(parts, d, p, n);
}

// ------------------------------------------------------------------- atlas

export interface AtlasFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  raster: Raster;
  frames: AtlasFrame[];
}

/**
 * Shelf-pack by descending height into a fixed-width sheet. Phaser's JSON
 * Hash format wants nothing cleverer, and a power-of-two width keeps the
 * texture upload cheap on the oldest GPUs we ship to.
 */
export function pack(entries: { name: string; raster: Raster }[], width: number, pad = 1): Atlas {
  const sorted = [...entries].sort((a, b) => b.raster.h - a.raster.h || a.name.localeCompare(b.name));
  const frames: AtlasFrame[] = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const e of sorted) {
    if (x + e.raster.w + pad > width) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    frames.push({ name: e.name, x, y, w: e.raster.w, h: e.raster.h });
    x += e.raster.w + pad;
    rowH = Math.max(rowH, e.raster.h);
  }
  const height = y + rowH + pad;
  const raster = new Raster(width, height);
  for (const f of frames) {
    const e = sorted.find((s) => s.name === f.name);
    if (e) raster.blit(e.raster, f.x, f.y);
  }
  frames.sort((a, b) => a.name.localeCompare(b.name));
  return { raster, frames };
}

/** Phaser's JSON Hash atlas format. */
export function atlasJson(atlas: Atlas, image: string): string {
  const frames: Record<string, unknown> = {};
  for (const f of atlas.frames) {
    frames[f.name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      sourceSize: { w: f.w, h: f.h },
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
    };
  }
  return `${JSON.stringify(
    { frames, meta: { app: "tools/art", image, format: "RGBA8888", size: { w: atlas.raster.w, h: atlas.raster.h }, scale: "1" } },
    null,
    2,
  )}\n`;
}
