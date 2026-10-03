// A tiny software rasteriser. Shapes are implicit (a point-inside test and
// a bounding box) rather than scan-converted polygons, which makes
// "the same shape, 1px fatter" — the ink outline every direction needs —
// a one-line change instead of a polygon offset algorithm.
//
// Not shipped. Not in the sim. Math.cos is fine here.

export type Rgb = readonly [number, number, number];

export function rgb(hex: number): Rgb {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/** Mix two colours; t=0 is a, t=1 is b. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function lighten(c: Rgb, t: number): Rgb {
  return mix(c, [255, 255, 255], t);
}

export function darken(c: Rgb, t: number): Rgb {
  return mix(c, [0, 0, 0], t);
}

/** Relative luminance, WCAG 2.1. Used to check HUD contrast, not to look pretty. */
export function luminance(c: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ------------------------------------------------------------------ shapes

export interface Shape {
  /** x0, y0, x1, y1 — inclusive-exclusive, in sprite pixels. */
  readonly bbox: readonly [number, number, number, number];
  contains(x: number, y: number): boolean;
  /** The same shape grown by `k` pixels in every direction. */
  expand(k: number): Shape;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): Shape {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const ext = Math.max(rx, ry);
  return {
    bbox: [cx - ext, cy - ext, cx + ext, cy + ext],
    contains(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * c - dy * s) / rx;
      const v = (dx * s + dy * c) / ry;
      return u * u + v * v <= 1;
    },
    expand(k) {
      return ellipse(cx, cy, rx + k, ry + k, rot);
    },
  };
}

/**
 * A segment with a radius at each end: necks, tails, legs, horns. A cone
 * capsule, so `expand` is just "both radii bigger".
 */
export function taper(x1: number, y1: number, x2: number, y2: number, r1: number, r2 = r1): Shape {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const rmax = Math.max(r1, r2);
  return {
    bbox: [Math.min(x1, x2) - rmax, Math.min(y1, y2) - rmax, Math.max(x1, x2) + rmax, Math.max(y1, y2) + rmax],
    contains(x, y) {
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const r = r1 + (r2 - r1) * t;
      const ex = x - px;
      const ey = y - py;
      return ex * ex + ey * ey <= r * r;
    },
    expand(k) {
      return taper(x1, y1, x2, y2, r1 + k, r2 + k);
    },
  };
}

export function poly(pts: readonly (readonly [number, number])[]): Shape {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    cx += x / pts.length;
    cy += y / pts.length;
  }
  return {
    bbox: [x0, y0, x1, y1],
    contains(x, y) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i] as readonly [number, number];
        const [xj, yj] = pts[j] as readonly [number, number];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    expand(k) {
      // Push every vertex away from the centroid by k. Exact for a circle,
      // close enough for the convex horns and crests we use it for.
      return poly(
        pts.map(([x, y]) => {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy) || 1;
          return [x + (dx / d) * k, y + (dy / d) * k] as const;
        }),
      );
    },
  };
}

export function rect(x: number, y: number, w: number, h: number): Shape {
  return {
    bbox: [x, y, x + w, y + h],
    contains(px, py) {
      return px >= x && px < x + w && py >= y && py < y + h;
    },
    expand(k) {
      return rect(x - k, y - k, w + 2 * k, h + 2 * k);
    },
  };
}

/**
 * Reinterpret a shape authored in a 0..1 unit box as pixels on an n-wide
 * surface. Silhouettes are written once in unit space and rasterised at
 * 24px for the pixel direction and 48px for the vector ones.
 */
export function scaleShape(s: Shape, n: number): Shape {
  return {
    bbox: [s.bbox[0] * n, s.bbox[1] * n, s.bbox[2] * n, s.bbox[3] * n],
    contains(x, y) {
      return s.contains(x / n, y / n);
    },
    expand(k) {
      return scaleShape(s.expand(k / n), n);
    },
  };
}

export function union(...parts: Shape[]): Shape {
  const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    bb[0] = Math.min(bb[0], p.bbox[0]);
    bb[1] = Math.min(bb[1], p.bbox[1]);
    bb[2] = Math.max(bb[2], p.bbox[2]);
    bb[3] = Math.max(bb[3], p.bbox[3]);
  }
  return {
    bbox: bb,
    contains(x, y) {
      return parts.some((p) => p.contains(x, y));
    },
    expand(k) {
      return union(...parts.map((p) => p.expand(k)));
    },
  };
}

