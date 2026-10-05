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
import { KIND_HUE, KINDS, type Direction, type Kind, type Palette } from "./directions.js";
import { Raster, fitShape, lighten, darken, scaleShape, union, type Rgb, type Shape } from "./raster.js";
import { KIND_STRIKE, STRIKE_FRAMES, STRIKE_SEQUENCE, type StrikeStep } from "./strikes.js";
import { fitFor, outlined, project, renderBoxes, type Box, type Fit } from "./voxel.js";

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

/**
 * Render parts authored in the 0..1 unit box into an n-by-n sprite.
 *
 * `d.inset` reserves room for the outline: see `fitShape`. It is 0 for every
 * direction authored at 36px and up, where the bestiary's own appendage
 * overhang is already wider than the ink.
 */
export function renderParts(parts: Part[], d: Direction, p: Palette, n: number): Raster {
  const fit = (s: Shape): Shape => fitShape(s, n, d.inset ?? 0);
  const solids = parts.filter((x) => !x.detail).map((x) => fit(x.shape));
  const out = new Raster(n, n);

  if (solids.length && d.outline > 0) {
    out.fill(union(...solids).expand(d.outline), p.ink, 1, d.samples);
  }

  const body = new Raster(n, n);
  for (const part of parts) {
    if (part.detail) continue;
    body.fill(fit(part.shape), toneColor(part.tone, p), 1, d.samples);
  }
  sculpt(body, d);
  out.blit(body, 0, 0);

  for (const part of parts) {
    if (!part.detail) continue;
    out.fill(fit(part.shape), toneColor(part.tone, p), 1, d.samples);
  }
  return out;
}

const FACES = { top: 1.1, front: 0.9, side: 0.7 };

/**
 * Render a block model in a direction's palette, with its ink outline.
 * `frames` is the raster's width in sprite frames, so a double-size frame
 * buys room rather than scale — see `fitFor`.
 */
function renderBlocks(model: Box[], d: Direction, p: Palette, n: number, frames = 1): Raster {
  const body = renderBoxes(model, n, (t) => p[t], d.faces ?? FACES, fitFor(model, BLOCK_SPAN, frames), d.samples);
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
  const frames = INVADER_FRAMES(archetype);
  const n = d.spritePx * frames;
  if (d.model === "blocks") return renderBlocks(ARCHETYPE_BLOCKS[archetype](), d, p, n, frames);
  const parts = ARCHETYPE_SILHOUETTE[archetype](d.proportions);
  return renderParts(parts, d, p, n);
}

/**
 * How many authored squares wide an archetype is drawn at. Only the boss is
 * bigger than one, and it is bigger *in the ink* — a 2x square holding a 2x
 * animal — which is why it needs no box multiplier anywhere downstream.
 */
export const INVADER_FRAMES = (archetype: Archetype): number => (archetype === "boss" ? 2 : 1);

// ------------------------------------------------------------------ strikes

/**
 * Where a strike frame's double square sits in the projected world: centred
 * on the projected centre of the dinosaur's own ground tile, at the
 * bestiary's world scale.
 *
 * Both halves are deliberate and neither comes from the model.
 *
 * `span` is `BLOCK_SPAN * STRIKE_FRAMES`, so one world unit is the same
 * number of pixels in a strike frame as in a dinosaur frame. A strike is
 * reach, not size: the double frame buys the room for a horn thrust that
 * leaves the cell, and the weapon stays the size the animal carrying it is.
 *
 * `cu`/`cv` are **fixed for every strike**, which is the opposite of what
 * `fitFor` does for an animal. An animal is centred in its own frame because
 * nothing downstream cares where inside the square it was drawn — `pack`
 * trims it away. A strike is the other case entirely: *where* it sits
 * relative to the cell is the whole content of the frame, because a club
 * swings out to one side and a dive comes down from above. Centring each
 * step on its own ink would delete the swing and leave three pictures of a
 * club in the middle of the cell.
 *
 * So the centre is `project(0.5, 0, 0.5)` — the middle of the unit tile the
 * dinosaur stands on, at ground level — and that is the point the client
 * puts on the cell centre with `setOrigin(0.5, 0.5)`. A box authored at
 * y = 0 is therefore on the floor of the cell, and x > 1 is past its forward
 * edge. Read off `project` rather than written as `(0, 0.5)` so a change of
 * camera moves the anchor with it.
 */
export function strikeFit(): Fit {
  const [cu, cv] = project(0.5, 0, 0.5);
  return { cu, cv, span: BLOCK_SPAN * STRIKE_FRAMES };
}

/**
 * One step of one kind's attack effect, in that kind's hue.
 *
 * Hue stays the channel it already is — the strike is drawn in the same
 * palette as the dinosaur throwing it — and shape is what this adds. See
 * `strikes.ts` for the six silhouettes and why they are those six.
 */
export function strikeSprite(kind: Kind, step: StrikeStep, d: Direction): Raster {
  const p = d.palette(KIND_HUE[kind]);
  const n = d.spritePx * STRIKE_FRAMES;
  const body = renderBoxes(KIND_STRIKE[kind](step), n, (t) => p[t], d.faces ?? FACES, strikeFit(), d.samples);
  return outlined(body, d.outline, p.ink);
}

/**
 * Every strike frame a direction ships, named as the client builds the name:
 * `strike-<kind>-<step>`.
 *
 * Empty for a direction that is not `blocks`. The strikes were authored for
 * the direction that shipped and they are block models; rendering them
 * through a flat direction's palette would put a solid in a picture that has
 * no solids in it. The other three directions are the record of how the
 * choice was made (section 5.5) and nothing in them is in an atlas, so the
 * honest answer for them is that they have no strikes rather than a
 * half-converted one.
 */
