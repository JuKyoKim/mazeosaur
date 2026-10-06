import { expect, test } from "@playwright/test";
import {
  PLAY_AGAIN_BUTTON,
  SEND_BUTTON,
  clearActiveMigration,
  openGame,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
  waitForRunOver,
  waitForTickAdvance,
  winOnNextSend,
} from "./helpers.js";

const SEED = 7;

/**
 * The win screen has no client-level coverage: `smoke.spec.ts` only ever
 * drives a loss, and the sim-level "clearing the last migration wins" test
 * (`packages/sim/test/game.test.ts`) proves the phase transition but never
 * touches `BoardScene.showOverlay()` or the "Play again" button it shares
 * with the lose screen. Winning fifty migrations for real would make this
 * test minutes long for no extra coverage, so `winOnNextSend` plus
 * `clearActiveMigration` reach the same `clearMigration()` path a real win
 * takes, on the last migration, with nothing left in it to fight.
 */
test("win screen: clearing the last migration shows it, and Play again starts a fresh run [@baseline]", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  const before = await simSnapshot(page);
  expect(before.phase).toBe("build");

  await winOnNextSend(page);
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("migration");

  await clearActiveMigration(page);
  await waitForRunOver(page);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("won");

  // The overlay's "Play again" button is the one `showOverlay()` builds for
  // both `won` and `lost` (`BoardScene.ts`), so the same coordinates as the
  // lose-screen test apply here.
  await page.mouse.click(PLAY_AGAIN_BUTTON.x, PLAY_AGAIN_BUTTON.y);
  await waitAFrame(page);

  const afterRestart = await simSnapshot(page);
  expect(afterRestart).toMatchObject({ meat: before.meat, eggs: before.eggs, dinos: 0, phase: "build" });
  await waitForTickAdvance(page, afterRestart.tick);

  expect(errors.messages).toEqual([]);
});
