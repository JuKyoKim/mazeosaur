// The attack effects: six per-kind strikes, three steps each, authored as
// block models in the same unit space and under the same camera as
// `blocks.ts`. The owner asked for this directly — the kind hue reads on the
// board but the attack effect was one tinted line for all six kinds, so the
// effect said *that* a dinosaur was biting and never *which* one.
//
// The division of labour matters and is the reason these are small:
//
//   the tracer  says which invader is being hit — it already does, in the
//               kind hue, and nothing here replaces it
//   the strike  says which kind is hitting — one silhouette per family,
//               drawn on the dinosaur's own cell and nowhere else
//
// Two channels, one job each. A strike that also had to point at the target
// would need to rotate, and an isometric block render cannot be rotated
// without reading as a different camera.
//
// **Six strikes, six silhouettes**, chosen so the shape alone separates them
// at a 36px cell with sixty invaders on the board. The shapes are a V, a
// ring, a line, an arc, a diagonal and a ball; no two of them can be
// confused at any size, which is the bar section 3 sets for the kinds
// themselves:
//
//   tyrant    bite         two converging wedges, forward, horizontal
//   longneck  stomp        a flat slab and a flat ring, at ground level
//   horned    horn charge  one long thin spike, the longest reach
//   raptor    leap         a stepped crescent arcing over the top
//   flier     dive         a narrow dart descending steeply
//   armored   tail club    a ball on a stalk, swung laterally
//
// Every one is the animal's own weapon from the palaeontology, not from a
// film: the ankylosaur's tail club and the ceratopsian's brow horn are
// skeletal facts, the dromaeosaur's single pounce is the raptor
// prey-restraint model, and the sauropod stomps because it is the heaviest
// thing in the valley. Nothing here spits, and nothing hunts in a pack.
//
// Not shipped. This writes what ships.

import { box, type Box } from "./voxel.js";
import type { Kind } from "./directions.js";

/**
 * How many steps a strike has. Three is the smallest number that reads as a
 * swing rather than a blink: a wind-up that shows where the weapon was, a
 * strike at full extension, and a follow-through that is the mark left
 * behind rather than the weapon itself.
 *
 * Step 3 never contains the weapon. That is the rule that keeps the clip
 * from looking like it rewinds when the client holds the last frame.
 */
export const STRIKE_STEPS = 3;
export type StrikeStep = 1 | 2 | 3;
export const STRIKE_SEQUENCE: readonly StrikeStep[] = [1, 2, 3];

/**
 * How many authored squares wide a strike frame is.
 *
 * Two, for the same reason the boss is two: a strike reaches past the cell
 * the dinosaur stands in — section 5.4 allows the hit one to three cells —
 * and a double-size frame buys that room *at the dinosaur's own world
 * scale* rather than drawing the effect twice as large. `strikeFit` below is
 * what makes that true.
 */
export const STRIKE_FRAMES = 2;

// --------------------------------------------------------------- the strikes

/**
 * Tyrannosaurid: a **bite**. Two wedges forward of the head that close on
 * the line the animal is already facing, then let go.
 *
 * The wedges are `accent` because a tooth is a different material from a
 * hide, exactly as the bestiary's teeth and claws are.
 */
function bite(step: StrikeStep): Box[] {
  // Each jaw is two boxes, not one: a stepped wedge reads as a jaw, and the
  // single slab the first pass used read as a brick with the V gone.
  const jaw = (y: number, tone: Box["tone"] = "accent"): Box[] => [box(0.8, y, 0.38, 0.26, 0.09, 0.22, tone), box(1.04, y + 0.015, 0.41, 0.2, 0.06, 0.16, tone)];
  if (step === 1) {
    return [
      ...jaw(0.6), // open high
      ...jaw(0.24), // open low
      box(0.86, 0.56, 0.46, 0.22, 0.045, 0.06, "glint"), // the teeth that show
      box(0.86, 0.335, 0.46, 0.22, 0.045, 0.06, "glint"),
    ];
  }
  if (step === 2) {
    // Shut, but not merged: 0.08 of air between the wedges, lit, so the
    // closed bite is still two shapes and a line rather than one block.
    return [...jaw(0.52), ...jaw(0.3), box(0.82, 0.455, 0.37, 0.4, 0.035, 0.24, "ink")];
  }
  return [
    box(0.84, 0.4, 0.4, 0.3, 0.04, 0.18, "glint"), // what is left of the seam
    box(1.28, 0.56, 0.42, 0.09, 0.09, 0.09, "accent"), // and two shards thrown
    box(1.22, 0.24, 0.5, 0.08, 0.08, 0.08, "accent"),
  ];
}

