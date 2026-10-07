/// <reference path="./assets.d.ts" />
import type Phaser from "phaser";
import type { Archetype, Kind, Stage } from "@mazeosaur/sim";

// The PNG as a URL the bundler emits, the JSON by value. Decision 0005,
// `docs/decisions/0005-atlases-reach-the-client-through-the-bundler.md`:
// nothing is copied into `apps/web/public/`, because `public/sw.js` serves
// cache-first for `/assets/`, the manifest and the icons and for nothing
// else — a file at `/toy-box/strikes.png` is never cached, so the first
// migration played offline would draw no art while the shell around it
// loaded fine. A bundler-emitted asset lands under `/assets/` with a
// content hash, which covers it with no change to `sw.js` and makes a
// regenerated atlas unable to pair with a cached old one.
import dinosPng from "../assets/toy-box/dinos.png?url";
import invadersPng from "../assets/toy-box/invaders.png?url";
import strikesPng from "../assets/toy-box/strikes.png?url";
// `resolveJsonModule` is in `tsconfig.base.json` rather than in this
// package's own, because three projects compile this file: `packages/game`
// itself, `apps/web` through the workspace symlink, and `tests/client`
// through the package's types.
import dinos from "../assets/toy-box/dinos.json";
import invaders from "../assets/toy-box/invaders.json";
import strikes from "../assets/toy-box/strikes.json";

/**
 * The texture keys, so a scene names an atlas once and a typo is a compile
 * error rather than an invisible missing texture.
 */
export const ATLAS = {
  dinos: "dinos",
  invaders: "invaders",
  strikes: "strikes",
} as const;

/**
 * How big a toy-box sprite is drawn, taken off the atlas's own `meta`
 * rather than retyped here — which is the whole reason §5.5's two traps are
 * survivable.
 *
 * **Not the frame's own width.** A strike frame is 128px because it is two
 * authored squares wide, and `meta.authored` is still 64: the double frame
 * buys the swing *reach* at the animal's own world scale, not a bigger
 * drawing. Divide by the frame's 128 and every strike comes out at half the
 * size of the dinosaur throwing it.
 *
 * All three atlases are authored to the same numbers (64 / 36 / 1.25);
 * `atlas.test.ts` pins that they agree, and that `meta.cell` is the
 * `CELL_PX` the rest of the client positions against.
 */
export const TOY_BOX_SCALE = (strikes.meta.cell * strikes.meta.drawCells) / strikes.meta.authored;

/**
 * The square the dinosaur frames were drawn in, before trimming — the
 * denominator of every dinosaur scale. On the board that scale is
 * `TOY_BOX_SCALE`, which folds in §5.0's 1.25 cells; off the board it is
 * not, because a HUD card is a box in its own pixels and has no cell. Both
 * places need the same denominator, so it is exported rather than written
 * as 64 in the one caller that cannot use `TOY_BOX_SCALE`.
 */
export const DINO_AUTHORED = dinos.meta.authored;

/**
 * §5.4.1's eighteen frame names, as a table rather than a template string
 * built per draw: the strike layer re-reads this every frame for every
 * live strike, and a string allocated in the draw path is the thing §2's
 * performance bar rules out.
 *
 * Written out rather than derived so that `Record<Kind, ...>` makes a
 * seventh kind a compile error here — a kind that can be placed and has no
 * strike is a kind whose attack says nothing. `atlas.test.ts` closes the
 * other half, that all eighteen of these are really in `strikes.json` and
 * that the atlas holds no strike this table has forgotten.
 *
 * Indexed by step, 1..3 as 0..2: the wind-up, full extension, and the mark
 * left behind. Step 3 never holds the weapon, which is what keeps the clip
 * from looking like it rewinds while the effect fades on it.
 */
export const STRIKE_FRAMES: Record<Kind, readonly [string, string, string]> = {
  tyrant: ["strike-tyrant-1", "strike-tyrant-2", "strike-tyrant-3"],
  longneck: ["strike-longneck-1", "strike-longneck-2", "strike-longneck-3"],
  horned: ["strike-horned-1", "strike-horned-2", "strike-horned-3"],
  raptor: ["strike-raptor-1", "strike-raptor-2", "strike-raptor-3"],
  flier: ["strike-flier-1", "strike-flier-2", "strike-flier-3"],
  armored: ["strike-armored-1", "strike-armored-2", "strike-armored-3"],
};

/**
 * §5.1's eighteen dinosaur frames, indexed by kind and then by `Stage`.
 *
 * Keyed by the stage's own 1..3 rather than by an array index, so the draw
 * path reads `DINO_FRAMES[kind][def.stage]` with no `- 1` for a reader to
 * check — a hatchling drawn as a juvenile is a bug no test of the atlas
 * could see, because both names are real frames.
 *
 * A table and not a template string for the same reason `STRIKE_FRAMES` is
 * one, and written out for the same reason too: a seventh kind is a
 * compile error here rather than a dinosaur that places fine and draws
 * nothing.
 */
