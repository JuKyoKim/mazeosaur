import { describe, expect, it } from "vitest";
import { hatchlings } from "@mazeosaur/content";
import { CANVAS_H, CANVAS_W } from "../src/theme.js";
import {
  CONTENT_RIGHT,
  GUTTER,
  HUD_H,
  HUD_Y,
  MIN_HIT,
  ROW1,
  ROW2,
  ROW3,
  TOAST,
  TYPE,
  kindButtonX,
  pt,
} from "../src/layout.js";

/**
 * The HUD is geometry, so it can be checked without a browser. Two classes
 * of defect have actually shipped here: a control under the 44pt hit floor
 * (every button in the M2 HUD was, and nobody noticed because it is fine
 * under a mouse), and two elements overlapping because each was positioned
 * against a different edge. Both are arithmetic, and arithmetic belongs in a
 * test rather than in a screenshot somebody has to squint at.
 */

/** Every box a finger is supposed to be able to hit. */
const TOUCH_TARGETS = {
  Send: ROW1.send,
  "speed toggle": ROW1.speed,
  "kind button": ROW3.kindButton,
  Grow: ROW3.grow,
  Sell: ROW3.sell,
};

type Box = { x: number; y: number; w: number; h: number };
const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;
const overlaps = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

describe("the hit-target floor", () => {
  it("is 82 logical pixels, which is 44.4pt on the reference phone", () => {
    expect(MIN_HIT).toBe(82);
    expect(pt(MIN_HIT)).toBeGreaterThanOrEqual(44);
  });

  for (const [name, box] of Object.entries(TOUCH_TARGETS)) {
    it(`${name} clears 44pt in both axes`, () => {
      expect(pt(box.w), `${name} is ${pt(box.w)}pt wide`).toBeGreaterThanOrEqual(44);
      expect(pt(box.h), `${name} is ${pt(box.h)}pt tall`).toBeGreaterThanOrEqual(44);
    });
  }
});

describe("the three rows", () => {
  it("spend the HUD exactly, and the HUD anchors to the bottom of the canvas", () => {
    expect(ROW1.h + ROW2.h + ROW3.h).toBe(HUD_H);
    expect(HUD_Y + HUD_H).toBe(CANVAS_H);
    expect(ROW1.y).toBe(HUD_Y);
    expect(ROW2.y).toBe(bottom({ ...ROW1, x: 0, w: CANVAS_W }));
    expect(ROW3.y).toBe(bottom({ ...ROW2, x: 0, w: CANVAS_W }));
    expect(bottom({ ...ROW3, x: 0, w: CANVAS_W })).toBe(CANVAS_H);
  });

  it("keep every row-1 element inside its row and inside the gutters", () => {
    const boxes: Box[] = [ROW1.meatIcon, ROW1.eggIcon, ROW1.send, ROW1.speed];
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(right(b)).toBeLessThanOrEqual(CONTENT_RIGHT);
      expect(b.y).toBeGreaterThanOrEqual(ROW1.y);
      expect(bottom(b)).toBeLessThanOrEqual(ROW1.y + ROW1.h);
    }
  });

  it("never overlap two row-1 boxes", () => {
    const boxes = Object.entries({
      meatIcon: ROW1.meatIcon,
      eggIcon: ROW1.eggIcon,
      send: ROW1.send,
      speed: ROW1.speed,
    });
    for (const [an, a] of boxes) {
      for (const [bn, b] of boxes) {
        if (an >= bn) continue;
        expect(overlaps(a, b), `${an} overlaps ${bn}`).toBe(false);
      }
    }
  });

  it("leave the migration counter a column that stops short of Send", () => {
    expect(ROW1.migrationLabel.x + ROW1.migrationWrap).toBeLessThan(ROW1.send.x);
    // The label sits above the value, and both inside the row.
    expect(ROW1.migrationLabel.y).toBeLessThan(ROW1.migrationValue.y);
    expect(ROW1.migrationValue.y + TYPE.body).toBeLessThanOrEqual(ROW1.y + ROW1.h);
  });
});

