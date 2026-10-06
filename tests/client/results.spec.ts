import { expect, test } from "@playwright/test";
import {
  AGAIN_BUTTON,
  SEND_BUTTON,
  SPEED_BUTTON,
  bankedProfile,
  cellCenter,
  fastForwardUntilEggsBelow,
  loseOnNextLeak,
  openGame,
  paletteButtonCenter,
  resultsShown,
  resultsSummary,
  simSnapshot,
  toastShown,
  trackPageErrors,
  waitAFrame,
  waitForResults,
  waitForRunOver,
  waitForTickAdvance,
} from "./helpers.js";

const SEED = 123;

/**
 * The `board ──won / lost──▶ results ──again──▶ board` loop of §5.3, from
 * the player's side.
 *
 * Deliberately **not** `[@baseline]`: lines 6a and 6b of
 * `docs/03-v1-baseline.md` are already carried by `smoke.spec.ts` and
 * `win-screen.spec.ts`, and that set is eight lines by definition. This is
 * the extra coverage the new scene needs, not a ninth line.
 *
 * `win-screen.spec.ts` covers the same seam from a win. This one drives a
 * loss, because the two differ in the headline and in the numbers, and
 * because a loss is the end of a run a player actually reaches.
 */
test("results: a lost run lands on the summary, and Again replays the same seed fresh", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // `results` is registered but idle until the board hands it a run.
  expect(await resultsShown(page)).toBe(false);

  // No `tick` assertion anywhere in this spec: the build phase is already
  // counting down by the time `openGame` returns, so "a fresh run" is the
  // economy and the migration index, not a tick of zero. Liveness is
  // `waitForTickAdvance` at the end.
  const atStart = await simSnapshot(page);
  expect(atStart).toMatchObject({ phase: "build", dinos: 0, migration: 0 });

  // Grow nothing and build nothing in the invaders' way: the run has to
  // end, and the pack row's empty case is the one a first run really hits.
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await page.mouse.click(cellCenter(12, 2).x, cellCenter(12, 2).y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).dinos).toBe(1);

  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await fastForwardUntilEggsBelow(page, 20);

  await loseOnNextLeak(page);
  await waitForRunOver(page);
  const lost = await simSnapshot(page);
  expect(lost.phase).toBe("lost");

  // The handoff itself.
  await waitForResults(page);

  // What the screen was told, read off the scene rather than guessed from
  // pixels — this is the assertion that a wrong number would fail, and a
  // screenshot would not.
  const summary = await resultsSummary(page);
  expect(summary).toMatchObject({
    outcome: "lost",
    seed: SEED,
    // `state.migration` is the index of the one in progress, so losing
    // during the first migration is zero cleared.
    migrationsCleared: lost.migration,
    eggsKept: lost.eggs,
    meatUnspent: lost.meat,
  });
  // One hatchling placed and never grown, so the pack is empty: it is what
  // the player grew to adult, not what they placed.
  expect(summary.pack).toEqual([]);

  /**
   * The award on screen is the award banked. `>= 0` would pass on a
   * summary that dropped the number entirely, so this compares the two:
   * `profile.fossilsEarned` starts at 0 on a fresh profile and this is its
   * first finished run, so the lifetime total *is* this run's award.
   *
   * Drives the §5.4 claim end to end — one `fossilAward` call, in
   * `flush()`, handed to the screen — which is the one thing a player
   * cannot check for themselves: they see one figure and are credited
   * another, with no way to tell which is wrong.
   */
  const banked = await bankedProfile(page);
  expect(banked.runsFinished).toBe(1);
  expect(summary.fossilsAwarded).toBe(banked.fossilsEarned);
  expect(summary.fossilsAwarded).toBeGreaterThan(0);

  /**
   * And the toast is down. It fades on `playedMs()`, which `scene.pause()`
   * stops, so a toast still up when the run ended would sit at a fixed
   * alpha for as long as this screen is — on a loss, always "An invader
   * reached the nest". Found by driving it; `showResults` hides it.
   */
  expect(await toastShown(page)).toBe(false);

  // Again: back through `board`, which is the only scene that builds a
  // `Game`. §5.3 is "again (same seed)", so the seed is kept and
  // everything else is new.
  await page.mouse.click(AGAIN_BUTTON.x, AGAIN_BUTTON.y);
  await waitAFrame(page);
  expect(await resultsShown(page)).toBe(false);

  // Identical to the state the first run opened in: a fresh `Game`, not
  // the finished one resurrected. The eggs are the sharpest of these — the
  // run that just ended lost all of them, so a resume would show 0.
  const afterAgain = await simSnapshot(page);
  expect(afterAgain).toMatchObject({ phase: "build", dinos: 0, meat: atStart.meat, eggs: atStart.eggs, migration: 0 });
  expect(lost.eggs).toBeLessThan(afterAgain.eggs);
  expect(await page.evaluate(() => window.mazeosaurBoard!().sim.seed)).toBe(SEED);

  // The re-entry runs `BoardScene.create()` a second time on the same
  // instance. A field still holding a destroyed display object stalls the
  // update loop while the sim underneath has already reset, so liveness is
  // the tick counter and not a pixel.
  await waitForTickAdvance(page, afterAgain.tick);

  expect(errors.messages, `renderer/page errors across the results seam:\n${errors.messages.join("\n")}`).toEqual([]);
});
