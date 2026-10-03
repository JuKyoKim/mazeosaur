import { expect, test } from "@playwright/test";
import { openGame, simSnapshot, trackPageErrors, waitAFrame, waitForTickAdvance } from "./helpers.js";

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

  // A destroyed display object still referenced stalls the update loop
  // (whether or not Phaser also throws), so prove liveness by the sim's own
  // tick counter advancing rather than by sampling canvas pixels.
  const afterRestart = await simSnapshot(page);
  await waitForTickAdvance(page, afterRestart.tick);

  expect(errors.messages, `renderer/page errors after restart:\n${errors.messages.join("\n")}`).toEqual([]);
});
