import { describe, expect, it } from "vitest";
import { content, hatchlings } from "@mazeosaur/content";
import {
  BOARD_H,
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  CONTENT_RIGHT,
  GRID_H_MAX,
  GRID_W,
  GUTTER,
  HUD_H,
  HUD_Y,
  MIN_HIT,
  ROW1,
  ROW1_WRAP,
  ROW2,
  ROW2_TEXT_WRAP,
  ROW3,
  SELECT_BORDER,
  SHEET_COL_W,
  TOAST,
  TYPE,
  colAt,
  gridTop,
  kindButtonX,
  pt,
  rowAt,
} from "../src/layout.js";

/**
 * The HUD is geometry, so it can be checked without a browser. Two classes of
 * defect have actually shipped here: a control under the 44pt hit floor (every
 * button in the M2 HUD is, and nobody noticed because it is fine under a
 * mouse), and two elements overlapping because each was positioned against a
 * different edge. Both are arithmetic, and arithmetic belongs in a test rather
 * than in a screenshot somebody has to squint at.
 *
 * This covers the *constants*. That `BoardScene` actually builds its controls
 * from them cannot be checked here — it needs a running renderer — and is
 * `tests/client/hud-hit-targets.spec.ts`, which reads the geometry back off
 * the live display objects. Both halves are needed: this file was green for
 * the whole period in which every control on screen was under the floor.
 */

