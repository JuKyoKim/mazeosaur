// The silhouettes. One entry per kind and per invader archetype, written in
// a unit box so the same geometry can be rasterised at 24px for pixel art
// and 48px for vector without redrawing anything.
//
// Unit space: x and y both 0..1, y down. The 36px build cell occupies
// 0.125..0.875 of the frame, so the ground line is y = 0.88 and solid mass
// stays inside x 0.10..0.90; only appendages (horn tips, tail clubs, wing
// tips) are allowed into the 6px overhang. That rule is what keeps a dense
// maze from turning to mush.
//
// Every animal is a real genus and every shape comes from the skeleton, not
// from a film. Where a popular image and the palaeontology disagree —
// feathered dromaeosaurs, a sail-backed Spinosaurus, no frill on a
// Dilophosaurus — the palaeontology wins.

import { type Shape, ellipse, poly, subtract, taper, union } from "./raster.js";

export type Kind = "raptor" | "tyrant" | "armored" | "horned" | "longneck" | "flier";
export type Archetype = "normal" | "fast" | "tank" | "flying" | "swarm" | "splitter" | "regenerator" | "shielded" | "boss";

/** Which palette slot a part takes. `detail` parts are drawn after shading. */
export type Tone = "base" | "dark" | "light" | "accent" | "ink" | "eye" | "glint";

export interface Part {
  shape: Shape;
  tone: Tone;
  /** Drawn on top and exempt from the sculpting pass: eyes, teeth, claws. */
  detail?: boolean;
}

/**
 * The knobs a direction turns. Cute-round and fierce-realistic are the same
 * skeleton with different values here, which is the point: the kind reads
 * from the silhouette either way.
 */
export interface Proportions {
  /** Head scale. Cute inflates it, fierce does not. */
  head: number;
  /** Eye radius, as a fraction of head radius. 0 draws no eye. */
  eye: number;
  /** Horn, spine and claw length. */
  spike: number;
  /** 0 keeps authored radii, 1 fattens limbs and shortens snouts. */
  round: number;
}

const GROUND = 0.88;

/** Limb radii get fatter as `round` rises; snouts get blunter. */
function limb(r: number, p: Proportions): number {
  return r * (1 + 0.45 * p.round);
}

function spikeTri(bx: number, by: number, tx: number, ty: number, halfWidth: number, p: Proportions): Shape {
  // A triangle from a base of 2*halfWidth to a tip, lengthened by `spike`.
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const L = len * p.spike;
  const w = halfWidth * (1 + 0.5 * p.round);
  return poly([
    [bx + nx * w, by + ny * w],
    [bx - nx * w, by - ny * w],
    [bx + ux * L, by + uy * L],
  ]);
}

/**
 * Stage scale about the ground line: a hatchling is small, an adult fills
 * the cell and a little past it. The spread is wide — 0.70 to 1.06 — because
 * at 0.78/0.90/1.00 the three stages were the same animal in a 20pt cell,
 * which the legibility sheet showed plainly. Stage has to be readable from
 * mass alone, since the accents that distinguish the genera are the first
 * thing to disappear when the cell gets small.
 */
function stageScale(stage: 1 | 2 | 3): number {
  return stage === 1 ? 0.7 : stage === 2 ? 0.87 : 1.06;
}

function scaleParts(parts: Part[], s: number, cx = 0.5): Part[] {
  if (s === 1) return parts;
  const tf = (x: number, y: number): [number, number] => [cx + (x - cx) * s, GROUND + (y - GROUND) * s];
  return parts.map((part) => ({ ...part, shape: transform(part.shape, tf, s) }));
}

/**
 * Re-point a shape through an affine map. Implemented by wrapping the
 * inside test with the inverse, which is exact and avoids a shape-type
 * switch — the cost is that `expand` works in post-transform pixels,
 * which is what the outline pass wants anyway.
 */
