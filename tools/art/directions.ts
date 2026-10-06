// The three art directions the board is being asked to choose between, as
// values rather than adjectives. Each one is the same silhouettes from
// bestiary.ts rendered through different numbers: authored resolution,
// edge sampling, outline weight, shading depth, and the four proportion
// knobs that turn cute-round into fierce-realistic.
//
// The point of writing them this way is that choosing a direction does not
// mean redrawing anything. It means keeping one of these records.

import { type Proportions } from "./bestiary.js";
import { contrastRatio, darken, lighten, mix, rgb, type Rgb } from "./raster.js";

export type Kind = "raptor" | "tyrant" | "armored" | "horned" | "longneck" | "flier";

export const KINDS: readonly Kind[] = ["raptor", "tyrant", "armored", "horned", "longneck", "flier"];

/**
 * The kind hues, and a proposed revision of KIND_COLOR in
 * packages/game/src/theme.ts. Six families need six colours that are still
 * six colours in a 20pt cell and to the ~8% of men who cannot separate red
 * from green, so these were not picked by eye: `art:check` measures every
 * one of the 60 pairs (six kinds, four kinds of vision) and requires each
 * pair to be separated either by hue distance or by lightness. The values
 * below are the result of a constrained search that kept every kind inside
 * its own hue family and above a visibility floor against the board
 * background, and they clear the thresholds with 23% to spare.
 *
 * What changed from M2 and why:
 *   raptor    e0a83a -> f4a82a  brighter, to sit a clear step above longneck
 *   tyrant    c0392b -> bd2b1d  less orange, so it is red and not amber
 *   armored   95a5a6 -> dbe4e6  much lighter; it was lost on the board
 *   horned    8e44ad -> 8a44c4  more blue, to clear tyrant under protanopia
 *   longneck  27ae60 -> 52a87e  lighter and cooler, the biggest single change
 *   flier     3498db -> 3ab1ea  brighter, to clear armored under deuteranopia
 *
 * longneck and flier end up adjacent in hue (151 and 199). That is allowed
 * because they are the two most different silhouettes on the board — the
 * only tall one and the only wide one — and because the measured pair
 * distance passes. Colour is the second channel for those two, not the
 * first.
 */
export const KIND_HUE: Record<Kind, number> = {
  raptor: 0xf4a82a,
  tyrant: 0xbd2b1d,
  armored: 0xdbe4e6,
  horned: 0x8a44c4,
  longneck: 0x52a87e,
  flier: 0x3ab1ea,
};

/** The board and HUD colours a frame needs, from theme.ts where they exist. */
export const BOARD = {
  bg: rgb(0x16211a),
  boardBg: rgb(0x213127),
  gridLine: rgb(0x2c4033),
  spawn: rgb(0xd35400),
  checkpoint: rgb(0xf1c40f),
  nest: rgb(0xecf0f1),
  rock: rgb(0x4a4a4a),
  hud: rgb(0x0f1712),
  hudPanel: rgb(0x1c2a21),
  text: rgb(0xecf0f1),
  textDim: rgb(0x95a5a6),
  meat: rgb(0xe67e22),
  eggs: rgb(0xf5f6fa),
  refusal: rgb(0xe74c3c),
  // `COLORS.ink` in packages/game/src/theme.ts, and flat on purpose. Every
  // Direction's palette has an `ink` too, but that one is a dark tint of a
  // *kind hue* — it is the outline around an animal. This is the board's
  // ink: the mark laid over a cell whose colour the mark does not control.
  // §4 is explicit that the value has to be fixed ("a fixed dark that the
  // cell underneath cannot climb to"), so the refusal hatching cannot take
  // a per-direction value without losing the property it was chosen for.
  ink: rgb(0x111111),
  button: rgb(0x2e4a38),
  // M2's 3f7a55 put #ecf0f1 at 4.44:1 — just under AA. Darkened until it
  // clears 4.5 with margin; the Send button is the one control a player
  // reads under time pressure, so it is not the place to be borderline.
  buttonActive: rgb(0x37694b),
  buttonDanger: rgb(0x7a3f3f),
  hpBack: rgb(0x2c3e50),
  hpFront: rgb(0x2ecc71),
  hpLow: rgb(0xe74c3c),
  slow: rgb(0x74b9ff),
  stun: rgb(0xf1c40f),
  shield: rgb(0xecf0f1),
} as const;

