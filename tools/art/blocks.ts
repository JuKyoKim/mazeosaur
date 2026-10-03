// The block models. One per kind and per invader archetype, authored as
// axis-aligned boxes in the same unit space the 2D silhouettes use, so a
// kind reads the same whichever direction wins.
//
// The creature faces +x, which under this camera is toward the lower right.
// Its tail runs back to -x, upper left. Height is +y. Depth is z, and every
// land animal is kept narrow in z (roughly 0.3..0.7) so it reads side-on at
// a three-quarter angle rather than as a lump.
//
// The rule from the 2D bestiary carries over unchanged and is the reason
// any of this is legible at a 20px cell: solid mass stays inside
// x 0.10..0.90, and only appendages — horn tips, tail clubs, wing tips —
// are allowed further out.
//
// Every animal is a real genus. Where the popular image and the
// palaeontology disagree the palaeontology wins, exactly as in bestiary.ts.

import { box, sharedSpan, type Box } from "./voxel.js";
import type { Kind } from "./directions.js";
import type { Archetype } from "./bestiary.js";

/** Scale a model about the ground centre, so stages share a floor. */
function grow(model: Box[], k: number): Box[] {
  return model.map((b) => ({
    ...b,
    x: 0.5 + (b.x - 0.5) * k,
    z: 0.5 + (b.z - 0.5) * k,
    y: b.y * k,
    w: b.w * k,
    h: b.h * k,
    d: b.d * k,
  }));
}

/** Stage scale. An adult is half again the hatchling, which reads at 20px. */
const STAGE: Record<1 | 2 | 3, number> = { 1: 0.66, 2: 0.82, 3: 1 };

/** Four legs at the corners of a footprint. */
function legs4(x0: number, x1: number, z0: number, z1: number, h: number, t = 0.07): Box[] {
  return [
    box(x0, 0, z0, t, h, t, "dark"),
    box(x1 - t, 0, z0, t, h, t, "dark"),
    box(x0, 0, z1 - t, t, h, t, "dark"),
    box(x1 - t, 0, z1 - t, t, h, t, "dark"),
  ];
}

/** Two legs, offset in depth so both are visible under the body. */
function legs2(x: number, h: number, t = 0.09): Box[] {
  return [box(x, 0, 0.38, t, h, t, "dark"), box(x + 0.04, 0, 0.54, t, h, t, "dark")];
}

/**
 * An eye, stuck proud of a head's +z face so the camera can see it. The eye
 * is the one feature that survives the 20px cell in any direction, so every
 * model gets one and it is never smaller than three authored units.
 */
function eye(x: number, y: number, zFace: number, s = 0.055): Box[] {
  return [box(x, y, zFace - 0.01, s, s, 0.04, "eye"), box(x + s * 0.25, y + s * 0.45, zFace + 0.01, s * 0.4, s * 0.4, 0.03, "glint")];
}

// --------------------------------------------------------------- the kinds

/** A low horizontal dash: stiff tail out behind, head carried forward. */
function raptor(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    // Long and low. The first pass was a tall box with a stub behind it and
    // read as a lump: the dash is the whole tell, so the mass runs the full
    // width of the model and the body is shorter than it is long.
    ...legs2(0.4, 0.2),
    box(0.3, 0.2, 0.41, 0.28, 0.15, 0.18), // body, low
    box(0.12, 0.23, 0.43, 0.2, 0.07, 0.12), // tail, stiff and horizontal
    box(0.02, 0.24, 0.44, 0.12, 0.05, 0.09, "dark"), // and carried out past it
    box(0.56, 0.24, 0.41, 0.16, 0.13, 0.17), // head, forward and level
    box(0.71, 0.25, 0.43, 0.15, 0.07, 0.12, "dark"), // snout, long
    ...eye(0.61, 0.31, 0.58),
  ];
  if (stage === 3) m.push(box(0.6, 0.4, 0.44, 0.12, 0.05, 0.05, "accent")); // crest
  if (stage >= 2) m.push(box(0.56, 0.18, 0.42, 0.06, 0.04, 0.05, "accent")); // sickle claw
  return grow(m, STAGE[stage]);
}

