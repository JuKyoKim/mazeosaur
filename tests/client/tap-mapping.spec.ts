import { expect, test, type Page } from "@playwright/test";
import { CANVAS_W, CELL_PX, cellCenter, openGame, paletteButtonCenter, selectionSnapshot, simSnapshot, waitAFrame } from "./helpers.js";

/**
 * Does the cell the client picks match the cell under the thumb, on a phone
 * viewport where the canvas is scaled rather than 1:1?
 *
 * The other specs here run at a 720x1280 viewport, where Phaser's FIT scale
 * is exactly 1 and the canvas sits at the origin — a logical pixel and a CSS
 * pixel are the same number, so an unaccounted scale in the pointer path
 * could not show up in any of them. This spec mounts the game at 390x844,
 * the reference phone `layout.ts` is dimensioned for, where the scale is
 * ~0.54 and the canvas is letterboxed vertically. Every coordinate below is
 * converted through the canvas's own bounding box, which is what a finger
 * does and what the game's own numbers cannot check for themselves.
 *
 * The probes are two logical pixels inside each cell boundary, on every
 * column and every row, because an off-by-half-cell or a dropped grid inset
 * is invisible at cell centres and unmissable at the edges.
 *
 * One standing assumption, true today and worth knowing when it stops being
 * true: `BoardScene.cellAt` reads `pointer.x`/`pointer.y`, which Phaser has
 * already put in canvas space but *not* in camera space. The board camera is
 * never scrolled or zoomed, so the two are the same and the conversion here
 * is a bounding-box scale. Pan or pinch-zoom would make them differ, and the
 * mapping would have to move to `worldX`/`worldY` — this spec is where that
 * would surface, since it is the only one that does not run at scale 1.
 */

const PHONE = { width: 390, height: 844 };
const LOGICAL_W = CANVAS_W;
const LOGICAL_H = 1280;
const GRID_W = 20;
const GRID_H = 28;
/** The grid is exactly as tall as the board area for the valley that ships. */
const GRID_PX_H = GRID_H * CELL_PX;

test.use({ viewport: PHONE });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function canvasBox(page: Page): Promise<Box> {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("the canvas has no box: the game did not mount");
  return box;
}

/** A logical canvas point as the CSS point a finger would land on. */
function toCss(box: Box, lx: number, ly: number): { x: number; y: number } {
  return { x: box.x + (lx * box.width) / LOGICAL_W, y: box.y + (ly * box.height) / LOGICAL_H };
}

/**
 * Taps a logical point and returns the cell the client decided it was.
 * `hoverCell` is set by every tap on a cell whether or not anything is
 * armed, so an unarmed tap is a free, side-effect-free probe of the
 * pointer-to-cell conversion — no meat spent, no wall built, nothing to
 * reset between probes.
 */
async function probe(page: Page, box: Box, lx: number, ly: number): Promise<{ x: number; y: number } | null> {
  const css = toCss(box, lx, ly);
  await page.mouse.click(css.x, css.y);
  return (await selectionSnapshot(page)).preview;
}

test("tap-to-cell mapping holds at a phone viewport, at every cell edge and under the HUD [@mapping]", async ({ page }) => {
  await openGame(page, 226);
  const box = await canvasBox(page);

  // FIT scales uniformly. If these disagree the conversion above is wrong
  // and every number below it would be measuring the spec, not the client.
  const sx = box.width / LOGICAL_W;
  const sy = box.height / LOGICAL_H;
  expect(Math.abs(sx - sy)).toBeLessThan(0.001);
  expect(sx).toBeLessThan(1); // the point of this spec: a scaled canvas

  // Every column, two logical pixels inside each of its edges.
  const columnMisses: string[] = [];
  for (let c = 0; c < GRID_W; c++) {
    for (const inset of [2, CELL_PX - 2]) {
      const got = await probe(page, box, c * CELL_PX + inset, 14 * CELL_PX + 18);
      if (got?.x !== c) columnMisses.push(`x=${c * CELL_PX + inset} wanted col ${c} got ${got ? got.x : "null"}`);
    }
  }
  expect(columnMisses).toEqual([]);

  // Every row, same. This is the one the grid inset would break: `rowAt`
  // subtracts it before dividing, and an integer divide alone is right for
  // the 28-tall valley and one row out for any other.
  const rowMisses: string[] = [];
  for (let r = 0; r < GRID_H; r++) {
    for (const inset of [2, CELL_PX - 2]) {
      const got = await probe(page, box, 10 * CELL_PX + 18, r * CELL_PX + inset);
      if (got?.y !== r) rowMisses.push(`y=${r * CELL_PX + inset} wanted row ${r} got ${got ? got.y : "null"}`);
    }
  }
  expect(rowMisses).toEqual([]);

  // Just past the grid's last row is the HUD band, which is not a cell: a
  // tap there is the "put the dinosaur back" half of cancel.
  const armed = paletteButtonCenter(0);
  const armedCss = toCss(box, armed.x, armed.y);
  await page.mouse.click(armedCss.x, armedCss.y);
  expect((await selectionSnapshot(page)).kindId).not.toBeNull();
  const bare = toCss(box, CANVAS_W / 2, GRID_PX_H + 4);
  await page.mouse.click(bare.x, bare.y);
  const afterHud = await selectionSnapshot(page);
  expect(afterHud.kindId).toBeNull();
  expect(afterHud.preview).toBeNull();
});

test("the dinosaur lands in the cell that was tapped, and a refusal keeps the card [@mapping]", async ({ page }) => {
  await openGame(page, 226);
  const box = await canvasBox(page);
  const before = await simSnapshot(page);

  const target = { x: 5, y: 5 };
  const card = toCss(box, paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await page.mouse.click(card.x, card.y);
  const centre = cellCenter(target.x, target.y);
  const tap = toCss(box, centre.x, centre.y);
  await page.mouse.click(tap.x, tap.y);
  await waitAFrame(page);

  const placed = await page.evaluate(() => {
    const dinos = window.mazeosaurBoard!().sim.state.dinos;
    const last = dinos[dinos.length - 1];
    return last ? { x: last.x, y: last.y } : null;
  });
  expect(placed).toEqual(target);
  expect((await simSnapshot(page)).dinos).toBe(before.dinos + 1);
  // One-shot: the placement spent the card.
  expect((await selectionSnapshot(page)).kindId).toBeNull();

  // A refusal does not spend it, and the player can tell: the card stays
  // lit and the preview stays on the cell that refused.
  await page.mouse.click(card.x, card.y);
  const nest = cellCenter(19, 27);
  const nestCss = toCss(box, nest.x, nest.y);
  await page.mouse.click(nestCss.x, nestCss.y);
  await waitAFrame(page);
  const afterRefusal = await selectionSnapshot(page);
  expect(afterRefusal.kindId).not.toBeNull();
  expect(afterRefusal.preview).toEqual({ x: 19, y: 27 });
  expect((await simSnapshot(page)).dinos).toBe(before.dinos + 1);
});
