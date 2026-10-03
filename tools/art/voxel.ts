// A block renderer: axis-aligned boxes, one fixed orthographic camera, three
// flat tones per box. This is what makes a direction look built rather than
// drawn, and it is the whole of the third dimension we take on — the board
// stays a square top-down grid and each creature is a little solid standing
// in its cell.
//
// Not shipped, not in the sim. Trig is fine here.
//
// Why boxes and not a mesh: a box has exactly three visible faces under a
// fixed camera, so "3D" costs one polygon fill per face and no depth buffer,
// no normals and no lighting model. The look that comes out the other side
// is the one the board asked for, and it survives being 20px tall because
// the three tones are flat and the edges are straight.

import { Raster, poly, rect, type Rgb, type Shape } from "./raster.js";

/** A box in unit world space. x right, y up, z toward the camera's left. */
export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Which palette slot the box takes. */
  tone: "base" | "dark" | "light" | "accent" | "ink" | "eye" | "glint";
}

export function box(x: number, y: number, z: number, w: number, h: number, d: number, tone: Box["tone"] = "base"): Box {
  return { x, y, z, w, h, d, tone };
}

// The camera. A true isometric pair — 30 degrees above the horizon, 45
// around — which is the projection voxel art is authored in and the reason
// a cube's three faces come out as three equal rhombi. Crossy Road's camera
// is a little steeper; 30 keeps more of the *side* of an animal visible,
// and the side is where a dinosaur's silhouette lives.
const COS = Math.cos(Math.PI / 6); // 0.8660
const SIN = Math.sin(Math.PI / 6); // 0.5

/** World to screen, in projected units. Screen y is down. */
export function project(x: number, y: number, z: number): [number, number] {
  return [(x - z) * COS, (x + z) * SIN - y];
}

/**
 * How the projected world maps into a sprite frame: the centre to put at
 * the frame's centre, and the span that fills it.
 *
 * The two halves are deliberately sourced differently.
 *
 * `span` is **shared** by every model — one scale for the whole bestiary —
 * because the relative sizes are content: a swarm invader is half-size and
 * a tank is twice as wide as tall, and normalising each model to fill its
 * own frame would delete exactly those tells.
 *
 * `cu`/`cv` are **per model**, so each sprite is centred in its own frame.
 * Sharing the centre as well was the mistake worth recording: the union of
 * the models is wider than any single one of them, because they sit at
 * different offsets in unit space, so a shared centre shrinks every sprite
 * by the *spread* of the set on top of its own size. Every animal came out
 * at about two thirds of the frame and read as a shrunken toy.
 */
export interface Fit {
  cu: number;
  cv: number;
  span: number;
}

/** Fraction of the frame the largest model fills, leaving room for the ink. */
const FILL = 0.88;

/** The shared scale: the largest single model, so nothing is clipped. */
export function sharedSpan(models: readonly (readonly Box[])[]): number {
  return Math.max(...models.map((m) => fitOf([m]).span));
}

/**
 * Centre on this model, size by the shared span.
 *
 * `frames` is how many sprite frames wide the model's raster is — 2 for the
 * boss, 1 for everything else. The shared span is multiplied by it so the
 * *world* scale comes out identical for every model: a double-size frame
 * then buys the boss twice the room rather than twice the drawing.
 *
 * Without it the boss was scaled as if its frame were normal, drew at 99.8%
 * of the raster, and had its 2px ink dilation clipped off the top and bottom
 * rows — the crown came out flat-topped. `FILL` leaves room for the ink, and
 * this is what makes that true for the one model that does not share the
 * frame size the span was measured against.
 */
export function fitFor(model: readonly Box[], span: number, frames = 1): Fit {
  const f = fitOf([model]);
  return { cu: f.cu, cv: f.cv, span: span * frames };
}

/** Measure the projected bounding box of a set of models. */
export function fitOf(models: readonly (readonly Box[])[]): Fit {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const m of models) {
    for (const b of m) {
      for (const dx of [0, b.w]) {
        for (const dy of [0, b.h]) {
          for (const dz of [0, b.d]) {
            const [u, v] = project(b.x + dx, b.y + dy, b.z + dz);
            u0 = Math.min(u0, u);
            u1 = Math.max(u1, u);
            v0 = Math.min(v0, v);
            v1 = Math.max(v1, v);
          }
        }
      }
    }
  }
  return { cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, span: Math.max(u1 - u0, v1 - v0) };
}

