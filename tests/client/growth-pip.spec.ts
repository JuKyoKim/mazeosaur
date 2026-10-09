import { expect, test } from "@playwright/test";
import { content } from "@mazeosaur/content";
import { CELL_PX, gridTop } from "@mazeosaur/game/layout";
import { KIND_COLOR, PIP_INK } from "@mazeosaur/game/theme";
import {
  GROW_BUTTON,
  HUD_BARE,
  canvasPixel,
  cellCenter,
  openGame,
  paletteButtonCenter,
  rgbOf,
  trackPageErrors,
  waitAFrame,
} from "./helpers.js";

/**
 * The growth pip, read off the canvas rather than off the scene graph.
 *
 * `packages/game/test/palette-agreement.test.ts` already re-derives the
 * palette half of ARB-386: that `PIP_INK` holds the better of the two inks
 * for every kind, and what each pair measures. It cannot see the other half.
 * The defect was a fixed `ink` drawn at **alpha 0.85**, and an alpha is a
 * property of the draw call: every assertion about `theme.ts` passed while
 * the pip on screen composited to 2.88:1 on `horned`. A reader that goes
 * through the scene graph could not see it either — `Graphics` keeps a
 * command list, not pixels.
 *
 * So this samples the pixel. An opaque pip is `PIP_INK[kind]` exactly; a pip
 * at any alpha below 1 is a blend of it with the kind fill underneath, and
 * the two kinds whose pip is `selection` are where that blend is most
 * obvious — a light dot at 0.85 over `tyrant` red is visibly pink.
 *
 * The viewport is the logical canvas, 720x1280, so one canvas pixel is one
 * device pixel and the centre of a 6px dot is not a resample of anything.
 */

/** `hatchlings` order, which is the tray's. */
const TRAY = ["raptor", "tyrant", "armored", "horned", "longneck", "flier"] as const;

/**
 * Where `drawTowers` puts the pips: `x + 9 + i * 9` across, `CELL_PX - 8` up
 * from the cell's top, radius 3. Derived from `CELL_PX` and `gridTop` rather
 * than written out, for the reason `helpers.ts` imports the layout at all.
 */
function pipCenter(cx: number, cy: number, index: number): { x: number; y: number } {
  return { x: cx * CELL_PX + 9 + index * 9, y: gridTop(content.valley.height) + cy * CELL_PX + CELL_PX - 8 };
}

test("every growth pip is drawn opaque, in its kind's pip ink", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 70225);

  // The same cheat `dino-sheet.spec.ts` and `tools/art/frame.ts` take: three
  // stages of six kinds is several minutes of honest migrations, and a pip's
  // colour is a function of the kind, not of how the meat was earned.
  await page.evaluate(() => {
    window.mazeosaurBoard!().sim.state.meat = 99_999;
  });

  for (let kind = 0; kind < TRAY.length; kind++) {
    const name = TRAY[kind]!;
    // One column per kind, clear of the trail — `dino-sheet.spec.ts`'s cells.
    const cell = { x: 1 + kind * 3, y: 3 };
    const at = cellCenter(cell.x, cell.y);

    // Row 3 is one tray at a time: while a sheet is open the shop is not on
    // screen, so the previous kind's selection has to be dismissed before a
    // card can be tapped. A tap on bare HUD is the gesture that does it.
    await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
    await waitAFrame(page);
    await page.mouse.click(paletteButtonCenter(kind).x, paletteButtonCenter(kind).y);
    await page.mouse.click(at.x, at.y);
    await waitAFrame(page);

    // Grown twice, so all three stages are drawn and the third pip is read
    // on an adult. Grow is reached through the sheet, which the place above
    // did not open — one-shot placement returns the card to rest (§4).
    await page.mouse.click(at.x, at.y);
    await waitAFrame(page);
    for (const stage of [2, 3]) {
      await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
      await waitAFrame(page);
      const reached = await page.evaluate((c) => {
        const board = window.mazeosaurBoard!();
        const dino = board.sim.state.dinos.find((d) => d.x === c.x && d.y === c.y);
        return dino ? board.sim.dinoDef(dino).stage : null;
      }, cell);
      expect(reached, `${name} should have grown to stage ${stage}`).toBe(stage);
    }

    // The pips, left to right. All three carry the same colour: the count is
    // the reading and a pip that differed from its neighbours would be a
    // fourth channel nobody asked for.
    for (let i = 0; i < 3; i++) {
      const p = pipCenter(cell.x, cell.y, i);
      const pixel = await canvasPixel(page, p.x, p.y);
      expect(pixel, `${name} pip ${i + 1} should be PIP_INK and not a blend with the fill`).toEqual(rgbOf(PIP_INK[name]));
      // And not the fill it sits on, which is what a missing pip would read
      // as — an assertion the fill also satisfies is not an assertion.
      expect(pixel, `${name} pip ${i + 1} should not be the cell fill`).not.toEqual(rgbOf(KIND_COLOR[name]));
    }
  }

  expect(errors.messages).toEqual([]);
});