/** The seven slots every silhouette part can ask for. */
export interface Palette {
  base: Rgb;
  dark: Rgb;
  light: Rgb;
  accent: Rgb;
  ink: Rgb;
  eye: Rgb;
  glint: Rgb;
}

export interface Direction {
  id: string;
  /** What it is called in the memo and in the decision log. */
  name: string;
  /** Where it sits on the proposal's two axes. */
  axes: { render: "pixel" | "vector" | "blocks"; register: "cute-round" | "fierce-realistic" };
  /** Authored sprite size in pixels, square. The 36px cell draws it scaled. */
  spritePx: number;
  /** Sub-pixel samples per axis when filling: 1 is a hard pixel edge. */
  samples: number;
  /** Ink outline weight in authored pixels. */
  outline: number;
  /**
   * Pixels of air reserved inside the authored square, so the outline has
   * somewhere to go — see `fitShape`. 0 for every direction authored at 36px
   * and up, where the bestiary's appendage overhang is already wider than the
   * ink; a low-resolution direction needs it, because clipping at 15px costs
   * a seventh of the animal.
   */
  inset?: number;
  /** How far the bottom of a body darkens, 0..1. */
  shade: number;
  /** How many authored pixels of top-edge rim light. */
  rim: number;
  proportions: Proportions;
  /**
   * How a sprite is built. `shapes` rasterises the 2D silhouettes in
   * bestiary.ts; `blocks` renders the voxel models in blocks.ts under a
   * fixed isometric camera. The kind chart is the same either way — only
   * the body it is drawn in changes.
   */
  model?: "shapes" | "blocks";
  /** Face brightness for a `blocks` direction: top, front, side. */
  faces?: { top: number; front: number; side: number };
  /** One line for the memo: what the player sees. */
  pitch: string;
  palette(hue: number): Palette;
}

/**
 * Pixel art, fierce register. Authored at 36px, which is exactly the cell
 * on the logical canvas, so one art pixel is one canvas pixel and nothing
 * is resampled before the canvas itself is scaled to the device.
 *
 * Being straight about the limit: true pixel-perfect rendering would need
 * the canvas-to-device scale to be a whole number, and FIT scaling onto
 * arbitrary phone widths (0.5417 on the reference phone) cannot promise
 * that. This is pixel-art *style* — hard edges, a limited palette, banded
 * shading — resampled once by the display. It reads well; it will not
 * satisfy someone who wants visible square pixels of a uniform size.
 */
const fossilPixel: Direction = {
  id: "fossil-pixel",
  name: "Fossil Pixel",
  axes: { render: "pixel", register: "fierce-realistic" },
  spritePx: 36,
  samples: 1,
  outline: 1,
  shade: 0.3,
  rim: 2,
  proportions: { head: 1.0, eye: 0.3, spike: 1.0, round: 0.15 },
  pitch: "Hard-edged 24px sprites, three tones and one ink pixel. Smallest atlas, sharpest silhouette, reads at arm's length because it has to.",
  palette(hue) {
    const base = rgb(hue);
    return {
      base,
      // Flat steps rather than a ramp: pixel art shades by banding.
      dark: darken(base, 0.34),
      light: lighten(base, 0.3),
      accent: mix(lighten(base, 0.46), [255, 232, 180], 0.35),
      // Not black. A very dark tint of the kind hue keeps the outline from
      // eating the colour when sixty of them are on the board at once.
      ink: darken(mix(base, [20, 16, 14], 0.72), 0.25),
      eye: rgb(0x14100e),
      glint: rgb(0xf6f3ea),
    };
  },
};

/**
 * Hand-drawn vector, cute-round. Big heads, big eyes, fat limbs, blunt
 * snouts, a heavy 2px ink line like a sticker. Authored at 48px and
 * downsampled by the renderer, so it stays smooth on a retina phone.
 */
