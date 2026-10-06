import { expect, test } from "@playwright/test";
import { hatchlings } from "@mazeosaur/content";
import { CONTENT_RIGHT, HUD_Y, MIN_HIT, ROW1, ROW3, SCALE, pt } from "@mazeosaur/game/layout";
import { cellCenter, hudTargets, openGame, paletteButtonCenter, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * Every control a finger is supposed to be able to hit clears 44 CSS points
 * on the reference phone — measured on the live display objects, not on the
 * constants.
 *
 * `packages/game/test/layout.test.ts` already proves the constants clear
 * the floor, and that test was green for the whole period in which all five
 * controls on screen were under it: `buildHud` wrote its own numbers and
 * nothing compared the two sets. Send and the speed toggle were 22.8pt, the
 * kind cards 33.6pt, Grow and Sell 28.2pt, against a floor of 44.4. That is
 * the defect ARB-186 fixed, and the only test that could have caught it is
 * one that reads the renderer.
 *
 * It also pins the boxes to `layout.ts` exactly rather than merely to the
 * floor. A control that cleared 44pt at numbers of its own would pass a
 * floor check and still be the same class of drift.
 */

/** The reference phone is 390pt wide; `SCALE` is how 720 logical px fit it. */
const FLOOR_PT = 44;

test("every HUD control clears the 44pt hit floor on the rendered canvas", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 123);

  // The shop tray is up at the start of a run, so the kind cards and row 1
  // are on screen; Grow and Sell belong to the other tray and are built
  // with their geometry whether or not they are visible. Open a sheet
  // anyway, so this measures them in the state a player sees them in.
  const cell = { x: 1, y: 3 };
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);

  const targets = await hudTargets(page);
  // The list, not just its length: a control that stopped being reported
  // would otherwise drop silently out of every assertion below. The kind
  // cards are counted from the content, because how many there are is a
  // content edit.
  expect(targets.map((t) => t.name)).toEqual([
    "Send",
    "Pause",
    "speed toggle",
    ...hatchlings.map((_, i) => `kind card ${i}`),
    "Grow",
    "Sell",
  ]);

  for (const t of targets) {
    expect(t.w, `${t.name} is ${pt(t.w)}pt wide (${t.w}px)`).toBeGreaterThanOrEqual(MIN_HIT);
    expect(t.h, `${t.name} is ${pt(t.h)}pt tall (${t.h}px)`).toBeGreaterThanOrEqual(MIN_HIT);
    expect(pt(t.w), `${t.name} is ${pt(t.w)}pt wide`).toBeGreaterThanOrEqual(FLOOR_PT);
    expect(pt(t.h), `${t.name} is ${pt(t.h)}pt tall`).toBeGreaterThanOrEqual(FLOOR_PT);
    // Inside the HUD and inside the content column, which is the other half
    // of the failure the spec'd geometry prevents: a 164x82 Sell placed at
    // the old origin overflowed the canvas by 28px.
    expect(t.y, `${t.name} starts above the HUD`).toBeGreaterThanOrEqual(HUD_Y);
    expect(t.x + t.w, `${t.name} passes the content column's right edge`).toBeLessThanOrEqual(CONTENT_RIGHT);
  }

  // The boxes are `layout.ts`'s, not merely big enough.
  const byName = new Map(targets.map((t) => [t.name, t]));
  expect(byName.get("Send")).toMatchObject({ x: ROW1.send.x, y: ROW1.send.y, w: ROW1.send.w, h: ROW1.send.h });
  expect(byName.get("Pause")).toMatchObject({ x: ROW1.pause.x, y: ROW1.pause.y, w: ROW1.pause.w, h: ROW1.pause.h });
  expect(byName.get("speed toggle")).toMatchObject({ x: ROW1.speed.x, y: ROW1.speed.y, w: ROW1.speed.w, h: ROW1.speed.h });
  expect(byName.get("Grow")).toMatchObject({ x: ROW3.grow.x, y: ROW3.grow.y, w: ROW3.grow.w, h: ROW3.grow.h });
  expect(byName.get("Sell")).toMatchObject({ x: ROW3.sell.x, y: ROW3.sell.y, w: ROW3.sell.w, h: ROW3.sell.h });

  // `SCALE` is the conversion the whole floor rests on: if it is not the
  // reference phone's, every pt above is measuring something else.
  expect(SCALE).toBeCloseTo(390 / 720, 10);
  expect(errors.messages).toEqual([]);
});