function transform(s: Shape, tf: (x: number, y: number) => [number, number], scale: number): Shape {
  const [a, b] = tf(s.bbox[0], s.bbox[1]);
  const [c, d] = tf(s.bbox[2], s.bbox[3]);
  const inv = (x: number, y: number): [number, number] => {
    // tf is uniform scale about (cx, GROUND); invert it by solving one axis.
    const [ox, oy] = tf(0, 0);
    return [(x - ox) / scale, (y - oy) / scale];
  };
  return {
    bbox: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)],
    contains(x, y) {
      const [u, v] = inv(x, y);
      return s.contains(u, v);
    },
    expand(k) {
      return transform(s.expand(k / scale), tf, scale);
    },
  };
}

function eye(cx: number, cy: number, r: number, p: Proportions): Part[] {
  if (p.eye <= 0) return [];
  const er = r * p.eye;
  return [
    { shape: ellipse(cx, cy, er, er), tone: "eye", detail: true },
    { shape: ellipse(cx + er * 0.3, cy - er * 0.3, er * 0.38, er * 0.38), tone: "glint", detail: true },
  ];
}

// --------------------------------------------------------------- the six kinds

/**
 * Raptor — Velociraptor, Deinonychus, Utahraptor. A low horizontal dash:
 * stiff counterbalancing tail, head carried forward and low, one foot
 * lifted on the sickle claw. Feathered, as the fossils are.
 */
function raptor(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const parts: Part[] = [
    { shape: taper(0.26, 0.58, 0.03, 0.36, limb(0.075, p), 0.014), tone: "base" },
    { shape: ellipse(0.45, 0.6, 0.25, 0.145, -0.14), tone: "base" },
    { shape: taper(0.42, 0.7, 0.36, GROUND, limb(0.045, p), limb(0.032, p)), tone: "dark" },
    { shape: taper(0.56, 0.68, 0.63, GROUND - 0.04, limb(0.048, p), limb(0.034, p)), tone: "base" },
    { shape: taper(0.62, 0.55, 0.8, 0.44, limb(0.062, p), limb(0.05, p)), tone: "base" },
    { shape: ellipse(0.83, 0.42, 0.095 * hs, 0.072 * hs, -0.18), tone: "base" },
    { shape: taper(0.86, 0.44, 0.96 - 0.03 * p.round, 0.47, 0.045 * hs, 0.026 * hs), tone: "base" },
    // the sickle claw, the one thing every dromaeosaur is known for
    { shape: spikeTri(0.63, GROUND - 0.05, 0.71, GROUND - 0.1, 0.018, p), tone: "accent", detail: true },
    ...eye(0.85, 0.4, 0.072 * hs, p),
  ];
  if (stage >= 2) {
    // a tail fan and an arm plume: feathers, not scales
    parts.push({ shape: spikeTri(0.1, 0.42, 0.02, 0.26, 0.03, p), tone: "accent" });
    parts.push({ shape: spikeTri(0.5, 0.49, 0.44, 0.34, 0.035, p), tone: "accent" });
  }
  if (stage === 3) {
    parts.push({ shape: spikeTri(0.78, 0.37, 0.84, 0.2, 0.03, p), tone: "accent" });
    parts.push({ shape: spikeTri(0.36, 0.49, 0.26, 0.32, 0.04, p), tone: "accent" });
    parts.push({ shape: ellipse(0.42, 0.55, 0.14, 0.055, -0.2), tone: "light" });
  }
  return scaleParts(parts, stageScale(stage));
}

/**
 * Tyrant — Tarbosaurus, Daspletosaurus, Tyrannosaurus. Top-heavy: the head
 * is the animal. Deep jaw up front, thick body, tail swinging down and back.
 */