describe("row 3, the tray", () => {
  it("fits one kind button per hatchling across the content width", () => {
    const kb = ROW3.kindButton;
    expect(kindButtonX(0)).toBe(GUTTER);
    expect(right({ x: kindButtonX(hatchlings.length - 1), y: kb.y, w: kb.w, h: kb.h })).toBeLessThanOrEqual(
      CONTENT_RIGHT,
    );
    for (let i = 1; i < hatchlings.length; i++) {
      expect(kindButtonX(i) - right({ x: kindButtonX(i - 1), y: kb.y, w: kb.w, h: kb.h })).toBe(kb.gap);
    }
  });

  it("stacks the button's art, name and cost without leaving the button", () => {
    const kb = ROW3.kindButton;
    expect(ROW3.kindArt.dy + ROW3.kindArt.h).toBeLessThanOrEqual(ROW3.kindName.dy);
    expect(ROW3.kindName.dy + TYPE.label).toBeLessThanOrEqual(ROW3.kindCost.dy);
    expect(ROW3.kindCost.dy + TYPE.label).toBeLessThanOrEqual(kb.h);
  });

  it("gives the sheet four lines that do not collide with Grow or Sell", () => {
    const lines = [
      { y: ROW3.sheetName.y, size: TYPE.title },
      { y: ROW3.sheetKind.y, size: TYPE.label },
      { y: ROW3.sheetStats.y, size: TYPE.body },
      { y: ROW3.sheetRange.y, size: TYPE.label },
    ];
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1];
      const cur = lines[i];
      if (!prev || !cur) throw new Error("line table is wrong");
      expect(prev.y + prev.size, `sheet line ${i} overlaps line ${i - 1}`).toBeLessThanOrEqual(cur.y);
    }
    const last = lines[lines.length - 1];
    if (!last) throw new Error("line table is wrong");
    expect(last.y + last.size).toBeLessThanOrEqual(ROW3.y + ROW3.h);
    // The text column ends before Grow begins, so the genus never runs
    // under the buttons however long the name is.
    expect(ROW3.sheetName.x + ROW3.sheetName.w).toBeLessThanOrEqual(ROW3.grow.x);
    expect(overlaps(ROW3.grow, ROW3.sell)).toBe(false);
    expect(right(ROW3.sell)).toBeLessThanOrEqual(CONTENT_RIGHT);
  });

  it("holds the genus column at 15 characters, the longest name in the content", () => {
    const longest = Math.max(...hatchlings.map((h) => h.name.length));
    // Rhamphorhynchus is the longest hatchling; Argentinosaurus ties it at
    // stage 3. The column exists so neither truncates.
    expect(longest).toBe(15);
    expect(ROW3.sheetName.w).toBe(272);
  });
});

describe("row 2 and the toast", () => {
  it("faces two variable strings at each other without letting them meet", () => {
    const leftWrapEnd = CONTENT_RIGHT - ROW2.metaW - 12;
    expect(ROW2.text.x).toBeLessThan(leftWrapEnd);
    expect(ROW2.chip.x + ROW2.chip.w).toBeLessThanOrEqual(ROW2.text.x);
    expect(bottom(ROW2.chip)).toBeLessThanOrEqual(ROW2.y + ROW2.h);
  });

  it("puts the toast over the board and never into the HUD", () => {
    expect(bottom(TOAST)).toBeLessThanOrEqual(HUD_Y);
    expect(TOAST.x).toBe(GUTTER);
    expect(right(TOAST)).toBe(CONTENT_RIGHT);
    expect(TOAST.holdMs).toBeGreaterThan(TOAST.fadeMs);
  });
});

describe("the type scale", () => {
  it("never drops below 19 logical pixels, which is already only 10.3pt", () => {
    for (const [name, size] of Object.entries(TYPE)) {
      expect(size, `${name} is ${pt(size)}pt`).toBeGreaterThanOrEqual(19);
    }
    expect(TYPE.vital).toBeGreaterThan(TYPE.title);
    expect(TYPE.title).toBeGreaterThan(TYPE.body);
    expect(TYPE.body).toBeGreaterThan(TYPE.label);
  });
});