const clayPack: Direction = {
  id: "clay-pack",
  name: "Clay Pack",
  axes: { render: "vector", register: "cute-round" },
  spritePx: 48,
  samples: 3,
  outline: 2,
  shade: 0.2,
  rim: 4,
  proportions: { head: 1.38, eye: 0.44, spike: 0.72, round: 1.0 },
  pitch: "Sticker-weight ink line, heads a third too big, eyes you can see at 24px. The friendliest read and the easiest to animate.",
  palette(hue) {
    const base = lighten(rgb(hue), 0.14);
    return {
      base,
      dark: darken(base, 0.24),
      light: lighten(base, 0.34),
      accent: mix(lighten(base, 0.3), [255, 240, 210], 0.45),
      ink: darken(mix(base, [34, 26, 30], 0.78), 0.3),
      eye: rgb(0x1b1618),
      glint: rgb(0xffffff),
    };
  },
};

/**
 * Hand-drawn vector, fierce-realistic. The authored proportions untouched,
 * a thin ink line, deeper shading and a cold rim light. Longer snouts,
 * longer horns, a small eye high on the skull.
 */
const valleyNaturalist: Direction = {
  id: "valley-naturalist",
  name: "Valley Naturalist",
  axes: { render: "vector", register: "fierce-realistic" },
  spritePx: 48,
  samples: 3,
  outline: 1,
  shade: 0.42,
  rim: 3,
  proportions: { head: 1.0, eye: 0.2, spike: 1.18, round: 0.0 },
  pitch: "Skeletal proportions, a hairline ink edge, deep shadow under the body and a cold rim light. Reads as an animal, not a mascot.",
  palette(hue) {
    const base = mix(rgb(hue), [96, 92, 74], 0.22);
    return {
      base,
      dark: darken(base, 0.46),
      light: lighten(base, 0.26),
      // A bone/keratin accent rather than a brighter body colour: horns,
      // claws, plates and crests are a different material.
      accent: mix(lighten(base, 0.3), [232, 221, 190], 0.6),
      ink: darken(mix(base, [18, 18, 16], 0.84), 0.3),
      eye: rgb(0x100e0c),
      glint: rgb(0xe9e4d4),
    };
  },
};

/**
 * Blocks, cute-round. The board's own brief after it rejected all three
 * flat directions: "more 3d, steer away from 2d, something similar to how
 * Crossy Road assets look in that block style."
 *
 * Each animal is six to fourteen axis-aligned boxes rendered under one
 * fixed isometric camera, three flat tones per box — top, front, side — and
 * no gradient anywhere. The solidity is doing the work that shading does in
 * the other four, which is why the palette can stay saturated.
 *
 * What this is honestly not: the board is still a square top-down grid, and
 * this changes the *assets*, not the camera the game is played through.
 * Tilting the whole board is a separate and much larger decision — see the
 * memo. These sprites are pre-rendered, so they cost the engine nothing and
 * no runtime 3D is involved.
 *
 * Authored at 64px rather than 48: a box edge is a straight diagonal, and a
 * diagonal is the one thing that shows its stair-steps when downsampled, so
 * it gets more pixels to lose.
 */
const toyBox: Direction = {
  id: "toy-box",
  name: "Toy Box",
  axes: { render: "blocks", register: "cute-round" },
  spritePx: 64,
  samples: 2,
  outline: 2,
  shade: 0,
  rim: 0,
  model: "blocks",
  // Top brightest, side darkest. The spread is wide on purpose: it is the
  // only cue that says "solid", and a narrow spread reads as a flat decal.
  faces: { top: 1.12, front: 0.88, side: 0.64 },
  proportions: { head: 1.3, eye: 0.42, spike: 0.8, round: 1.0 },
  pitch: "Chunky blocks under one fixed camera, three flat tones a face. Reads as a solid toy on the board rather than a drawing of one.",
  palette(hue) {
    // Saturated and slightly lifted. Flat faces have no gradient to carry
    // the form, so the colour has to stay bright enough that the three face
    // tones are separable at a 20px cell.
    const base = lighten(rgb(hue), 0.08);
    return {
      base,
      dark: darken(base, 0.3),
      light: lighten(base, 0.28),
      accent: mix(lighten(base, 0.36), [255, 238, 198], 0.42),
      ink: darken(mix(base, [28, 22, 24], 0.8), 0.34),
      eye: rgb(0x191417),
      glint: rgb(0xffffff),
    };
  },
};

