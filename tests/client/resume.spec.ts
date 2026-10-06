import { expect, test } from "@playwright/test";
import {
  cellCenter,
  flushSave,
  openGame,
  paletteButtonCenter,
  reloadAndWaitForBoard,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
  waitForTickAdvance,
} from "./helpers.js";

const SEED = 321;

// Same off-lane cell `smoke.spec.ts` places on: not spawn, not a checkpoint,
// not the nest, so it takes a dinosaur without depending on map data.
const CELL = { x: 12, y: 2 };

/**
 * `save.test.ts`, `resume.test.ts` and `save-store.test.ts` prove the save
 * format round-trips and that `gameForRun` reuses a replayed `Game` instead
 * of replaying twice, but nothing drives the real client through a reload.
 * This is the gap the owner's evidence named: a save that round-trips below
 * the client is not proof `apps/web/src/main.ts`'s boot path -- `readRawSave`,
 * `loadSave`, `gameForRun`, `mountGame` -- wires back together correctly
 * with the real IndexedDB the browser gives it.
 */
test("save and resume: a reload picks the stored run back up, not a fresh one [@baseline]", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await waitAFrame(page);
  const cell = cellCenter(CELL.x, CELL.y);
  await page.mouse.click(cell.x, cell.y);
  await waitAFrame(page);

  const before = await simSnapshot(page);
  expect(before.dinos).toBe(1);

  // Flush synchronously rather than relying on the `pagehide` a real reload
  // fires: that race is `wireSuspend`'s job to win, not this test's job to
  // depend on for a deterministic result. `flush()` is the exact function
  // both `autosave()` and `GameHandle.suspend()` call.
  await flushSave(page);
  await reloadAndWaitForBoard(page);

  const seedAfterReload = await page.evaluate(() => window.mazeosaurBoard!().sim.seed);
  expect(seedAfterReload).toBe(SEED);

  const afterReload = await simSnapshot(page);
  expect(afterReload).toMatchObject({ meat: before.meat, eggs: before.eggs, dinos: before.dinos, phase: before.phase });
  expect(afterReload.tick).toBeGreaterThanOrEqual(before.tick);

  // The resumed scene is a live board, not a frozen snapshot: the update
  // loop has to keep ticking after a resume the same way it does after a
  // restart.
  await waitForTickAdvance(page, afterReload.tick);

  expect(errors.messages).toEqual([]);
});