function tyrant(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const parts: Part[] = [
    { shape: taper(0.24, 0.6, 0.04, 0.8, limb(0.095, p), 0.02), tone: "base" },
    { shape: ellipse(0.42, 0.56, 0.22, 0.185, -0.18), tone: "base" },
    { shape: taper(0.38, 0.7, 0.33, GROUND, limb(0.07, p), limb(0.05, p)), tone: "dark" },
    { shape: taper(0.52, 0.69, 0.57, GROUND, limb(0.072, p), limb(0.052, p)), tone: "base" },
    { shape: taper(0.55, 0.43, 0.66, 0.35, limb(0.105, p), limb(0.095, p)), tone: "base" },
    { shape: ellipse(0.74, 0.31, 0.15 * hs, 0.105 * hs, 0.1), tone: "base" },
    // lower jaw, drawn as its own mass so the mouth reads as a line
    { shape: taper(0.7, 0.38, 0.9 - 0.02 * p.round, 0.4, 0.035 * hs, 0.028 * hs), tone: "dark" },
    { shape: taper(0.5, 0.56, 0.6, 0.62, limb(0.025, p), limb(0.02, p)), tone: "dark" },
    ...eye(0.78, 0.27, 0.1 * hs, p),
  ];
  if (stage >= 2) {
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      parts.push({ shape: spikeTri(0.62 + t * 0.2, 0.35 - t * 0.02, 0.63 + t * 0.2, 0.42, 0.012, p), tone: "accent", detail: true });
    }
  }
  if (stage === 3) {
    parts.push({ shape: spikeTri(0.69, 0.26, 0.66, 0.16, 0.022, p), tone: "accent" });
    parts.push({ shape: spikeTri(0.79, 0.24, 0.82, 0.14, 0.02, p), tone: "accent" });
    parts.push({ shape: ellipse(0.4, 0.47, 0.15, 0.06, -0.2), tone: "light" });
  }
  return scaleParts(parts, stageScale(stage));
}

/**
 * Armored — Nodosaurus, Euoplocephalus, Ankylosaurus. Wide low hump with a
 * ball on the end of the tail: the only kind whose silhouette has a
 * detached-looking mass, which is what makes it read instantly.
 */
function armored(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const parts: Part[] = [
    { shape: ellipse(0.5, 0.68, 0.3, 0.155), tone: "base" },
    { shape: ellipse(0.5, 0.61, 0.31, 0.135), tone: "accent" },
    { shape: taper(0.22, 0.7, 0.1, 0.63, limb(0.055, p), limb(0.04, p)), tone: "base" },
    { shape: ellipse(0.06, 0.6, 0.075, 0.072), tone: "accent" },
    { shape: ellipse(0.78, 0.73, 0.085 * hs, 0.065 * hs), tone: "base" },
    { shape: taper(0.35, 0.78, 0.33, GROUND, limb(0.05, p), limb(0.045, p)), tone: "dark" },
    { shape: taper(0.48, 0.79, 0.48, GROUND, limb(0.05, p), limb(0.045, p)), tone: "dark" },
    { shape: taper(0.62, 0.78, 0.64, GROUND, limb(0.05, p), limb(0.045, p)), tone: "base" },
    ...eye(0.81, 0.71, 0.07 * hs, p),
  ];
  const spikes = stage === 1 ? 3 : stage === 2 ? 5 : 7;
  for (let i = 0; i < spikes; i++) {
    const t = i / (spikes - 1);
    const x = 0.24 + t * 0.52;
    parts.push({ shape: spikeTri(x, 0.56, x, 0.47, 0.022, p), tone: stage === 3 ? "light" : "accent", detail: true });
  }
  if (stage === 3) {
    parts.push({ shape: spikeTri(0.02, 0.56, 0.0, 0.46, 0.022, p), tone: "light", detail: true });
    parts.push({ shape: ellipse(0.5, 0.58, 0.2, 0.05), tone: "light" });
  }
  return scaleParts(parts, stageScale(stage));
}

/**
 * Horned — Protoceratops, Styracosaurus, Triceratops. A disc with a spike:
 * the frill is the biggest flat shape on the board and the nose horn breaks
 * its circle, so the pair reads at any size.
 */