/**
 * Sauropod: a **stomp**. The forefoot comes down inside the cell and the
 * dust goes out as a flat ring, so this is the one strike whose silhouette
 * is wider than it is tall and the only one centred on the dinosaur rather
 * than reaching past it.
 */
function stomp(step: StrikeStep): Box[] {
  if (step === 1) {
    return [
      box(0.58, 0.72, 0.34, 0.26, 0.14, 0.28, "accent"), // the foot, raised
      box(0.62, 0.005, 0.38, 0.18, 0.012, 0.2, "ink"), // and its shadow, so the height reads
    ];
  }
  if (step === 2) {
    return [
      box(0.58, 0.0, 0.34, 0.26, 0.13, 0.28, "accent"), // landed
      box(0.56, 0.0, 0.32, 0.3, 0.03, 0.32, "glint"), // the flash under it
      box(0.06, 0.0, 0.28, 0.16, 0.08, 0.44, "light"), // the dust ring: four slabs
      box(0.78, 0.0, 0.28, 0.16, 0.08, 0.44, "light"),
      box(0.28, 0.0, 0.06, 0.44, 0.08, 0.16, "light"),
      box(0.28, 0.0, 0.78, 0.44, 0.08, 0.16, "light"),
    ];
  }
  return [
    box(-0.18, 0.0, 0.2, 0.18, 0.04, 0.6, "light"), // the ring, pushed out and flattened
    box(1.0, 0.0, 0.2, 0.18, 0.04, 0.6, "light"),
    box(0.2, 0.0, -0.18, 0.6, 0.04, 0.18, "light"),
    box(0.2, 0.0, 1.0, 0.6, 0.04, 0.18, "light"),
  ];
}

/**
 * Ceratopsian: a **horn charge**. One spike, thrust along the facing and
 * withdrawn. It is the longest reach of the six and the only strike that is
 * a single straight line, which is what makes it unmistakable next to the
 * bite's V.
 */
function hornCharge(step: StrikeStep): Box[] {
  if (step === 1) {
    return [
      box(0.6, 0.22, 0.45, 0.24, 0.07, 0.08, "accent"), // drawn back
      box(0.82, 0.225, 0.46, 0.07, 0.06, 0.06, "glint"),
    ];
  }
  if (step === 2) {
    return [
      box(0.68, 0.22, 0.45, 0.74, 0.075, 0.085, "accent"), // thrust
      box(1.4, 0.21, 0.44, 0.11, 0.095, 0.105, "glint"), // the tip, lit
      box(0.8, 0.34, 0.46, 0.5, 0.03, 0.045, "light"), // two streaks: speed, not shape
      box(0.8, 0.12, 0.46, 0.5, 0.03, 0.045, "light"),
    ];
  }
  // The streaks converge on the point the tip reached rather than running
  // on parallel: two parallel bars with nothing between them read as debris
  // the charge dropped, not as the air it moved.
  return [
    box(1.12, 0.3, 0.46, 0.34, 0.03, 0.042, "light"),
    box(1.12, 0.16, 0.46, 0.34, 0.03, 0.042, "light"),
    box(1.42, 0.17, 0.43, 0.13, 0.13, 0.11, "accent"), // and the dust where the tip was
  ];
}

/**
 * Dromaeosaur: a **leap**. A crouch, a stepped crescent over the top, and
 * the sickle claw hooked down where it landed.
 *
 * The arc is four boxes because three read as a diagonal — the same thing
 * the flier's dive is — and the whole point of the shape is that it crests.
 */
function leap(step: StrikeStep): Box[] {
  if (step === 1) {
    return [
      box(0.1, 0.0, 0.36, 0.3, 0.07, 0.24, "light"), // the push-off dust, behind
      box(0.5, 0.13, 0.44, 0.1, 0.07, 0.08, "accent"), // the claw, tucked
    ];
  }
  if (step === 2) {
    // The arc starts over the animal's own back and crests just above its
    // head. The first pass started it past the head and read as a chain of
    // blocks floating off to one side with nothing to do with the dinosaur.
    return [
      box(0.3, 0.42, 0.42, 0.15, 0.11, 0.11, "accent"), // up
      box(0.49, 0.56, 0.42, 0.15, 0.11, 0.11, "accent"),
      box(0.69, 0.62, 0.42, 0.17, 0.11, 0.11, "accent"), // over
      box(0.9, 0.53, 0.42, 0.15, 0.12, 0.11, "accent"), // and down
      box(1.04, 0.37, 0.41, 0.13, 0.15, 0.13, "glint"), // the claw leading
    ];
  }
  return [
    box(0.56, 0.56, 0.44, 0.14, 0.055, 0.07, "light"), // the tail of the arc
    box(0.78, 0.5, 0.44, 0.14, 0.055, 0.07, "light"),
    box(0.98, 0.12, 0.42, 0.13, 0.22, 0.12, "accent"), // the claw, hooked down
    box(1.0, 0.08, 0.41, 0.1, 0.08, 0.14, "glint"),
  ];
}