/** Top-heavy: the head is a third of the animal, over a deep body. */
function tyrant(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    ...legs2(0.4, 0.26, 0.11),
    box(0.28, 0.26, 0.38, 0.32, 0.26, 0.24), // deep body
    box(0.12, 0.3, 0.42, 0.18, 0.11, 0.14), // short tail
    box(0.56, 0.42, 0.37, 0.27, 0.22, 0.24), // the head, oversized
    box(0.6, 0.37, 0.39, 0.25, 0.06, 0.2, "dark"), // jaw
    box(0.56, 0.3, 0.4, 0.07, 0.05, 0.06, "dark"), // the small arms
    ...eye(0.64, 0.52, 0.61),
  ];
  if (stage >= 2) m.push(box(0.68, 0.38, 0.4, 0.14, 0.03, 0.03, "glint")); // teeth
  if (stage === 3) m.push(box(0.5, 0.52, 0.42, 0.1, 0.08, 0.06, "accent")); // brow
  return grow(m, STAGE[stage]);
}

/** A wide low hump with a detached-looking ball on the tail. */
function armored(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    ...legs4(0.3, 0.68, 0.3, 0.7, 0.1),
    box(0.28, 0.09, 0.28, 0.4, 0.15, 0.44), // wide low body
    // A dome, not a slab: two courses stepped in on all four sides. One
    // course read as a lid on a box and the hump is half the tell.
    box(0.33, 0.24, 0.33, 0.3, 0.1, 0.34, "light"),
    box(0.38, 0.34, 0.38, 0.2, 0.08, 0.24, "light"),
    box(0.64, 0.09, 0.42, 0.14, 0.11, 0.17, "dark"), // small low head
    // The club has to look detached, so the tail that carries it is thin
    // enough to disappear at 20px and the ball is nearly head-sized. At the
    // first pass the club was smaller than the tail and merged into the body.
    box(0.17, 0.13, 0.45, 0.13, 0.05, 0.07),
    box(0.0, 0.08, 0.41, 0.17, 0.17, 0.17, "accent"),
    ...eye(0.7, 0.15, 0.59, 0.045),
  ];
  if (stage >= 2) {
    m.push(box(0.3, 0.36, 0.36, 0.08, 0.06, 0.07, "accent"), box(0.52, 0.36, 0.36, 0.08, 0.06, 0.07, "accent"));
  }
  if (stage === 3) m.push(box(0.24, 0.16, 0.24, 0.42, 0.07, 0.06, "accent"), box(0.24, 0.16, 0.7, 0.42, 0.07, 0.06, "accent"));
  return grow(m, STAGE[stage]);
}

/** A disc broken by one forward spike. */
function horned(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    ...legs4(0.3, 0.64, 0.34, 0.66, 0.13),
    box(0.28, 0.12, 0.34, 0.32, 0.2, 0.32), // body
    box(0.5, 0.16, 0.3, 0.06, 0.3, 0.4, "accent"), // the frill: a standing disc
    box(0.58, 0.14, 0.4, 0.15, 0.15, 0.18), // head
    box(0.71, 0.22, 0.44, 0.19, 0.05, 0.055, "accent"), // the spike, forward
    box(0.12, 0.16, 0.44, 0.18, 0.08, 0.1), // tail
    ...eye(0.63, 0.2, 0.58, 0.05),
  ];
  if (stage === 3) m.push(box(0.66, 0.26, 0.37, 0.09, 0.09, 0.05, "accent"), box(0.66, 0.26, 0.56, 0.09, 0.09, 0.05, "accent"));
  return grow(m, STAGE[stage]);
}

/** The only tall one: a vertical neck with the head at the top of the cell. */
function longneck(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    ...legs4(0.28, 0.64, 0.34, 0.66, 0.17),
    box(0.24, 0.16, 0.32, 0.34, 0.2, 0.34), // body
    box(0.5, 0.32, 0.42, 0.11, 0.15, 0.13), // neck
    box(0.54, 0.45, 0.43, 0.1, 0.15, 0.12),
    box(0.57, 0.58, 0.44, 0.09, 0.13, 0.11),
    box(0.58, 0.69, 0.43, 0.14, 0.08, 0.12), // head, at the cell top
    box(0.06, 0.2, 0.43, 0.2, 0.08, 0.1), // tail
    ...eye(0.63, 0.72, 0.55, 0.045),
  ];
  if (stage >= 2) m.push(box(0.56, 0.78, 0.44, 0.07, 0.04, 0.05, "accent"));
  return grow(m, STAGE[stage]);
}