function horned(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const frill = stage === 1 ? 0.16 : stage === 2 ? 0.19 : 0.215;
  const parts: Part[] = [
    { shape: ellipse(0.38, 0.66, 0.24, 0.165), tone: "base" },
    { shape: taper(0.17, 0.67, 0.06, 0.71, limb(0.055, p), limb(0.025, p)), tone: "base" },
    { shape: ellipse(0.64, 0.53, frill, frill * 1.04), tone: "accent" },
    { shape: ellipse(0.77, 0.58, 0.115 * hs, 0.095 * hs), tone: "base" },
    { shape: poly([
      [0.86, 0.54],
      [0.93 + 0.02 * p.round, 0.61],
      [0.85, 0.645],
    ]), tone: "dark", detail: true },
    { shape: taper(0.3, 0.78, 0.28, GROUND, limb(0.052, p), limb(0.046, p)), tone: "dark" },
    { shape: taper(0.44, 0.79, 0.45, GROUND, limb(0.05, p), limb(0.044, p)), tone: "dark" },
    { shape: taper(0.58, 0.77, 0.6, GROUND, limb(0.052, p), limb(0.046, p)), tone: "base" },
    // the nose horn: the spike that breaks the disc
    { shape: spikeTri(0.84, 0.53, 0.97, 0.38, 0.026, p), tone: "light", detail: true },
    ...eye(0.78, 0.55, 0.085 * hs, p),
  ];
  if (stage >= 2) {
    parts.push({ shape: spikeTri(0.66, 0.4, 0.72, 0.26, 0.024, p), tone: "light", detail: true });
    parts.push({ shape: spikeTri(0.54, 0.42, 0.52, 0.28, 0.022, p), tone: "light", detail: true });
  }
  if (stage === 3) {
    parts.push({ shape: spikeTri(0.48, 0.5, 0.4, 0.38, 0.024, p), tone: "light", detail: true });
    parts.push({ shape: spikeTri(0.7, 0.66, 0.76, 0.78, 0.022, p), tone: "light", detail: true });
    parts.push({ shape: ellipse(0.64, 0.52, frill * 0.6, frill * 0.6), tone: "light" });
  }
  return scaleParts(parts, stageScale(stage));
}

/**
 * Longneck — Diplodocus, Brachiosaurus, Argentinosaurus. The only tall
 * silhouette: a vertical neck with the head at the top of the cell and a
 * whip tail along the ground.
 */
function longneck(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const neckTop = stage === 1 ? 0.3 : stage === 2 ? 0.22 : 0.14;
  const parts: Part[] = [
    { shape: taper(0.2, 0.64, 0.02, 0.56, limb(0.075, p), 0.012), tone: "base" },
    { shape: ellipse(0.42, 0.65, 0.235, 0.155), tone: "base" },
    { shape: taper(0.52, 0.58, 0.7, neckTop + 0.04, limb(0.065, p), limb(0.04, p)), tone: "base" },
    { shape: ellipse(0.73, neckTop, 0.07 * hs, 0.052 * hs, 0.3), tone: "base" },
    { shape: taper(0.34, 0.75, 0.32, GROUND, limb(0.058, p), limb(0.054, p)), tone: "dark" },
    { shape: taper(0.5, 0.76, 0.51, GROUND, limb(0.055, p), limb(0.05, p)), tone: "dark" },
    { shape: taper(0.6, 0.74, 0.63, GROUND, limb(0.055, p), limb(0.05, p)), tone: "base" },
    ...eye(0.75, neckTop - 0.012, 0.055 * hs, p),
  ];
  if (stage >= 2) {
    parts.push({ shape: ellipse(0.42, 0.58, 0.18, 0.055), tone: "light" });
  }
  if (stage === 3) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      parts.push({ shape: spikeTri(0.3 + t * 0.26, 0.52 + t * 0.02, 0.3 + t * 0.26, 0.45, 0.013, p), tone: "accent", detail: true });
    }
  }
  return scaleParts(parts, stageScale(stage));
}

/**
 * Flier — Rhamphorhynchus, Pteranodon, Quetzalcoatlus. Seen from below, the
 * only kind that is wider than it is tall: swept wings and a long beak make
 * a chevron nothing else on the board makes.
 */
