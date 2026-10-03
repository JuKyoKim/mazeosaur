import { expect, test } from "@playwright/test";
import { canvasSnapshot, openGame, trackPageErrors, waitAFrame } from "./helpers.js";

const SEED = 42;

/**
 * Dedicated regression test for the bug fixed in commit 1ae3419: `scene.restart()`
 * re-runs `create()` on the same Phaser.Scene instance, so any field still
 * holding a reference to a display object `create()` destroyed (or any other
 * per-run state) goes stale. The known failure mode was `paletteButtons`
 * pointing at destroyed Text objects that `refreshHud()` touched every
 * frame, which threw inside Phaser's renderer and froze the canvas while
 * the sim underneath had already reset.
 *
 * This test calls the same `scene.restart()` the "Play again" button calls,
 * with no setup beyond loading the page, so it stays fast and does not
 * depend on winning or losing a run first.
 */
test("scene.restart() leaves the canvas rendering with no renderer errors", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await page.evaluate(() => {
    const w = window as unknown as { mazeosaur: { scene: { keys: { board: { scene: { restart: () => void } } } } } };
    w.mazeosaur.scene.keys.board.scene.restart();
  });
  await waitAFrame(page);

  // A frozen canvas with a destroyed display object still referenced throws
  // on (roughly) every frame, so give it real time to make a static canvas
  // visible as two identical snapshots. A healthy idle build phase has
  // nothing moving on screen except the HUD countdown, which only repaints
  // once per whole second (TICKS_PER_SECOND = 20); wait past that boundary
  // or a correctly-rendering canvas looks identical by coincidence, not bug.
  const snapA = await canvasSnapshot(page);
  await page.waitForTimeout(1100);
  const snapB = await canvasSnapshot(page);

  expect(errors.messages, `renderer/page errors after restart:\n${errors.messages.join("\n")}`).toEqual([]);
  expect(snapB, "canvas pixels did not change after restart: the renderer looks frozen").not.toBe(snapA);
});