/**
 * Pixel art in the GBA tactics idiom, which is the owner's brief after all
 * four earlier directions were turned down: small readable map sprites, a
 * limited palette, a clean dark outline, and — the part that is actually the
 * signature of that generation — **an idle loop and an attack cycle on every
 * unit**. An homage, drawn by this generator: no sheet from any other game
 * is read, copied or traced, and the palettes are derived from our own six
 * kind hues (rule 5).
 *
 * **Authored at 15px, which looks arbitrary and is the whole trick.** A
 * dinosaur is drawn into a box of `CELL_PX * DRAW_CELLS` = 45 logical pixels
 * (section 5.0), and 45/15 is exactly 3 — so one authored pixel is a 3x3
 * block of canvas pixels and the pixel grid survives on the logical canvas.
 * 16px, the obvious choice, gives 2.8125 and smears every edge. The honest
 * limits of that claim, both of which also apply to Fossil Pixel:
 *
 * - **Invaders are not integer-scaled.** They are drawn at one cell, so the
 *   scale is 36/15 = 2.4 and a run of authored pixels comes out 2 and 3
 *   canvas pixels wide alternately. Dinosaurs are what the player stares at
 *   while building, so dinosaurs get the exact scale.
 * - **The device scale is never integral.** The canvas is FIT-scaled to the
 *   phone (0.5417 on the reference device), so the display resamples once
 *   whatever we do. This is pixel-art *style* with the pixel grid intact in
 *   logical space, not a pixel-perfect renderer.
 *
 * Flat, banded shading with `samples: 1`: `sculpt` quantises to four steps
 * when a direction is unsampled, which is what a GBA sprite's two or three
 * body tones plus an outline look like. `round: 1` is load-bearing rather
 * than stylistic — at 15px an authored limb radius of 0.05 is 0.75 of a
 * pixel and a leg can vanish between pixel centres; `round` fattens limbs by
 * 45% and puts them back over 1px.
 */
const tacticsPixel: Direction = {
  id: "tactics-pixel",
  name: "Tactics Pixel",
  axes: { render: "pixel", register: "cute-round" },
  spritePx: 15,
  samples: 1,
  outline: 1,
  inset: 1,
  shade: 0.34,
  rim: 1,
  // A big head and a big eye: at 15px the head is about five pixels across
  // and the eye is one, and one pixel is all the face there is.
  proportions: { head: 1.34, eye: 0.46, spike: 1.15, round: 1.0 },
  pitch: "GBA map sprites: 15px of chunky pixels, two body tones and a dark outline, with an idle bob and an attack lunge on every kind.",
  palette(hue) {
    // **The raw kind hue, and that was not the first attempt.** A GBA palette
    // reads chalky — the hardware had no backlight, so the art was authored
    // bright and a little desaturated — and lifting the base 16% toward a
    // warm grey is what that looks like. It also costs the colour-blindness
    // margin, measured rather than guessed: the tightest pair
    // (longneck/flier under tritanopia) falls from distance 147 at the raw
    // hue to 97 at a 12% grey mix, and raptor/longneck fails under
    // protanopia as well at a 16% lift. Nothing between 0 and 16% passes.
    //
    // So the chalk comes from everything except the base: four shade bands
    // rather than a ramp, a hue-tinted outline instead of black, and 15px of
    // resolution. The direction keeps its register and keeps the margin, and
    // it is the only one of the four repainting directions that does — see
    // the advisory line in `art:check`.
    const base = rgb(hue);
    return {
      base,
      dark: darken(base, 0.33),
      light: lighten(base, 0.28),
      accent: mix(lighten(base, 0.42), [255, 244, 214], 0.5),
      // Not black: a very dark tint of the kind hue, so sixty outlines do
      // not add up to a black grid.
      ink: darken(mix(base, [26, 20, 24], 0.8), 0.3),
      eye: rgb(0x14100f),
      glint: rgb(0xfffdf4),
    };
  },
};

export const DIRECTIONS: readonly Direction[] = [fossilPixel, clayPack, valleyNaturalist, toyBox, tacticsPixel];

