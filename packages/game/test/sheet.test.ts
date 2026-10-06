import { describe, expect, it } from "vitest";
import { content } from "@mazeosaur/content";
import { CELL, TICKS_PER_SECOND } from "@mazeosaur/sim";
import { sheetLines } from "../src/sheet.js";
import { SHEET_COL_W, TYPE } from "../src/layout.js";

const defs = Object.values(content.dinos);

/**
 * The sheet's four lines are a design decision about what a player needs,
 * and the defect they fix is a regression one edit away: merging them back
 * into one string is the obvious "simplification", and it is what put a
 * 558px line in a 272px column and ran it under the Grow and Sell buttons.
 *
 * Width itself cannot be asserted here — the font is the platform's and
 * these tests have no canvas. `tests/client/dino-sheet.spec.ts` measures
 * all four lines for all 18 defs in the running client. What is assertable
 * without a browser is the *shape*: which fact is on which line, and a
 * character budget loose enough never to fire on type metrics but tight
 * enough to catch a line that has absorbed another one.
 */
describe("the dinosaur sheet's four lines", () => {
  it("covers every def in the content", () => {
    expect(defs.length).toBe(18);
  });

  it("puts the genus alone on the name line, so it is never truncated", () => {
    for (const def of defs) {
      expect(sheetLines(def).name).toBe(def.name);
    }
    // 15 characters is what SHEET_COL_W was sized for; a longer genus is a
    // content change that has to re-measure the column, not one that
    // silently overflows it.
    expect(Math.max(...defs.map((d) => d.name.length))).toBe(15);
  });

  it("names the family and the growth stage on the kind line", () => {
    const stages = new Set(defs.map((d) => sheetLines(d).kind.split(" ")[1]));
    expect([...stages].sort()).toEqual(["adult", "hatchling", "juvenile"]);
    for (const def of defs) {
      expect(sheetLines(def).kind.startsWith(def.kind)).toBe(true);
    }
  });

  it("keeps the stats line to the two comparable numbers", () => {
    for (const def of defs) {
      const { stats } = sheetLines(def);
      const dps = ((def.damage * TICKS_PER_SECOND) / def.cooldown).toFixed(1);
      expect(stats).toBe(`${dps} dmg/s · range ${(def.range / CELL).toFixed(1)}`);
      // The modifiers are the extras line's. A stats line that has grown a
      // "splash" is the single string coming back.
      for (const word of ["splash", "slow", "stun", "targets", "hits"]) {
        expect(stats, `"${word}" belongs on the extras line`).not.toContain(word);
      }
    }
  });

  it("puts targeting and every modifier on the extras line", () => {
    for (const def of defs) {
      const { extras } = sheetLines(def);
      // "hits" keeps its verb: bare "ground" reads as where the dinosaur
      // stands, not as what it can shoot, and that difference is a leak.
      expect(extras.startsWith(`hits ${def.targets}`)).toBe(true);
      expect(extras.includes("splash")).toBe(def.splash !== undefined);
      expect(extras.includes("slow")).toBe(def.slow !== undefined);
      expect(extras.includes("stun")).toBe(def.stun !== undefined);
      expect(extras.includes("targets")).toBe((def.targetCount ?? 1) > 1);
    }
  });

  /**
   * Character caps, not a font model. Each one is the longest the shipped
   * content actually produces, and beside it is what that string measured
   * in the running client at its own `TYPE` size. `SHEET_COL_W` is 304, so
   * the widest line has 8px of room — which is also why these are caps and
   * not a guideline: a content edit that lengthens one of them has to
   * re-measure the column, and this is the test that says so in under a
   * second instead of leaving it to a browser nobody runs.
   */
  it("holds every line to the length the column was measured against", () => {
    const longest = (pick: (l: ReturnType<typeof sheetLines>) => string) =>
      Math.max(...defs.map((d) => pick(sheetLines(d)).length));
    expect(longest((l) => l.name), "genus, 242px at TYPE.title").toBe(15);
    expect(longest((l) => l.kind), "'longneck hatchling', 179px at TYPE.label").toBe(18);
    expect(longest((l) => l.stats), "'153.8 dmg/s · range 2.6', 264px at TYPE.body").toBe(23);
    expect(longest((l) => l.extras), "a longneck adult's modifiers, 296px at TYPE.label").toBe(31);
    expect(SHEET_COL_W).toBeGreaterThanOrEqual(296);
    expect(TYPE.title).toBeGreaterThan(TYPE.body);
  });
});
