// The shipped atlas has to describe the sprites that are in it.
//
// This exists because it did not. `meta.authored` was reduced out of the
// packed frames with a `Math.max`, and the invaders atlas genuinely mixes two
// authored squares — the boss is rendered at `spritePx * 2` — so it shipped
// `authored: 128` for an atlas whose other 46 frames were drawn at 64. A
// client reading that file draws every non-boss invader at half size.
//
// Nothing else could see it. The board frames blit the in-memory untrimmed
// sprite, so looking at the rendered canvas cannot catch it, and `art:verify`
// compares `docs/art/*.png` rather than `packages/game/assets`. So the
// assertion is the one the architect named in review: the scale a client
// derives from `meta` reproduces, for every frame, the size the board frames
// draw — which is the only picture anyone has actually looked at.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPE_TELL, type Archetype } from "../bestiary.js";
import { CHOSEN, KINDS } from "../directions.js";
import { CELL_PX, DRAW_CELLS } from "../layout.js";
import { INVADER_BOX_CELLS, INVADER_FRAMES, dinoSprite, inkBox, invaderSprite, strikeFit } from "../sprites.js";
import { BLOCK_SPAN } from "../blocks.js";
import { STRIKE_FRAMES, STRIKE_SEQUENCE } from "../strikes.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ARCHETYPES = Object.keys(ARCHETYPE_TELL) as Archetype[];

interface Meta {
  authored: number;
  cell: number;
  drawCells: number;
}

interface AtlasFile {
  frames: Record<string, { frame: { w: number; h: number }; sourceSize: { w: number; h: number }; trimmed: boolean }>;
  meta: Meta;
}

const load = (name: string): AtlasFile =>
  JSON.parse(readFileSync(join(ROOT, "packages", "game", "assets", CHOSEN.id, name), "utf8")) as AtlasFile;

const dinos = load("dinos.json");
const invaders = load("invaders.json");
const strikes = load("strikes.json");

describe(`the ${CHOSEN.id} atlas`, () => {
  it("carries the direction's authored square, not one reduced out of the frames", () => {
    // 64 for Toy Box. The invaders atlas is the one that cannot derive it:
    // its boss frames come from a 128px square and its other 46 do not.
    // The strikes atlas is the same case for the same reason: every one of
    // its frames is a 128px square and `authored` is still 64, because a
    // strike is drawn at the world scale of the animal that threw it.
    for (const a of [dinos, invaders, strikes]) {
      expect(a.meta.authored).toBe(CHOSEN.spritePx);
      expect(a.meta.cell).toBe(CELL_PX);
      expect(a.meta.drawCells).toBe(DRAW_CELLS);
    }
  });

  it("places every dinosaur exactly where the board frame draws it", () => {
    const scale = (dinos.meta.cell * dinos.meta.drawCells) / dinos.meta.authored;
    for (const kind of KINDS) {
      for (const stage of [1, 2, 3] as const) {
        const sprite = dinoSprite(kind, stage, CHOSEN);
        const ink = inkBox(sprite);
        const f = dinos.frames[`${kind}-${stage}`];
        expect(f, `${kind}-${stage} is in the atlas`).toBeDefined();
        if (!f) continue;
        // A packed frame is the ink, which is what makes setOrigin(0.5, 1)
        // land on the feet.
        expect(f.frame.w).toBe(ink.w);
        expect(f.frame.h).toBe(ink.h);
        expect(f.sourceSize.w).toBe(ink.w);
        expect(f.trimmed).toBe(false);
        // The board frame's own scale, from blitAnchored.
        const board = (CELL_PX * DRAW_CELLS) / sprite.w;
        expect(scale).toBeCloseTo(board, 10);
      }
    }
  });

  it("sizes every invader the way the board frame does, boss included", () => {
    // The client's rule: one scale for the whole atlas, times the box in
    // cells, and the boss gets no multiplier because its 2x is in the ink.
    const scale = invaders.meta.cell / invaders.meta.authored;
    for (const a of ARCHETYPES) {
      for (const kind of KINDS) {
        const sprite = invaderSprite(a, kind, CHOSEN);
        const ink = inkBox(sprite);
        const f = invaders.frames[`${a}-${kind}`];
        expect(f, `${a}-${kind} is in the atlas`).toBeDefined();
        if (!f) continue;
        expect(f.frame.w).toBe(ink.w);
        expect(f.frame.h).toBe(ink.h);

        const boxCells = INVADER_BOX_CELLS(a) / INVADER_FRAMES(a);
        const fromAtlas = f.frame.w * scale * boxCells;
        // What the board frame draws: the authored square scaled into its
        // box, so the ink comes out at this many logical pixels.
        const onBoard = ink.w * ((CELL_PX * INVADER_BOX_CELLS(a)) / sprite.w);
        expect(fromAtlas, `${a}-${kind} draws at the board frame's size`).toBeCloseTo(onBoard, 10);
      }
    }
  });

  it("keeps every strike frame whole, so its place in the cell survives the pack", () => {
    // The one set that is packed untrimmed, and the assertion that says so.
    // A strike's geometry *is* its position inside the square — the club is
    // out to one side, the dive comes in from above — so trimming it to the
    // ink would centre three different moments of a swing on top of each
    // other and the swing would be gone. The frames therefore all measure
    // the full double square, and the client's anchor is the square's own
    // centre rather than anything it has to look up.
    const n = CHOSEN.spritePx * STRIKE_FRAMES;
    for (const kind of KINDS) {
      for (const step of STRIKE_SEQUENCE) {
        const f = strikes.frames[`strike-${kind}-${step}`];
        expect(f, `strike-${kind}-${step} is in the atlas`).toBeDefined();
        if (!f) continue;
        expect(f.frame.w).toBe(n);
        expect(f.frame.h).toBe(n);
        expect(f.sourceSize.w).toBe(n);
        expect(f.sourceSize.h).toBe(n);
        expect(f.trimmed).toBe(false);
      }
    }
    expect(Object.keys(strikes.frames).length).toBe(KINDS.length * STRIKE_SEQUENCE.length);
  });

  it("draws a strike at the world scale of the dinosaur that threw it", () => {
    // A strike frame is two authored squares wide and `meta.authored` is
    // still one, so the client's ordinary scale rule — the same four lines
    // it uses for a dinosaur — makes one world unit the same length in both.
    // Getting this wrong is the boss trap in reverse: read the frame's own
    // 128 as the denominator and every strike comes out at half the size of
    // the animal swinging it.
    const strikeScale = (strikes.meta.cell * strikes.meta.drawCells) / strikes.meta.authored;
    const dinoScale = (dinos.meta.cell * dinos.meta.drawCells) / dinos.meta.authored;
    expect(strikeScale).toBeCloseTo(dinoScale, 10);
    // And the pixels-per-world-unit that the renderer actually used.
    const perUnit = (n: number, span: number) => (n * 0.88) / span;
    expect(perUnit(CHOSEN.spritePx * STRIKE_FRAMES, strikeFit().span) * strikeScale).toBeCloseTo(perUnit(CHOSEN.spritePx, BLOCK_SPAN) * dinoScale, 10);
    // The strike therefore covers STRIKE_FRAMES times the dinosaur's own
    // draw box: 2.5 cells against 1.25, which is section 5.4's "1-3 cells".
    expect(CHOSEN.spritePx * STRIKE_FRAMES * strikeScale).toBeCloseTo(CELL_PX * DRAW_CELLS * STRIKE_FRAMES, 10);
  });
});