export function strikeEntries(d: Direction): { name: string; raster: Raster }[] {
  if (d.model !== "blocks") return [];
  return KINDS.flatMap((kind) => STRIKE_SEQUENCE.map((step) => ({ name: `strike-${kind}-${step}`, raster: strikeSprite(kind, step, d) })));
}

/**
 * The on-board box an archetype is drawn into, in cells.
 *
 * Two different things look like a size multiplier here and only one of them
 * is. The boss is drawn at two cells because its *sprite* is two authored
 * squares, so against an atlas it needs no multiplier at all — the 2x is
 * already in the pixels, and the scale that is right for every other frame is
 * right for it too. `swarm` is the real multiplier: authored at one square
 * like everything else and genuinely drawn smaller.
 *
 * So this is the board frame's rule, in terms of the authored square, and the
 * client's rule against the atlas is the same function divided by
 * `INVADER_FRAMES` — which is 1 everywhere except the boss. Section 5.5 of
 * `docs/01-art-hud-and-audio.md` states it as the client sees it.
 */
export const INVADER_BOX_CELLS = (archetype: Archetype): number =>
  archetype === "boss" ? 2 : archetype === "swarm" ? 0.8 : 1;

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
 * The bounds of what is actually drawn inside an authored square: the
 * smallest rect containing every pixel above the alpha floor.
 *
 * Section 5.0 anchors a dinosaur by its *feet*, and the camera centres its
 * subject in the authored square rather than standing it on the bottom edge.
 * The gap below the feet is therefore a function of growth stage — measured
 * on Toy Box, 18px under a hatchling raptor and 2px under an adult longneck,
 * out of 64. Anchoring the square instead of the ink would float the
 * hatchling half a cell above the floor of the cell it is standing in.
 *
 * Returns the whole square for an empty raster, which is not a case the
 * bestiary produces but is the only answer that cannot divide by zero.
 */
export function inkBox(r: Raster): { x: number; y: number; w: number; h: number } {
  let minX = r.w;
  let minY = r.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.get(x, y)[3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: r.w, h: r.h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Shelf-pack by descending height into a fixed-width sheet. Phaser's JSON
 * Hash format wants nothing cleverer, and a power-of-two width keeps the
 * texture upload cheap on the oldest GPUs we ship to.
 *
 * Every entry is trimmed to its ink first, so a packed frame *is* the
 * animal. That is what lets the client anchor with a plain
 * `setOrigin(0.5, 1)` — see `atlasJson`.
 *
 * `trim: false` keeps the whole authored square, and the strikes atlas is
 * the one set that needs it. Trimming answers "where is the animal" by
 * throwing away the answer to "where in the cell was this drawn", and for an
 * effect that is the only question: a tail club swings out to one side of
 * the cell and a dive comes down from above it. An untrimmed strike frame
 * carries its own geometry, so the client places it with
 * `setOrigin(0.5, 0.5)` on the cell centre and nothing has to be looked up.
 * The cost is transparent pixels, which is what PNG compresses best.
 */
export function pack(entries: { name: string; raster: Raster }[], width: number, pad = 1, trim = true): Atlas {
  const trimmed = entries.map((e) => {
    if (!trim) return { name: e.name, raster: e.raster };
    const box = inkBox(e.raster);
    const raster = new Raster(box.w, box.h);
    raster.blit(e.raster, -box.x, -box.y);
    return { name: e.name, raster };
  });
  const sorted = [...trimmed].sort((a, b) => b.raster.h - a.raster.h || a.name.localeCompare(b.name));
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

/**
 * Phaser's JSON Hash atlas format.
 *
 * The frames are pre-trimmed by `pack`, and this reports them as *untrimmed*
 * frames whose source size is the trimmed size. That is deliberate and it is
 * the whole reason the client's anchor is one line: Phaser resolves
 * `setOrigin` against `sourceSize`, so a frame that claims to have been
 * authored at its own ink size puts `setOrigin(0.5, 1)` exactly on the
 * animal's feet. Declaring `trimmed: true` and carrying the offset would be
 * the same pixels and would move the origin back off the feet.
 *
 * `authored` is the square the sprites were drawn at before trimming, and it
 * is the denominator of the draw scale, which the frame sizes can no longer
 * supply. With `meta.drawCells` and `meta.cell` it is everything the client
 * needs to place a dinosaur, and it is per-atlas rather than per-frame, so
 * section 5.5's "no lookup table" still holds.
 *
 * **It is the direction's `spritePx`, passed in, and must not be reduced out
 * of the frames.** The invaders atlas genuinely mixes two authored squares:
 * `invaderSprite` renders the `boss` archetype at `spritePx * 2`, so a
 * `Math.max` over the trimmed frames reports 128 for an atlas whose other 46
 * frames were drawn at 64, and a client reading it draws every non-boss
 * invader at half size. Before trimming, a frame's own `w` *was* its authored
 * square and the boss's 2x came for free; trimming destroyed the only
 * per-frame record of it, so the number has to come from the direction.
 *
 * One number is still right for the whole atlas, because the boss's 2x box
 * and its 2x authored square cancel: 36/64 and 72/128 are both 0.5625. That
 * is also why the client must give the boss *no* box multiplier against this
 * atlas, while `swarm` keeps its 0.8 — see section 5.5.
 */
export function atlasJson(atlas: Atlas, image: string, authored: number, cell: number, drawCells: number): string {
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
    {
      frames,
      meta: {
        app: "tools/art",
        image,
        format: "RGBA8888",
        size: { w: atlas.raster.w, h: atlas.raster.h },
        scale: "1",
        authored,
        cell,
        drawCells,
      },
    },
    null,
    2,
  )}\n`;
}
