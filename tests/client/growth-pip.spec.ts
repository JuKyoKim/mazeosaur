import { expect, test } from "@playwright/test";
import { content } from "@mazeosaur/content";
import { CELL_PX, gridTop } from "@mazeosaur/game/layout";
import { KIND_COLOR, PIP_INK } from "@mazeosaur/game/theme";
import {
  GROW_BUTTON,
  HUD_BARE,
  canvasRow,
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
 * One row of cells, one column per kind, clear of the trail —
 * `dino-sheet.spec.ts`'s cells. The row being shared is load-bearing and not
 * just tidy: see the single capture at the end of the test.
 */
const ROW = 3;
const cellOf = (kind: number): { x: number; y: number } => ({ x: 1 + kind * 3, y: ROW });

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
    const cell = cellOf(kind);
    const at = cellCenter(cell.x, cell.y);

    // Row 3 is one tray at a time: while a sheet is open the shop is not on
    // screen, so the previous kind's selection has to be dismissed before a
    // card can be tapped. A tap on bare HUD is the gesture that does it.
    await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
    // The two frames in this loop are the two the *client* needs, not padding:
    // row 3 and the sheet are both swapped by `refreshHud`, so a card tapped
    // in the same instant the sheet closed hits an object that is still
    // hidden, and `GROW` tapped in the instant the sheet opened is not on
    // screen yet. Everything else here is handled inside the pointer event —
    // `tryPlace` and `grow` both finish synchronously — so the taps between
    // these two waits need no frame, and this spec's budget is round trips.
    await waitAFrame(page);
    await page.mouse.click(paletteButtonCenter(kind).x, paletteButtonCenter(kind).y);
    await page.mouse.click(at.x, at.y);

    // Grown twice, so all three stages are drawn and the third pip is read
    // on an adult. Grow is reached through the sheet, which the place above
    // did not open — one-shot placement returns the card to rest (§4).
    await page.mouse.click(at.x, at.y);
    await waitAFrame(page);
    await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
    await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
  }

  // The last grow left that dinosaur selected, and a selected dinosaur draws
  // its range as a circle wide enough to cross its neighbours' cells. A tap
  // on bare HUD clears both selections, so the capture below is the board and
  // not the board plus a white ring through three kinds' pips.
  await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
  await waitAFrame(page);

  // Every dinosaur reached stage 3, asked once rather than after each tap. A
  // stage is reached by growing through the one below it, so the adult is
  // evidence for both taps, and the `null` a missed placement would give is
  // as loud here as it would have been in the loop.
  const stages = await page.evaluate((cells) => {
    const board = window.mazeosaurBoard!();
    return cells.map((c) => {
      const dino = board.sim.state.dinos.find((d) => d.x === c.x && d.y === c.y);
      return dino ? board.sim.dinoDef(dino).stage : null;
    });
  }, TRAY.map((_, kind) => cellOf(kind)));
  for (let kind = 0; kind < TRAY.length; kind++) {
    expect(stages[kind], `${TRAY[kind]!} should have grown to stage 3`).toBe(3);
  }

  // Eighteen pips in **one** screenshot. Every cell is on `ROW`, and a pip's
  // y is a function of the cell's y alone, so all eighteen share a canvas row
  // and `canvasRow` can clip the strip that spans them once. Sampling them one
  // at a time is what put this spec over the 60 s per-test timeout on CI while
  // it passed in 16.5 s locally: a `page.screenshot` is a browser round trip
  // and costs ~0.4 s on the 2-core runner.
  const first = pipCenter(cellOf(0).x, ROW, 0);
  const last = pipCenter(cellOf(TRAY.length - 1).x, ROW, 2);
  const strip = await canvasRow(page, first.x, first.y, last.x - first.x + 1);

  for (let kind = 0; kind < TRAY.length; kind++) {
    const name = TRAY[kind]!;
    // The pips, left to right. All three carry the same colour: the count is
    // the reading and a pip that differed from its neighbours would be a
    // fourth channel nobody asked for.
    for (let i = 0; i < 3; i++) {
      const pixel = strip[pipCenter(cellOf(kind).x, ROW, i).x - first.x]!;
      expect(pixel, `${name} pip ${i + 1} should be PIP_INK and not a blend with the fill`).toEqual(rgbOf(PIP_INK[name]));
      // And not the fill it sits on, which is what a missing pip would read
      // as — an assertion the fill also satisfies is not an assertion.
      expect(pixel, `${name} pip ${i + 1} should not be the cell fill`).not.toEqual(rgbOf(KIND_COLOR[name]));
    }
  }

  expect(errors.messages).toEqual([]);
});
