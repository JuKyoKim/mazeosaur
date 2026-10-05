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
 * The probes are two logical pixels inside a cell boundary rather than at a
 * cell's centre, because an off-by-half-cell or a dropped grid inset is
 * invisible in the middle of a cell and unmissable at its edge. Which cells,
 * and why not all of them, is argued at the sweep itself.
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

interface Probe {
  /** CSS point to press, already converted through the canvas's box. */
  cx: number;
  cy: number;
  /** The cell that point is inside of. */
  x: number;
  y: number;
  label: string;
}

/**
 * Taps every probe and reports the ones where the cell the client chose is
 * not the cell the point is inside of.
 *
 * `hoverCell` is set by every tap on a cell whether or not anything is
 * armed, so an unarmed tap is a free, side-effect-free probe of the
 * pointer-to-cell conversion — no meat spent, no wall built, nothing to
 * reset between probes.
 *
 * Every tap is a real browser tap, but the answers are collected in the page
 * instead of being read back one at a time.
 *
 * Each tap costs a round trip and each read costs another, and on a CI
 * runner that is a fifth of a second apiece: reading after every probe ran
 * this spec past the 60s timeout and starved the smoke test sharing the
 * box, failing both. So a listener on the scene's own input plugin records
 * the cell per event instead. It is the same emitter `BoardScene.wireInput`
 * subscribes to and it is registered later, so it runs after the scene has
 * already updated `hoverCell` and sees exactly what that tap decided.
 *
 * The recorder asserting its own length is what makes this safe: if Phaser
 * ever coalesced two taps into one event the counts would disagree and the
 * spec would say so rather than quietly comparing the wrong pairs.
 */
async function sweep(page: Page, probes: Probe[]): Promise<string[]> {
  await page.evaluate(() => {
    const board = window.mazeosaurBoard!();
    const seen: ({ x: number; y: number } | null)[] = [];
    (window as unknown as { tapProbes: typeof seen }).tapProbes = seen;
    board.input.on("pointerdown", () => seen.push(board.selection.preview));
  });
  for (const p of probes) await page.mouse.click(p.cx, p.cy);
  await waitAFrame(page);
  const seen = await page.evaluate(() => (window as unknown as { tapProbes: ({ x: number; y: number } | null)[] }).tapProbes);
  if (seen.length !== probes.length) {
    return [`the scene saw ${seen.length} taps for ${probes.length} probes`];
  }
  const misses: string[] = [];
  probes.forEach((p, i) => {
    const got = seen[i];
    if (!got || got.x !== p.x || got.y !== p.y) misses.push(`${p.label} -> ${got ? `${got.x},${got.y}` : "null"}`);
  });
  return misses;
}

test("tap-to-cell mapping holds at a phone viewport, at the valley's edges and under the HUD [@mapping]", async ({ page }) => {
  await openGame(page, 226);
  const box = await canvasBox(page);

  // FIT scales uniformly. If these disagree the conversion above is wrong
  // and every number below it would be measuring the spec, not the client.
  const sx = box.width / LOGICAL_W;
  const sy = box.height / LOGICAL_H;
  expect(Math.abs(sx - sy)).toBeLessThan(0.001);
  expect(sx).toBeLessThan(1); // the point of this spec: a scaled canvas

  // Two logical pixels inside both edges of the first, middle and last two
  // columns and rows, plus the four corners of the valley and the cell that
  // sits against the HUD.
  //
  // Not every column and every row, which is where this started: all three
  // failure modes worth fearing are systematic, so the extremes see them at
  // full strength and the rest of the sweep only costs runner time. A wrong
  // scale grows with distance from the origin and is largest at column 19 and
  // row 27; a half-cell offset lands on every boundary, so any boundary
  // catches it; a dropped grid inset (`rowAt` subtracts it before dividing)
  // shifts every row equally. A per-cell error that spared the extremes is not
  // a thing `Math.floor((y - top) / CELL_PX)` can do.
  const probes: Probe[] = [];
  const edgeInsets = [2, CELL_PX - 2];
  for (const c of [0, 1, GRID_W / 2 - 1, GRID_W / 2, GRID_W - 2, GRID_W - 1]) {
    for (const inset of edgeInsets) {
      const css = toCss(box, c * CELL_PX + inset, 14 * CELL_PX + 18);
      probes.push({ cx: css.x, cy: css.y, x: c, y: 14, label: `col ${c} at +${inset}` });
    }
  }
  for (const r of [0, 1, GRID_H / 2 - 1, GRID_H / 2, GRID_H - 2, GRID_H - 1]) {
    for (const inset of edgeInsets) {
      const css = toCss(box, 10 * CELL_PX + 18, r * CELL_PX + inset);
      probes.push({ cx: css.x, cy: css.y, x: 10, y: r, label: `row ${r} at +${inset}` });
    }
  }
  for (const cell of [
    { x: 0, y: 0 },
    { x: GRID_W - 1, y: 0 },
    { x: 0, y: GRID_H - 1 },
    { x: GRID_W - 1, y: GRID_H - 1 },
  ]) {
    for (const inset of edgeInsets) {
      const css = toCss(box, cell.x * CELL_PX + inset, cell.y * CELL_PX + inset);
      probes.push({ cx: css.x, cy: css.y, x: cell.x, y: cell.y, label: `corner ${cell.x},${cell.y} at +${inset}` });
    }
  }
  expect(await sweep(page, probes)).toEqual([]);

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
