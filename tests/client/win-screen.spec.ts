import { expect, test } from "@playwright/test";
import { content } from "@mazeosaur/content";
import {
  AGAIN_BUTTON,
  SEND_BUTTON,
  clearActiveMigration,
  openGame,
  resultsSummary,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
  waitForResults,
  waitForRunOver,
  waitForTickAdvance,
  winOnNextSend,
} from "./helpers.js";

const SEED = 7;

/**
 * The win screen has no client-level coverage: `smoke.spec.ts` only ever
 * drives a loss, and the sim-level "clearing the last migration wins" test
 * (`packages/sim/test/game.test.ts`) proves the phase transition but never
 * reaches the `results` scene or the "Again" button it shares with the
 * lose screen. Winning fifty migrations for real would make this test
 * minutes long for no extra coverage, so `winOnNextSend` plus
 * `clearActiveMigration` reach the same `clearMigration()` path a real win
 * takes, on the last migration, with nothing left in it to fight.
 */
test("win screen: clearing the last migration shows it, and Again starts a fresh run [@baseline]", async ({ page }) => {
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

  // A win reaches the same `results` scene a loss does, so the headline is
  // the only thing that differs — and it is the one thing a sim-level test
  // cannot see.
  await waitForResults(page);
  expect(await resultsSummary(page)).toMatchObject({ outcome: "won", migrationsCleared: content.migrations.length });

  await page.mouse.click(AGAIN_BUTTON.x, AGAIN_BUTTON.y);
  await waitAFrame(page);

  const afterRestart = await simSnapshot(page);
  expect(afterRestart).toMatchObject({ meat: before.meat, eggs: before.eggs, dinos: 0, phase: "build" });
  await waitForTickAdvance(page, afterRestart.tick);

  expect(errors.messages).toEqual([]);
});
