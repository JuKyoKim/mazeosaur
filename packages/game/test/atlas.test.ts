import { describe, expect, it } from "vitest";
import type { Kind } from "@mazeosaur/sim";
import { STRIKE_FRAMES, TOY_BOX_SCALE } from "../src/atlas.js";
import strikes from "../assets/toy-box/strikes.json";
import dinos from "../assets/toy-box/dinos.json";
import invaders from "../assets/toy-box/invaders.json";
import { CELL_PX } from "../src/layout.js";

/**
 * The seam between the designer's atlas and the renderer that names frames
 * out of it. Both halves are checked in, so a mismatch is a test failure
 * here rather than a silently missing texture on a real board — Phaser logs
 * a warning for a frame it cannot find and draws the whole texture instead,
 * which on a 512px sheet is the entire atlas splattered over one cell.
 *
 * Driving the client proves the strike renders; this proves it renders for
 * every kind, which no reasonable number of screenshots does.
 */

/**
 * Every kind, as a `Record` so that the compiler is the thing that notices
 * a seventh. A list would just quietly stay five-sixths complete.
 */
const ALL_KINDS: Record<Kind, true> = {
  tyrant: true,
  longneck: true,
  horned: true,
  raptor: true,
  flier: true,
  armored: true,
};
const KINDS = Object.keys(ALL_KINDS) as Kind[];

describe("the toy-box atlases", () => {
  it("agree on the geometry the renderer scales by", () => {
    // One rule for all three, which is what lets `TOY_BOX_SCALE` be a
    // single number read off one of them.
    for (const meta of [strikes.meta, dinos.meta, invaders.meta]) {
      expect(meta.authored).toBe(64);
      expect(meta.cell).toBe(36);
      expect(meta.drawCells).toBe(1.25);
    }
  });

  it("are authored for the cell the client actually draws", () => {
    // The atlases and `layout.ts` each hold a cell size. If they diverge,
    // every sprite is drawn at the wrong fraction of its cell while every
    // position is still right, which reads as art that is subtly too big
    // rather than as a bug.
    expect(strikes.meta.cell).toBe(CELL_PX);
  });

  it("scale a strike by the authored square, not by the frame", () => {
    // 45/64, and the trap is that it is not 45/128. A strike frame is two
    // authored squares wide to buy the swing its reach at the animal's own
    // world scale, so the frame's own width is never the denominator.
    expect(TOY_BOX_SCALE).toBeCloseTo(45 / 64, 10);
    const frame = strikes.frames["strike-tyrant-2"];
    expect(frame.frame.w).toBe(2 * strikes.meta.authored);
    expect(frame.frame.w * TOY_BOX_SCALE).toBeCloseTo(2 * CELL_PX * strikes.meta.drawCells, 10);
  });

  it("are packed untrimmed, because a strike's offset in its square is content", () => {
    // Trimming would move each frame's ink to its own bounding box, and the
    // renderer anchors every step at the cell centre — so a trimmed atlas
    // would re-centre the swing and flatten the motion between steps.
    for (const frame of Object.values(strikes.frames)) {
      expect(frame.trimmed).toBe(false);
      expect(frame.spriteSourceSize.x).toBe(0);
      expect(frame.spriteSourceSize.y).toBe(0);
    }
  });
});

describe("the strike frame table", () => {
  it("names a frame the atlas really has, for every kind and step", () => {
    const names = new Set(Object.keys(strikes.frames));
    for (const kind of KINDS) {
      for (const name of STRIKE_FRAMES[kind]) {
        expect(names.has(name), `${name} is not a frame in strikes.json`).toBe(true);
      }
    }
  });

  it("forgets no strike the atlas ships", () => {
    // The other direction, and the one that catches a kind gaining a
    // fourth step or a seventh kind arriving in the art before the table:
    // art the client cannot name is art nobody will see.
    const tabled = new Set(KINDS.flatMap((kind) => [...STRIKE_FRAMES[kind]]));
    const shipped = Object.keys(strikes.frames).filter((name) => name.startsWith("strike-"));
    expect([...shipped].sort()).toEqual([...tabled].sort());
  });

  it("gives each kind the three steps in order", () => {
    for (const kind of KINDS) {
      expect(STRIKE_FRAMES[kind]).toEqual([`strike-${kind}-1`, `strike-${kind}-2`, `strike-${kind}-3`]);
    }
  });
});