type Box = { x: number; y: number; w: number; h: number };
const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;
const overlaps = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** Every box a finger is supposed to be able to hit. */
const TOUCH_TARGETS = {
  Send: ROW1.send,
  "speed toggle": ROW1.speed,
  "kind button": { ...ROW3.kindButton, x: kindButtonX(0) },
  Grow: ROW3.grow,
  Sell: ROW3.sell,
};

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
    expect(ROW2.y).toBe(ROW1.y + ROW1.h);
    expect(ROW3.y).toBe(ROW2.y + ROW2.h);
    expect(ROW3.y + ROW3.h).toBe(CANVAS_H);
  });

  it("keep every row-1 box inside its row and inside the content column", () => {
    for (const b of [ROW1.meatIcon, ROW1.eggIcon, ROW1.send, ROW1.speed]) {
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

  it("stack the migration label over its value, left of Send", () => {
    expect(ROW1.migrationLabel.x).toBeLessThan(ROW1.send.x);
    expect(ROW1.migrationLabel.y).toBeLessThan(ROW1.migrationValue.y);
    expect(ROW1.migrationValue.y + TYPE.body).toBeLessThanOrEqual(ROW1.y + ROW1.h);
  });

  it("wrap every variable row-1 field at the origin of what is to its right", () => {
    // Row 1 is five variable-length fields on 720px, and it is the one row
    // that over-subscribes itself silently — Phaser draws a long count over
    // its neighbour rather than failing. The wrap is the bound: a field can
    // be no wider than the gap to whatever comes next, so it can only ever
    // break a line, never cross one.
    expect(ROW1.meatValue.x + ROW1_WRAP.meat).toBe(ROW1.eggIcon.x);
    expect(ROW1.eggValue.x + ROW1_WRAP.eggs).toBe(ROW1.migrationLabel.x);
    expect(ROW1.migrationValue.x + ROW1_WRAP.migration).toBe(ROW1.send.x);
    for (const w of Object.values(ROW1_WRAP)) expect(w).toBeGreaterThan(0);
  });
});

describe("row 3, the tray", () => {
  it("fits one kind button per hatchling across the content width", () => {
    const kb = ROW3.kindButton;
    expect(kindButtonX(0)).toBe(GUTTER);
    expect(kindButtonX(hatchlings.length - 1) + kb.w).toBeLessThanOrEqual(CONTENT_RIGHT);
    for (let i = 1; i < hatchlings.length; i++) {
      expect(kindButtonX(i) - (kindButtonX(i - 1) + kb.w)).toBe(kb.gap);
    }
    expect(kb.y).toBe(ROW3.y + 8);
    expect(kb.y + kb.h).toBeLessThanOrEqual(ROW3.y + ROW3.h);
  });

  it("spends a kind card's height on a silhouette, a name and a cost", () => {
    const kb = ROW3.kindButton;
    const art = ROW3.kindArt;
    // Top to bottom, each inside the card. The cost is the last thing in
    // it, so its bottom is what proves the card is not over-filled.
    expect(art.dy).toBeGreaterThan(0);
    expect(art.dy + art.h).toBeLessThanOrEqual(ROW3.kindName.dy);
    expect(ROW3.kindName.dy + TYPE.label).toBeLessThanOrEqual(ROW3.kindCost.dy);
    expect(ROW3.kindCost.dy + TYPE.label).toBeLessThanOrEqual(kb.h);
    // The silhouette fits the card at *both* sizes: §4's third selection
    // channel draws it larger, and a card that only fits at rest would
    // bleed into its neighbour the moment it was selected. 56 and 60 are
    // §4's own pair — it also calls the ratio 1.08, which is 60/56 = 1.071
    // rounded, so the pixels are the number to pin and the ratio is not.
    expect([art.w, art.selectedW]).toEqual([56, 60]);
    expect(art.selectedW).toBeGreaterThan(art.w);
    expect(art.selectedW).toBeLessThanOrEqual(kb.w);
  });

  it("gives the sheet four lines that do not collide with Grow or Sell", () => {
    const lines = [
      { y: ROW3.sheetName.y, size: TYPE.title },
      { y: ROW3.sheetKind.y, size: TYPE.label },
      { y: ROW3.sheetStats.y, size: TYPE.body },
      { y: ROW3.sheetExtras.y, size: TYPE.label },
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
    // The text column ends before Grow begins, so the genus never runs under
    // the buttons however long the name is.
    expect(ROW3.sheetName.x + ROW3.sheetName.w).toBeLessThanOrEqual(ROW3.grow.x);
    expect(overlaps(ROW3.grow, ROW3.sell)).toBe(false);
    expect(right(ROW3.sell)).toBeLessThanOrEqual(CONTENT_RIGHT);
  });

  it("gives all four sheet lines the same column, wide enough for the widest", () => {
    // Rhamphorhynchus is the longest hatchling; Argentinosaurus ties it at
    // stage 3. The column exists so neither truncates — but the genus is
    // not the widest line in it. See `SHEET_COL_W` for the measurements and
    // `sheet.ts` for what each line says.
    expect(Math.max(...hatchlings.map((h) => h.name.length))).toBe(15);
    for (const slot of [ROW3.sheetName, ROW3.sheetKind, ROW3.sheetStats, ROW3.sheetExtras]) {
      expect(slot.w).toBe(SHEET_COL_W);
      expect(slot.x).toBe(ROW3.sheetName.x);
      // The column ends before Grow begins, for every line and not just the
      // genus. One line wider than the column is one line under the button.
      expect(slot.x + slot.w).toBeLessThanOrEqual(ROW3.grow.x);
    }
  });
});

describe("row 2 and the toast", () => {
  it("keeps the chip and its line inside the migration row", () => {
    expect(ROW2.chip.x + ROW2.chip.w).toBeLessThanOrEqual(ROW2.text.x);
    expect(bottom(ROW2.chip)).toBeLessThanOrEqual(ROW2.y + ROW2.h);
    expect(ROW2.text.y + TYPE.label).toBeLessThanOrEqual(ROW2.y + ROW2.h);
  });

  it("gives the migration line and its meta block a fixed edge each", () => {
    // Two variable strings facing each other across one 40px line: the
    // count and genus grow rightwards, the archetype and kind leftwards
    // from the content edge. Both need an anchor and a wrap, or the longest
    // pair lands on top of itself.
    expect(ROW2.meta.right).toBe(CONTENT_RIGHT);
    expect(ROW2.meta.y + TYPE.label).toBeLessThanOrEqual(ROW2.y + ROW2.h);
    expect(ROW2_TEXT_WRAP).toBeGreaterThan(0);
    expect(ROW2.text.x + ROW2_TEXT_WRAP).toBeLessThanOrEqual(ROW2.meta.right - ROW2.meta.w);
  });

  it("puts the toast over the board and never into the HUD", () => {
    expect(bottom(TOAST)).toBeLessThanOrEqual(HUD_Y);
    expect(TOAST.x).toBe(GUTTER);
    expect(right(TOAST)).toBe(CONTENT_RIGHT);
    // The refusal bar is the HUD's one line weight, and the text clears it.
    expect(TOAST.barW).toBe(SELECT_BORDER);
    expect(TOAST.pad).toBeGreaterThan(TOAST.barW);
    expect(TYPE.body).toBeLessThanOrEqual(TOAST.h);
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

/**
 * The grid lives inside the board area; the HUD does not move to meet it.
 * These two facts shared one name until the HUD was specified, and they are
 * equal for the 28-row valley that ships — which is exactly why nothing had
 * broken and why the split needs a test rather than a screenshot.
 */
describe("the grid inside the board area", () => {
  const HEIGHTS = [20, 24, 27, 28];

  it("leaves the HUD where it is however tall the valley is", () => {
    for (const gridH of HEIGHTS) {
      expect(gridTop(gridH) * 2 + gridH * CELL_PX).toBeGreaterThanOrEqual(BOARD_H - 1);
      expect(HUD_Y).toBe(CANVAS_H - HUD_H);
      expect(BOARD_H).toBe(HUD_Y);
    }
  });

  it("centres the grid, and is a no-op for the shipping valley", () => {
    expect(content.valley.height).toBe(GRID_H_MAX);
    expect(gridTop(28)).toBe(0);
    expect(gridTop(24)).toBe(72);
    // Not a multiple of CELL_PX: this is the case an integer divide gets wrong.
    expect(gridTop(27)).toBe(18);
  });

  /**
   * Width has no `gridLeft()` because it does not vary: `GRID_W` is fixed in
   * v1 and `CELL_PX` is derived from it. Height is centred and tested across
   * four values; width is pinned, and a pin needs something holding it.
   *
   * Both halves matter and neither implies the other. If content widened the
   * valley alone, the scene would still draw 36px cells — it bounds columns
   * with `colAt(p.x, v.width)` off content, not off `GRID_W` — and the extra
   * columns would run off the right edge of a 720px canvas. If both moved
   * together, `CELL_PX` would stay 36 and the grid would no longer span the
   * canvas, leaving dead pixels down one side and every sprite at a cell size
   * the atlas was not authored at. Neither shows up in any other test, and
   * both are a content edit away.
   */
  it("pins the valley's width to the grid the cell size is derived from", () => {
    expect(content.valley.width).toBe(GRID_W);
    expect(CELL_PX).toBe(CANVAS_W / GRID_W);
  });

  it("maps a pointer back to the row under it, for every valley height", () => {
    for (const gridH of HEIGHTS) {
      const top = gridTop(gridH);
      for (let row = 0; row < gridH; row++) {
        // The top edge, the middle and the last pixel of a row all belong to
        // that row, and nothing outside the grid belongs to any row.
        expect(rowAt(top + row * CELL_PX, gridH)).toBe(row);
        expect(rowAt(top + row * CELL_PX + CELL_PX / 2, gridH)).toBe(row);
        expect(rowAt(top + row * CELL_PX + CELL_PX - 1, gridH)).toBe(row);
      }
      expect(rowAt(top - 1, gridH)).toBeNull();
      expect(rowAt(top + gridH * CELL_PX, gridH)).toBeNull();
      expect(rowAt(HUD_Y, gridH)).toBeNull();
    }
  });

  it("maps a pointer back to the column under it", () => {
    for (let col = 0; col < GRID_W; col++) {
      expect(colAt(col * CELL_PX, GRID_W)).toBe(col);
      expect(colAt(col * CELL_PX + CELL_PX - 1, GRID_W)).toBe(col);
    }
    expect(colAt(-1, GRID_W)).toBeNull();
    expect(colAt(CANVAS_W, GRID_W)).toBeNull();
  });
});