export function direction(id: string): Direction {
  const d = DIRECTIONS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown direction ${id}; have ${DIRECTIONS.map((x) => x.id).join(", ")}`);
  return d;
}

/**
 * The direction that ships. Everything downstream — which atlas
 * `npm run art:atlas` writes, which direction the frame-border check gates
 * rather than reports — reads it from here instead of restating the id, so
 * the other four stay buildable as the record of how the choice was made
 * without being mistaken for candidates. Changing direction is this line.
 */
export const CHOSEN: Direction = direction("toy-box");

// ------------------------------------------------- the colour-blindness check

/**
 * Brettel/Vienot-style dichromat simulation, the usual linear-RGB matrices.
 * Good enough for the only question being asked: are two kind hues still
 * two colours for a player who cannot separate red from green?
 */
const SIM: Record<"deuteranopia" | "protanopia" | "tritanopia", readonly number[]> = {
  protanopia: [0.1705, 0.8295, 0.0, 0.1705, 0.8295, 0.0, -0.0045, 0.0045, 1.0],
  deuteranopia: [0.3307, 0.6693, 0.0, 0.3307, 0.6693, 0.0, 0.0225, -0.0225, 1.0],
  tritanopia: [1.0, 0.1273, -0.1273, 0.0, 0.8734, 0.1266, 0.0, 0.8734, 0.1266],
};

function toLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function fromLinear(v: number): number {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

export function simulate(c: Rgb, kind: keyof typeof SIM): Rgb {
  const m = SIM[kind];
  const [r, g, b] = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
  return [
    fromLinear((m[0] as number) * r + (m[1] as number) * g + (m[2] as number) * b),
    fromLinear((m[3] as number) * r + (m[4] as number) * g + (m[5] as number) * b),
    fromLinear((m[6] as number) * r + (m[7] as number) * g + (m[8] as number) * b),
  ];
}

/**
 * How far apart two colours are for a given eye. CIE76 in Lab would be
 * nicer; this is a weighted RGB distance that correlates well enough and
 * keeps the generator dependency-free. The threshold below was set by
 * looking at the rendered swatches, not by theory.
 */
export function perceptualDistance(a: Rgb, b: Rgb): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export interface PairCheck {
  a: Kind;
  b: Kind;
  vision: string;
  distance: number;
  /** Contrast ratio between the two, which is the second channel when hue fails. */
  valueRatio: number;
}

/**
 * Every pair of kind hues under normal vision and the three dichromacies.
 * A pair passes if the colours are far enough apart *or* far enough apart
 * in value that lightness alone separates them. Shape is the third channel
 * and is not measured here; KIND_SILHOUETTE_NOTE is.
 *
 * `body` defaults to the raw KIND_HUE, which is what the HUD chips and the
 * kind buttons use. Pass a direction's `palette(hue).base` to check the
 * colour the player actually sees on the board — a direction that mixes
 * the hue toward a neutral is spending the separation margin that these
 * hues were chosen to have, and it should have to say so.
 */
export function kindColourChecks(body: (kind: Kind) => Rgb = (k) => rgb(KIND_HUE[k])): { worst: PairCheck[]; failures: PairCheck[] } {
  const visions: (keyof typeof SIM | "normal")[] = ["normal", "deuteranopia", "protanopia", "tritanopia"];
  const all: PairCheck[] = [];
  for (const vision of visions) {
    for (let i = 0; i < KINDS.length; i++) {
      for (let j = i + 1; j < KINDS.length; j++) {
        const ka = KINDS[i] as Kind;
        const kb = KINDS[j] as Kind;
        const ca = vision === "normal" ? body(ka) : simulate(body(ka), vision);
        const cb = vision === "normal" ? body(kb) : simulate(body(kb), vision);
        all.push({ a: ka, b: kb, vision, distance: perceptualDistance(ca, cb), valueRatio: contrastRatio(ca, cb) });
      }
    }
  }
  const failures = all.filter((p) => p.distance < MIN_DISTANCE && p.valueRatio < MIN_VALUE_RATIO);
  const worst = [...all].sort((x, y) => x.distance - y.distance).slice(0, 6);
  return { worst, failures };
}

/** Hue separation below this needs lightness to carry the pair. */
export const MIN_DISTANCE = 120;
/** Lightness separation that counts as a second channel on its own. */
export const MIN_VALUE_RATIO = 1.5;