export const DINO_FRAMES: Record<Kind, Record<Stage, string>> = {
  tyrant: { 1: "tyrant-1", 2: "tyrant-2", 3: "tyrant-3" },
  longneck: { 1: "longneck-1", 2: "longneck-2", 3: "longneck-3" },
  horned: { 1: "horned-1", 2: "horned-2", 3: "horned-3" },
  raptor: { 1: "raptor-1", 2: "raptor-2", 3: "raptor-3" },
  flier: { 1: "flier-1", 2: "flier-2", 3: "flier-3" },
  armored: { 1: "armored-1", 2: "armored-2", 3: "armored-3" },
};

/**
 * §5.5's invader box, in cells, per archetype — and the one trap in that
 * section. **The boss is 1 here, not 2.** Its frame is authored in a square
 * twice the size and holds an animal twice the size, so the uniform scale
 * below already draws it big; a 2x multiplier on top draws it at four
 * cells. `swarm` is the only real multiplier in the table: authored at one
 * square like everything else, and genuinely drawn smaller.
 *
 * `Record<Archetype, number>` rather than a lookup with a default, so a
 * tenth archetype is a compile error rather than silently normal-sized.
 */
const INVADER_BOX_CELLS: Record<Archetype, number> = {
  normal: 1,
  fast: 1,
  tank: 1,
  flying: 1,
  swarm: 0.8,
  splitter: 1,
  regenerator: 1,
  shielded: 1,
  boss: 1,
};

/** The kinds, off a `Record<Kind, …>` so the list cannot miss one. */
const KINDS = Object.keys(STRIKE_FRAMES) as Kind[];
/** The archetypes, off a `Record<Archetype, …>` for the same reason. */
const ARCHETYPES = Object.keys(INVADER_BOX_CELLS) as Archetype[];

/** Just enough of the packed JSON to read a frame's drawn size out of it. */
type PackedFrame = { readonly sourceSize: { readonly w: number; readonly h: number } };
const INVADER_PACKED = invaders.frames as Record<string, PackedFrame | undefined>;

/**
 * §5.2's fifty-four invader frames, by archetype and then kind — the one
 * table the draw path reads, because an invader is named every frame for
 * every live invader and `${archetype}-${kind}` allocates a string each
 * time it is asked. Built once here instead.
 */
export const INVADER_FRAMES = Object.fromEntries(
  ARCHETYPES.map((a) => [a, Object.fromEntries(KINDS.map((k) => [k, `${a}-${k}`])) as Record<Kind, string>]),
) as Record<Archetype, Record<Kind, string>>;

/**
 * §5.5's invader scale, per archetype: the authored square into
 * `INVADER_BOX_CELLS` cells. Note this is **not** `TOY_BOX_SCALE` — that
 * carries §5.0's 1.25 draw box, which is a dinosaur's and not an
 * invader's. An invader is not in a cell and is drawn at the cell's own
 * size; using the dinosaur scale draws every invader 25% too big.
 */
export const INVADER_SCALE = Object.fromEntries(
  ARCHETYPES.map((a) => [a, (invaders.meta.cell * (INVADER_BOX_CELLS[a] as number)) / invaders.meta.authored]),
) as Record<Archetype, number>;

/**
 * How big an invader actually comes out, in logical pixels, per archetype.
 *
 * The hp bar and the status rings are sized off the sprite rather than off
 * a radius retyped per archetype, which is what makes them follow a redrawn
 * atlas instead of drifting away from it. Read once here, because reaching
 * into `sprite.displayWidth` per invader per frame is the same lookup done
 * sixty times a frame.
 *
 * Per archetype and not per frame because the six kinds of an archetype are
 * authored at one size — `atlas.test.ts` is what holds that true, and it is
 * a real property of the generator rather than a hope: §5.2 says the
 * archetype owns the shape and the kind only recolours it.
 */
export const INVADER_DRAWN = Object.fromEntries(
  ARCHETYPES.map((a) => {
    const f = INVADER_PACKED[`${a}-${KINDS[0] as Kind}`];
    const s = INVADER_SCALE[a];
    return [a, { w: (f?.sourceSize.w ?? 0) * s, h: (f?.sourceSize.h ?? 0) * s }];
  }),
) as Record<Archetype, { w: number; h: number }>;

/**
 * Queue all three atlases. One call, so a scene's `preload()` is one line
 * and the keys and the `meta` are read in one place.
 *
 * Idempotent across a restart. Phaser skips a key already in the texture
 * cache, so the second `preload()` of a scene queues nothing and a "Play
 * again" pays no load at all.
 */
export function loadToyBox(load: Phaser.Loader.LoaderPlugin): void {
  load.atlas(ATLAS.dinos, dinosPng, dinos);
  load.atlas(ATLAS.invaders, invadersPng, invaders);
  load.atlas(ATLAS.strikes, strikesPng, strikes);
}