/** The only wide one: a swept chevron with a long beak. */
function flier(stage: 1 | 2 | 3): Box[] {
  const m: Box[] = [
    box(0.4, 0.3, 0.42, 0.17, 0.13, 0.17), // body
    // The wings run along z, which this camera lays out as one long
    // diagonal: the wide chevron the archetype sheet promises.
    box(0.34, 0.37, 0.08, 0.14, 0.05, 0.3),
    box(0.34, 0.37, 0.62, 0.14, 0.05, 0.3),
    box(0.3, 0.39, 0.0, 0.1, 0.04, 0.1, "dark"), // swept tips
    box(0.3, 0.39, 0.9, 0.1, 0.04, 0.1, "dark"),
    box(0.55, 0.33, 0.45, 0.19, 0.05, 0.06, "accent"), // the long beak
    box(0.26, 0.32, 0.44, 0.15, 0.05, 0.08), // tail vane
    ...legs2(0.44, 0.11, 0.05),
    ...eye(0.52, 0.38, 0.59, 0.045),
  ];
  if (stage === 3) m.push(box(0.5, 0.42, 0.44, 0.1, 0.09, 0.05, "accent")); // head crest
  return grow(m, STAGE[stage]);
}

export const KIND_BLOCKS: Record<Kind, (stage: 1 | 2 | 3) => Box[]> = {
  raptor,
  tyrant,
  armored,
  horned,
  longneck,
  flier,
};

// ---------------------------------------------------------- the archetypes

/** The baseline invader every other archetype is a deviation from. */
function plain(): Box[] {
  return [...legs2(0.42, 0.2), box(0.33, 0.18, 0.4, 0.28, 0.2, 0.2), box(0.58, 0.24, 0.42, 0.16, 0.14, 0.16), box(0.1, 0.22, 0.43, 0.22, 0.07, 0.12), ...eye(0.63, 0.3, 0.58)];
}