function place(n: number, f: Fit, px: number, py: number): [number, number] {
  const s = (n * FILL) / f.span;
  return [n / 2 + (px - f.cu) * s, n / 2 + (py - f.cv) * s];
}

function quad(n: number, f: Fit, pts: [number, number, number][]): Shape {
  return poly(
    pts.map(([x, y, z]) => {
      const [px, py] = project(x, y, z);
      return place(n, f, px, py);
    }),
  );
}

/**
 * Depth key for the painter's pass: larger is nearer the camera.
 *
 * All three axes weigh the same, because for this camera the view ray *is*
 * `(1,1,1)` — it is the kernel of the projection:
 *
 *     project(1, 1, 1) = ((1-1)·COS, (1+1)·SIN - 1) = (0, 0) = project(0, 0, 0)
 *
 * Height is therefore depth here, exactly as much as x and z are. Treating
 * y as a tiebreak instead sorts any box raised onto another *behind* it,
 * which paints the body over the shoulder plates standing on it — the tank
 * lost three of its four plates that way while its caption still promised
 * four.
 *
 * Still a heuristic: centroids, not a BSP. It is exact for boxes that do not
 * interpenetrate and close enough for the ones here that do.
 */
function depth(b: Box): number {
  return b.x + b.w / 2 + (b.y + b.h / 2) + (b.z + b.d / 2);
}

/**
 * Dilate the alpha of `src` by `k` pixels and paint it `ink` underneath.
 *
 * The outline is not authentic to the reference — Crossy Road has none, it
 * separates its subjects with a bright ground and a lot of empty space, and
 * this board has neither. Sixty invaders crossing a wall of dinosaurs need
 * the silhouette held by something, so the ink stays and is a knob rather
 * than a given.
 */
export function outlined(src: Raster, k: number, ink: Rgb): Raster {
  if (k <= 0) return src;
  const out = new Raster(src.w, src.h);
  const r = Math.ceil(k);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (src.get(x, y)[3] > 24) continue;
      let near = false;
      for (let dy = -r; dy <= r && !near; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > k * k + 0.5) continue;
          if (src.get(x + dx, y + dy)[3] > 24) {
            near = true;
            break;
          }
        }
      }
      if (near) out.fill(rect(x, y, 1, 1), ink, 1, 1);
    }
  }
  out.blit(src, 0, 0);
  return out;
}

export interface FaceTones {
  /** Multipliers applied to the box colour for the top, front and side face. */
  top: number;
  front: number;
  side: number;
}

function shade(c: Rgb, k: number): Rgb {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

/**
 * Render a model into an n-by-n sprite. `colour` maps a tone to an RGB, so
 * the same geometry can be painted in any direction's palette.
 *
 * Painter's algorithm on the box centroids: exact for boxes that do not
 * interpenetrate, approximate for the ones that do. Some do, deliberately —
 * `eye()` sinks into the head's face so it cannot z-fight with it, and the
 * shielded invader's bracket overlaps itself at the corner. Both are small
 * enough that the centroid order is still the right order; a new box that
 * sits deep inside another is the case this will get wrong.
 */
export function renderBoxes(model: readonly Box[], n: number, colour: (t: Box["tone"]) => Rgb, faces: FaceTones, f: Fit, samples = 2): Raster {
  const r = new Raster(n, n);
  for (const b of [...model].sort((p, q) => depth(p) - depth(q))) {
    const { x, y, z, w, h, d } = b;
    const c = colour(b.tone);
    // Front (+z) and side (+x) first, top last: the top edge of a box is the
    // one the eye uses to read its height, so it is drawn over its own walls.
    r.fill(
      quad(n, f, [
        [x, y, z + d],
        [x, y + h, z + d],
        [x + w, y + h, z + d],
        [x + w, y, z + d],
      ]),
      shade(c, faces.front),
      1,
      samples,
    );
    r.fill(
      quad(n, f, [
        [x + w, y, z],
        [x + w, y + h, z],
        [x + w, y + h, z + d],
        [x + w, y, z + d],
      ]),
      shade(c, faces.side),
      1,
      samples,
    );
    r.fill(
      quad(n, f, [
        [x, y + h, z],
        [x + w, y + h, z],
        [x + w, y + h, z + d],
        [x, y + h, z + d],
      ]),
      shade(c, faces.top),
      1,
      samples,
    );
  }
  return r;
}
