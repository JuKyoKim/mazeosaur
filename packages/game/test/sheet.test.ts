import { describe, expect, it } from "vitest";
import { content } from "@mazeosaur/content";
import { CELL, TICKS_PER_SECOND } from "@mazeosaur/sim";
import { growLabel, sheetLines } from "../src/sheet.js";
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
    // 15 characters is the longest genus the content ships, which is why
    // the genus gets a line to itself; the column is sized off the modifier
    // line, not off this. A longer genus is still a content change that has
    // to re-measure the column rather than one that silently overflows it.
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
   * in one running client at its own `TYPE` size.
   *
   * Those px figures are that box's `system-ui` fallback rather than a
   * property of the code — another box resolved a narrower face and
   * measured the four lines non-uniformly smaller — so the room left in the
   * column is not a portable number. What travels is the ordering (the
   * modifier line is the widest) and these caps, which is why they are caps
   * and not a guideline: a content edit that lengthens one of them has to
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

/**
 * The Grow button's label is the fifth string built from content and drawn
 * into a fixed box, and it is the one that was not checked. It shipped as
 * `Grow → Deinonychus` on one line: 202px in a 192px button, and 236px at
 * `Argentinosaurus`. Centred, so it did not clip or run off one edge — it
 * spilled over the sheet column on the left and onto Sell on the right.
 *
 * Width cannot be asserted here either, for the same reason as the sheet's
 * four lines: there is no canvas and the face is the platform's.
 * `tests/client/hud-hit-targets.spec.ts` measures it for all twelve grow
 * targets in a running client. What is assertable without a browser is the
 * shape — which fact is on which line, and a character budget — and the
 * shape is the part that regresses: putting the three back on one line is
 * the obvious tidy-up, and it is the defect.
 */
describe("the Grow button's label", () => {
  const parents = defs.filter((d) => d.growsTo);

  /** The def a parent grows into, and a failure rather than a skip if the id dangles. */
  const target = (parent: (typeof parents)[number]) => {
    const next = content.dinos[parent.growsTo as string];
    if (!next) throw new Error(`${parent.id} grows into ${parent.growsTo}, which is not in content`);
    return next;
  };

  it("covers every dinosaur that can grow", () => {
    expect(parents.length).toBe(12);
  });

  it("gives the verb, the genus and the price a line each", () => {
    for (const parent of parents) {
      const next = target(parent);
      expect(growLabel(next).split("\n")).toEqual(["Grow →", next.name, `${next.cost} meat`]);
    }
  });

  // The genus alone on its line is the whole fix: it is the longest of the
  // three and the only one that grows with the content. `Grow →
  // Argentinosaurus` as one line is 15 + 7 characters and does not fit;
  // `Argentinosaurus` on its own does, with room to spare.
  it("never shares the genus line", () => {
    for (const parent of parents) {
      const next = target(parent);
      expect(growLabel(next).split("\n")[1]).toBe(next.name);
    }
  });

  it("says so rather than disappearing when there is nothing to grow into", () => {
    expect(growLabel(undefined)).toBe("Fully grown");
    expect(growLabel(undefined).split("\n").length).toBe(1);
  });

  /**
   * Caps, with what each line measured in one running client beside it.
   * Those px are that box's `system-ui` fallback, not a property of the
   * code — the browser spec is what enforces the width. This is what fails
   * in under a second when a content edit lengthens a genus, so that the
   * slow answer is a confirmation rather than the first news.
   */
  it("holds every line to the length the button was measured against", () => {
    const lineLengths = parents.flatMap((p) => growLabel(target(p)).split("\n").map((l) => l.length));
    // `Argentinosaurus`, 157px at TYPE.label in a 192px button.
    expect(Math.max(...lineLengths)).toBe(15);
    // One line of the one-line form, for contrast: `Grow → Argentinosaurus`
    // is the string that did not fit, and it is 22.
    expect(Math.max(...parents.map((p) => `Grow → ${target(p).name}`.length))).toBe(22);
  });
});