function flier(stage: 1 | 2 | 3, p: Proportions): Part[] {
  const hs = p.head;
  const span = stage === 1 ? 0.3 : stage === 2 ? 0.36 : 0.42;
  const parts: Part[] = [
    { shape: poly([
      [0.47, 0.46],
      [0.5 - span, 0.14],
      [0.42 - span, 0.3],
      [0.42, 0.52],
    ]), tone: "base" },
    { shape: poly([
      [0.47, 0.6],
      [0.5 - span, 0.92],
      [0.42 - span, 0.76],
      [0.42, 0.54],
    ]), tone: "base" },
    { shape: ellipse(0.5, 0.53, 0.085, 0.075), tone: "dark" },
    { shape: ellipse(0.62, 0.53, 0.075 * hs, 0.062 * hs), tone: "base" },
    { shape: taper(0.66, 0.53, 0.92 + 0.02 * p.spike, 0.53, 0.035 * hs, 0.012), tone: "base" },
    ...eye(0.63, 0.5, 0.062 * hs, p),
  ];
  if (stage >= 2) {
    // the head crest, which is what tells the three genera apart
    parts.push({ shape: poly([
      [0.6, 0.48],
      [0.48, 0.36 - 0.04 * p.spike],
      [0.6, 0.44],
    ]), tone: "accent" });
  }
  if (stage === 3) {
    parts.push({ shape: poly([
      [0.62, 0.47],
      [0.44, 0.3 - 0.06 * p.spike],
      [0.56, 0.3],
      [0.64, 0.44],
    ]), tone: "accent" });
    parts.push({ shape: poly([
      [0.47, 0.47],
      [0.5 - span * 0.75, 0.3],
      [0.46 - span * 0.75, 0.38],
      [0.44, 0.5],
    ]), tone: "light" });
  }
  return scaleParts(parts, stageScale(stage));
}

export const KIND_SILHOUETTE: Record<Kind, (stage: 1 | 2 | 3, p: Proportions) => Part[]> = {
  raptor,
  tyrant,
  armored,
  horned,
  longneck,
  flier,
};

/** One sentence per kind, for the dinosaur sheet and the spec. */
export const KIND_SILHOUETTE_NOTE: Record<Kind, string> = {
  raptor: "a low horizontal dash: stiff tail out behind, head carried forward",
  tyrant: "top-heavy: the head is a third of the animal, over a deep body",
  armored: "a wide low hump with a detached-looking ball on the tail",
  horned: "a disc broken by one forward spike",
  longneck: "the only tall one: a vertical neck with the head at the cell top",
  flier: "the only wide one: a swept chevron with a long beak",
};

// ------------------------------------------------------------ the invaders

/**
 * Invaders get simpler shapes than dinosaurs — they are smaller on screen,
 * there can be sixty of them, and the information the player needs is
 * archetype first, kind second. Each archetype therefore owns one
 * structural tell that survives at 22px, and the kind rides on hue plus
 * the body plan.
 */
export const ARCHETYPE_TELL: Record<Archetype, string> = {
  normal: "plain bipedal herd animal, no tell — the baseline everything else differs from",
  fast: "leaning forward past its feet, with three trailing streaks",
  tank: "twice as wide as tall, four shoulder plates",
  flying: "a chevron, drawn over a ground shadow so height reads",
  swarm: "half size, and never alone",
  splitter: "a visible seam down the body: it is already two animals",
  regenerator: "a bright chevron on the flank that pulses with the regen tick",
  shielded: "a bracket plate held in front, drawn in front of the body outline",
  boss: "two cells wide, a crown of spines, and its own shadow",
};

function invaderBody(p: Proportions, hs: number): Part[] {
  return [
    { shape: taper(0.27, 0.56, 0.05, 0.42, limb(0.07, p), 0.015), tone: "base" },
    { shape: ellipse(0.46, 0.58, 0.22, 0.155, -0.1), tone: "base" },
    { shape: taper(0.42, 0.7, 0.37, GROUND, limb(0.05, p), limb(0.038, p)), tone: "dark" },
    { shape: taper(0.56, 0.69, 0.61, GROUND, limb(0.05, p), limb(0.038, p)), tone: "base" },
    { shape: taper(0.6, 0.52, 0.76, 0.4, limb(0.06, p), limb(0.045, p)), tone: "base" },
    { shape: ellipse(0.79, 0.37, 0.095 * hs, 0.072 * hs, -0.15), tone: "base" },
    ...eye(0.82, 0.35, 0.072 * hs, p),
  ];
}