/** `a` minus `b`. Used for the frill notch and the open jaw. */
export function subtract(a: Shape, b: Shape): Shape {
  return {
    bbox: a.bbox,
    contains(x, y) {
      return a.contains(x, y) && !b.contains(x, y);
    },
    expand(k) {
      return subtract(a.expand(k), b);
    },
  };
}

// ------------------------------------------------------------------ raster

/** An RGBA surface with straight alpha, 0..255 per channel. */
export class Raster {
  readonly px: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h * 4);
  }

  clear(c: Rgb, a = 1): void {
    for (let i = 0; i < this.w * this.h; i++) {
      this.px[i * 4] = c[0];
      this.px[i * 4 + 1] = c[1];
      this.px[i * 4 + 2] = c[2];
      this.px[i * 4 + 3] = Math.round(a * 255);
    }
  }

  /**
   * Source-over a single pixel. The coordinates are floored: a caller that
   * centres a sprite on an odd box lands on a half pixel, and a fractional
   * index into the Uint8Array reads undefined and writes nowhere, so the
   * whole blit disappears without an error. Flooring here rather than at
   * every call site is the only version of this that stays fixed.
   */
  blend(xf: number, yf: number, c: Rgb, a: number): void {
    const x = Math.floor(xf);
    const y = Math.floor(yf);
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const da = (this.px[i + 3] as number) / 255;
    const out = a + da * (1 - a);
    if (out <= 0) return;
    for (let k = 0; k < 3; k++) {
      const d = this.px[i + k] as number;
      this.px[i + k] = Math.round((c[k] * a + d * da * (1 - a)) / out);
    }
    this.px[i + 3] = Math.round(out * 255);
  }

  get(xf: number, yf: number): [number, number, number, number] {
    const x = Math.floor(xf);
    const y = Math.floor(yf);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.px[i] as number, this.px[i + 1] as number, this.px[i + 2] as number, this.px[i + 3] as number];
  }

  /**
   * Fill a shape. `samples` is the sub-pixel grid per axis: 1 gives the hard
   * edges pixel art wants, 3 gives the nine coverage levels vector art wants.
   */
  fill(s: Shape, c: Rgb, alpha = 1, samples = 3): void {
    const [bx0, by0, bx1, by1] = s.bbox;
    const x0 = Math.max(0, Math.floor(bx0));
    const y0 = Math.max(0, Math.floor(by0));
    const x1 = Math.min(this.w - 1, Math.ceil(bx1));
    const y1 = Math.min(this.h - 1, Math.ceil(by1));
    const step = 1 / samples;
    const total = samples * samples;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let hit = 0;
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            if (s.contains(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hit++;
          }
        }
        if (hit) this.blend(x, y, c, (alpha * hit) / total);
      }
    }
  }

  /** A 1px-per-sample line, for HUD rules and effect strokes. */
  line(x1: number, y1: number, x2: number, y2: number, c: Rgb, width: number, alpha = 1, samples = 3): void {
    this.fill(taper(x1, y1, x2, y2, width / 2), c, alpha, samples);
  }

  /** Nearest-neighbour blit at an integer scale. */
  blit(src: Raster, dx: number, dy: number, scale = 1): void {
    for (let y = 0; y < src.h * scale; y++) {
      for (let x = 0; x < src.w * scale; x++) {
        const [r, g, b, a] = src.get(Math.floor(x / scale), Math.floor(y / scale));
        if (a) this.blend(dx + x, dy + y, [r, g, b], a / 255);
      }
    }
  }

  /** Box-downsample by an integer factor: the honest "how does it look small" test. */
  downsample(factor: number): Raster {
    const out = new Raster(Math.floor(this.w / factor), Math.floor(this.h / factor));
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < factor; sy++) {
          for (let sx = 0; sx < factor; sx++) {
            const [pr, pg, pb, pa] = this.get(x * factor + sx, y * factor + sy);
            const w = pa / 255;
            r += pr * w;
            g += pg * w;
            b += pb * w;
            a += w;
          }
        }
        const i = (y * out.w + x) * 4;
        if (a > 0) {
          out.px[i] = Math.round(r / a);
          out.px[i + 1] = Math.round(g / a);
          out.px[i + 2] = Math.round(b / a);
        }
        out.px[i + 3] = Math.round((a / (factor * factor)) * 255);
      }
    }
    return out;
  }
}