export const ARCHETYPE_BLOCKS: Record<Archetype, () => Box[]> = {
  normal: plain,

  // Leaning forward past its feet, with three trailing streaks.
  fast: () => [
    ...legs2(0.36, 0.18),
    box(0.36, 0.2, 0.4, 0.3, 0.16, 0.18),
    box(0.62, 0.3, 0.42, 0.16, 0.12, 0.15),
    box(0.16, 0.26, 0.44, 0.2, 0.06, 0.1),
    box(0.06, 0.3, 0.44, 0.1, 0.025, 0.04, "accent"),
    box(0.04, 0.24, 0.46, 0.12, 0.025, 0.04, "accent"),
    box(0.07, 0.36, 0.42, 0.09, 0.025, 0.04, "accent"),
    ...eye(0.67, 0.35, 0.57, 0.05),
  ],

  // Twice as wide as tall, with four shoulder plates.
  tank: () => [
    ...legs4(0.2, 0.76, 0.3, 0.7, 0.09),
    box(0.16, 0.08, 0.28, 0.6, 0.16, 0.44),
    // Four, because the tell the player is given says four and the 2D
    // silhouette draws four. Three was a miscount, not a variation.
    box(0.2, 0.24, 0.32, 0.11, 0.09, 0.36, "accent"),
    box(0.33, 0.24, 0.32, 0.11, 0.09, 0.36, "accent"),
    box(0.46, 0.24, 0.32, 0.11, 0.09, 0.36, "accent"),
    box(0.59, 0.24, 0.32, 0.11, 0.09, 0.36, "accent"),
    box(0.7, 0.1, 0.42, 0.12, 0.1, 0.16, "dark"),
    ...eye(0.75, 0.14, 0.58, 0.045),
  ],

  // A chevron, drawn over a ground shadow so the height reads.
  flying: () => [
    box(0.42, 0.44, 0.42, 0.16, 0.1, 0.16),
    box(0.36, 0.5, 0.1, 0.13, 0.045, 0.3),
    box(0.36, 0.5, 0.6, 0.13, 0.045, 0.3),
    box(0.56, 0.46, 0.45, 0.17, 0.045, 0.06, "accent"),
    box(0.36, 0.0, 0.38, 0.22, 0.012, 0.22, "ink"), // the shadow on the ground
    ...eye(0.53, 0.5, 0.58, 0.04),
  ],

  // Half size, and never alone — the frame draws three of these.
  swarm: () => grow([...legs2(0.44, 0.16), box(0.38, 0.14, 0.42, 0.22, 0.14, 0.16), box(0.58, 0.18, 0.43, 0.12, 0.1, 0.13), box(0.22, 0.17, 0.44, 0.16, 0.05, 0.09), ...eye(0.62, 0.22, 0.56, 0.04)], 0.78),

  // A visible seam down the body: it is already two animals.
  splitter: () => [
    ...legs2(0.42, 0.2),
    box(0.33, 0.18, 0.4, 0.28, 0.2, 0.09),
    box(0.33, 0.18, 0.51, 0.28, 0.2, 0.09),
    box(0.33, 0.18, 0.49, 0.28, 0.2, 0.02, "ink"), // the seam
    box(0.58, 0.24, 0.42, 0.16, 0.14, 0.16),
    box(0.1, 0.22, 0.43, 0.22, 0.07, 0.12),
    ...eye(0.63, 0.3, 0.58),
  ],

  // A bright chevron on the flank that pulses with the regen tick.
  regenerator: () => [...plain(), box(0.38, 0.24, 0.6, 0.08, 0.08, 0.03, "accent"), box(0.46, 0.2, 0.6, 0.08, 0.08, 0.03, "accent")],

  // A bracket plate held in front, drawn in front of the body outline.
  shielded: () => [...plain(), box(0.78, 0.12, 0.34, 0.05, 0.3, 0.34, "accent"), box(0.74, 0.12, 0.34, 0.05, 0.06, 0.34, "accent"), box(0.74, 0.36, 0.34, 0.05, 0.06, 0.34, "accent")],

  // Two cells wide, a crown of spines, and its own shadow.
  boss: () => [
    box(0.26, 0.0, 0.3, 0.5, 0.02, 0.44, "ink"), // shadow
    ...legs2(0.38, 0.3, 0.13),
    box(0.24, 0.3, 0.34, 0.36, 0.28, 0.3),
    box(0.08, 0.34, 0.4, 0.2, 0.12, 0.16),
    box(0.56, 0.46, 0.34, 0.28, 0.24, 0.28),
    box(0.6, 0.41, 0.36, 0.26, 0.06, 0.24, "dark"),
    box(0.68, 0.42, 0.37, 0.16, 0.03, 0.03, "glint"),
    // the crown
    box(0.3, 0.58, 0.44, 0.05, 0.14, 0.05, "accent"),
    box(0.4, 0.6, 0.44, 0.05, 0.16, 0.05, "accent"),
    box(0.5, 0.62, 0.44, 0.05, 0.15, 0.05, "accent"),
    ...eye(0.66, 0.56, 0.62, 0.06),
  ],
};

/**
 * The one scale every model is drawn at, measured from the models rather
 * than assumed from the unit cube.
 *
 * It has to be measured. These animals are deliberately narrow in depth so
 * they read side-on, and under this camera a narrow z collapses the
 * projected *width* — a cube-derived scale leaves the biggest model filling
 * under half its frame. Deriving it here means editing a model cannot
 * silently un-calibrate the rest.
 *
 * The boss is excluded because it is the one model rendered into a
 * double-size frame: counting it here would scale the whole bestiary down
 * to fit something that already has twice the room.
 */
export const BLOCK_SPAN: number = sharedSpan([
  ...(Object.keys(KIND_BLOCKS) as Kind[]).flatMap((k) => ([1, 2, 3] as const).map((s) => KIND_BLOCKS[k](s))),
  ...(Object.keys(ARCHETYPE_BLOCKS) as Archetype[]).filter((a) => a !== "boss").map((a) => ARCHETYPE_BLOCKS[a]()),
]);