function normalInv(p: Proportions): Part[] {
  const parts = invaderBody(p, p.head);
  // a hollow hadrosaur crest, swept back off the skull
  parts.push({ shape: taper(0.78, 0.33, 0.66, 0.2, 0.03, 0.02), tone: "accent" });
  return parts;
}

function fastInv(p: Proportions): Part[] {
  const parts: Part[] = [
    { shape: taper(0.3, 0.5, 0.04, 0.4, limb(0.055, p), 0.012), tone: "base" },
    { shape: ellipse(0.47, 0.54, 0.19, 0.11, -0.22), tone: "base" },
    { shape: taper(0.44, 0.63, 0.34, GROUND, limb(0.038, p), limb(0.028, p)), tone: "dark" },
    { shape: taper(0.56, 0.62, 0.52, GROUND, limb(0.038, p), limb(0.028, p)), tone: "base" },
    { shape: taper(0.6, 0.47, 0.78, 0.27, limb(0.045, p), limb(0.034, p)), tone: "base" },
    { shape: ellipse(0.81, 0.24, 0.075 * p.head, 0.058 * p.head, -0.3), tone: "base" },
    ...eye(0.84, 0.22, 0.058 * p.head, p),
  ];
  for (let i = 0; i < 3; i++) {
    const y = 0.4 + i * 0.1;
    parts.push({ shape: taper(0.24 - i * 0.02, y, 0.04, y, 0.016, 0.006), tone: "light", detail: true });
  }
  return parts;
}

function tankInv(p: Proportions): Part[] {
  const parts: Part[] = [
    { shape: ellipse(0.5, 0.66, 0.33, 0.16), tone: "base" },
    { shape: ellipse(0.5, 0.59, 0.33, 0.13), tone: "dark" },
    { shape: taper(0.2, 0.68, 0.06, 0.66, limb(0.055, p), limb(0.03, p)), tone: "base" },
    { shape: ellipse(0.8, 0.71, 0.09 * p.head, 0.07 * p.head), tone: "base" },
    { shape: taper(0.32, 0.78, 0.3, GROUND, limb(0.055, p), limb(0.05, p)), tone: "dark" },
    { shape: taper(0.5, 0.79, 0.5, GROUND, limb(0.055, p), limb(0.05, p)), tone: "dark" },
    { shape: taper(0.66, 0.78, 0.68, GROUND, limb(0.055, p), limb(0.05, p)), tone: "base" },
    ...eye(0.83, 0.69, 0.07 * p.head, p),
  ];
  for (let i = 0; i < 4; i++) {
    const x = 0.28 + i * 0.15;
    parts.push({ shape: poly([
      [x - 0.045, 0.56],
      [x + 0.045, 0.56],
      [x, 0.44],
    ]), tone: "accent", detail: true });
  }
  return parts;
}

function flyingInv(p: Proportions): Part[] {
  const span = 0.36;
  return [
    { shape: poly([
      [0.47, 0.42],
      [0.5 - span, 0.12],
      [0.42 - span, 0.27],
      [0.42, 0.48],
    ]), tone: "base" },
    { shape: poly([
      [0.47, 0.56],
      [0.5 - span, 0.86],
      [0.42 - span, 0.71],
      [0.42, 0.5],
    ]), tone: "base" },
    { shape: ellipse(0.5, 0.49, 0.08, 0.07), tone: "dark" },
    { shape: ellipse(0.62, 0.49, 0.07 * p.head, 0.058 * p.head), tone: "base" },
    { shape: taper(0.66, 0.49, 0.93, 0.49, 0.032 * p.head, 0.011), tone: "base" },
    ...eye(0.63, 0.46, 0.058 * p.head, p),
  ];
}

