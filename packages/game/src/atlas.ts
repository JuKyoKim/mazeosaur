/// <reference path="./assets.d.ts" />
import type Phaser from "phaser";
import type { Kind } from "@mazeosaur/sim";

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
 * Queue all three atlases. One call, so a scene's `preload()` is one line
 * and the keys and the `meta` are read in one place.
 *
 * All three go in together even though v1 draws only the strikes: the
 * dinosaurs and the invaders are still flat `Graphics` rects, and whether
 * they stop being that is art work on its own issue — not a second load
 * path invented later beside this one.
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