/**
 * Pterosaur: a **dive**. The only strike that arrives from above the cell,
 * so its silhouette is a steep diagonal and its wind-up is off the top of
 * the frame's upper half.
 */
function dive(step: StrikeStep): Box[] {
  // Nothing goes above y ≈ 0.95. The frame's top is the one edge a strike
  // can reach: `project`'s v is `(x + z)/2 - y`, so height costs twice what
  // reach does, and the first pass put the wind-up chevron at y = 1.20 and
  // had it clipped off the top of its own square.
  if (step === 1) {
    return [
      box(0.44, 0.83, 0.26, 0.12, 0.07, 0.22, "accent"), // a small chevron, high
      box(0.44, 0.83, 0.52, 0.12, 0.07, 0.22, "accent"),
      box(0.56, 0.83, 0.44, 0.17, 0.055, 0.07, "accent"), // the beak
    ];
  }
  if (step === 2) {
    return [
      box(0.7, 0.34, 0.4, 0.23, 0.1, 0.2, "accent"), // the dart, low and forward
      box(0.93, 0.36, 0.44, 0.19, 0.055, 0.07, "glint"), // the beak, lit
      box(0.58, 0.54, 0.44, 0.12, 0.055, 0.07, "light"), // the trail, up the dive line
      box(0.5, 0.71, 0.44, 0.11, 0.05, 0.06, "light"),
      box(0.44, 0.86, 0.44, 0.1, 0.045, 0.055, "light"),
    ];
  }
  return [
    box(0.78, 0.18, 0.36, 0.12, 0.07, 0.08, "accent"), // the splash, two ticks
    box(0.92, 0.3, 0.5, 0.11, 0.07, 0.08, "accent"),
    box(0.82, 0.24, 0.43, 0.11, 0.11, 0.11, "glint"),
    box(0.56, 0.5, 0.44, 0.11, 0.045, 0.055, "light"), // and the pull-up
  ];
}

/**
 * Ankylosaur: a **tail club**. A ball on a stalk, wound back over the tail
 * and swung through low. It is the only strike that moves across the facing
 * instead of along it, and the ball is the only round silhouette of the six.
 *
 * The ball is nearly head-sized for the same reason it is in `blocks.ts`:
 * at a 36px cell a club smaller than the tail that carries it merges into
 * the body and the tell is gone.
 */
function tailClub(step: StrikeStep): Box[] {
  if (step === 1) {
    return [
      box(0.04, 0.36, 0.44, 0.2, 0.055, 0.075), // the stalk, raised back
      box(-0.24, 0.38, 0.38, 0.24, 0.24, 0.24, "accent"), // the ball, wound up
    ];
  }
  if (step === 2) {
    // The trail is as thick as the stalk, because the first pass drew it at
    // a third of that and it read as three crumbs rather than as a swing.
    return [
      box(0.0, 0.5, 0.43, 0.2, 0.08, 0.09, "light"), // the swing, over the top
      box(0.32, 0.64, 0.43, 0.22, 0.08, 0.09, "light"),
      box(0.66, 0.5, 0.43, 0.2, 0.08, 0.09, "light"),
      box(0.74, 0.1, 0.44, 0.22, 0.055, 0.075), // the stalk, through
      box(0.96, 0.04, 0.34, 0.28, 0.28, 0.28, "accent"), // the ball, at the bottom
      box(1.02, 0.28, 0.4, 0.14, 0.05, 0.16, "glint"), // lit on the near top
    ];
  }
  return [
    box(0.98, 0.0, 0.35, 0.26, 0.26, 0.26, "accent"), // the ball, at rest
    box(0.82, 0.0, 0.2, 0.52, 0.02, 0.54, "ink"), // the ground it hit
    box(1.12, 0.26, 0.48, 0.09, 0.09, 0.09, "glint"),
  ];
}

/**
 * The strike per kind. Keyed by `Kind` rather than by a weapon name so the
 * client builds the frame name from sim state — `strike-<kind>-<step>` —
 * with no lookup table, which is section 5.5's rule for every other frame
 * in the atlas.
 */
export const KIND_STRIKE: Record<Kind, (step: StrikeStep) => Box[]> = {
  tyrant: bite,
  longneck: stomp,
  horned: hornCharge,
  raptor: leap,
  flier: dive,
  armored: tailClub,
};

/** What each kind's strike is, for the spec table and the labelled plate. */
export const STRIKE_NAME: Record<Kind, string> = {
  tyrant: "bite",
  longneck: "stomp",
  horned: "horn charge",
  raptor: "leap",
  flier: "dive",
  armored: "tail club",
};