function swarmInv(p: Proportions): Part[] {
  return scaleParts(
    [
      { shape: taper(0.3, 0.6, 0.1, 0.5, limb(0.05, p), 0.012), tone: "base" },
      { shape: ellipse(0.48, 0.62, 0.15, 0.095, -0.15), tone: "base" },
      { shape: taper(0.46, 0.7, 0.4, GROUND, limb(0.032, p), limb(0.024, p)), tone: "dark" },
      { shape: taper(0.56, 0.69, 0.6, GROUND, limb(0.032, p), limb(0.024, p)), tone: "base" },
      { shape: taper(0.58, 0.57, 0.72, 0.46, limb(0.04, p), limb(0.03, p)), tone: "base" },
      { shape: ellipse(0.75, 0.44, 0.07 * p.head, 0.052 * p.head, -0.2), tone: "base" },
      ...eye(0.77, 0.42, 0.052 * p.head, p),
    ],
    0.62,
  );
}

function splitterInv(p: Proportions): Part[] {
  const parts = invaderBody(p, p.head);
  // the seam: the body is cut, so it already looks like two animals
  const seam = taper(0.44, 0.4, 0.4, 0.78, 0.016, 0.016);
  const cut = parts.map((part) =>
    part.detail ? part : { ...part, shape: subtract(part.shape, seam) },
  );
  cut.push({ shape: taper(0.44, 0.44, 0.405, 0.74, 0.008, 0.008), tone: "accent", detail: true });
  return cut;
}

function regeneratorInv(p: Proportions): Part[] {
  const parts = invaderBody(p, p.head);
  parts.push({ shape: poly([
    [0.38, 0.5],
    [0.5, 0.58],
    [0.38, 0.66],
    [0.44, 0.58],
  ]), tone: "light", detail: true });
  return parts;
}

function shieldedInv(p: Proportions): Part[] {
  const parts = invaderBody(p, p.head);
  // a bracket carried in front: drawn over the head outline so it reads as
  // held, not grown
  parts.push({ shape: subtract(ellipse(0.78, 0.5, 0.2, 0.26), ellipse(0.72, 0.5, 0.18, 0.24)), tone: "accent", detail: true });
  return parts;
}

function bossInv(p: Proportions): Part[] {
  const parts: Part[] = [
    { shape: taper(0.26, 0.56, 0.04, 0.76, limb(0.09, p), 0.02), tone: "base" },
    { shape: ellipse(0.44, 0.54, 0.24, 0.2, -0.16), tone: "base" },
    { shape: taper(0.38, 0.68, 0.32, GROUND, limb(0.07, p), limb(0.052, p)), tone: "dark" },
    { shape: taper(0.54, 0.67, 0.6, GROUND, limb(0.072, p), limb(0.054, p)), tone: "base" },
    { shape: taper(0.58, 0.42, 0.7, 0.32, limb(0.1, p), limb(0.09, p)), tone: "base" },
    { shape: ellipse(0.77, 0.28, 0.155 * p.head, 0.11 * p.head, 0.08), tone: "base" },
    { shape: taper(0.73, 0.35, 0.93, 0.37, 0.036 * p.head, 0.028 * p.head), tone: "dark" },
    ...eye(0.81, 0.24, 0.105 * p.head, p),
  ];
  // the crown: six spines over the back, the thing that says "this one is different"
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = 0.26 + t * 0.4;
    const h = 0.14 + Math.sin(t * Math.PI) * 0.1;
    parts.push({ shape: spikeTri(x, 0.44 - t * 0.04, x + 0.01, 0.44 - t * 0.04 - h, 0.026, p), tone: "accent" });
  }
  for (let i = 0; i < 4; i++) {
    parts.push({ shape: spikeTri(0.74 + i * 0.05, 0.33, 0.75 + i * 0.05, 0.4, 0.014, p), tone: "light", detail: true });
  }
  return parts;
}

export const ARCHETYPE_SILHOUETTE: Record<Archetype, (p: Proportions) => Part[]> = {
  normal: normalInv,
  fast: fastInv,
  tank: tankInv,
  flying: flyingInv,
  swarm: swarmInv,
  splitter: splitterInv,
  regenerator: regeneratorInv,
  shielded: shieldedInv,
  boss: bossInv,
};

export { GROUND, union };
