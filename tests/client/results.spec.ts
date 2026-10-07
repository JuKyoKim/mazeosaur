import { expect, test } from "@playwright/test";
import { RESULTS, TYPE } from "@mazeosaur/game/layout";
import { COLORS, hexCss } from "@mazeosaur/game/theme";
import {
  AGAIN_BUTTON,
  SEND_BUTTON,
  SPEED_BUTTON,
  bankedProfile,
  canvasPixel,
  cellCenter,
  fastForwardUntilEggsBelow,
  loseOnNextLeak,
  openGame,
  paletteButtonCenter,
  resultsLineAt,
  resultsShown,
  resultsSummary,
  rgbOf,
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
 * A point inside the Again button's fill and clear of its centred label,
 * for the one assertion here that reads the canvas instead of the scene.
 * Derived from `RESULTS.again` like every other coordinate in this suite,
 * so moving the button in `layout.ts` moves the sample with it.
 */
const AGAIN_FILL: [number, number] = [RESULTS.again.x + 20, RESULTS.again.y + RESULTS.again.h / 2];

/**
 * The `board ──won / lost / abandoned──▶ results ──again──▶ board` loop of
 * §5.3, from the player's side.
 *
 * Deliberately **not** `[@baseline]`: lines 6a and 6b of
 * `docs/03-v1-baseline.md` are already carried by `smoke.spec.ts` and
 * `win-screen.spec.ts`, and that set is eight lines by definition. This is
 * the extra coverage the new scene needs, not a ninth line.
 *
 * One edge each: `win-screen.spec.ts` drives the win and `pause.spec.ts`
 * the player's own quit. This one drives a **loss**, because the three
 * differ in the headline and in the numbers, and because a loss is the end
 * of a run a player actually reaches.
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

  // The control for the pixel assertion further down, taken here because
  // there is no later moment to take it: `showResults` runs synchronously
  // off the sim's own `lost` event, so by the time `waitForRunOver` returns
  // the screen is already up. Mid-build this point is the board's own HUD,
  // so Again's colour arriving there afterwards is this screen appearing
  // and not a coincidence of the palette.
  const duringPlay = await canvasPixel(page, ...AGAIN_FILL);
  expect(duringPlay).not.toEqual(rgbOf(COLORS.buttonActive));

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

  /**
   * The screen is actually on the screen.
   *
   * Every other assertion in this spec reads display objects off the
   * scene, and a display object exists, carries its text and reports its
   * colour whether or not one pixel of it is ever composited. `results` is
   * registered before `board` in `index.ts`, and `showResults` leaves the
   * board *paused* rather than stopped because §9 wants the valley visible
   * through the scrim — but a paused scene still renders, so the board
   * repainted this entire screen every frame with the whole suite green.
   * `ResultsScene.create` calls `bringToTop()` for that reason, and this is
   * the assertion that fails if it stops.
   *
   * The Again button rather than the headline: it is a flat filled rect, so
   * a pixel of it is exactly `COLORS.buttonActive` with no antialiasing to
   * tolerate, while a glyph's edge depends on which fonts the machine
   * running this happens to have — which is also why `AGAIN_FILL` is inset
   * from the button's centre rather than being `AGAIN_BUTTON`. The centre
   * is where the label is, and it reads as a blend of the two.
   */
  expect(await canvasPixel(page, ...AGAIN_FILL)).toEqual(rgbOf(COLORS.buttonActive));

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

  // A loss has its own headline, and a paid run's award keeps the loud
  // treatment §9 gives it: `vital` in checkpoint yellow, the one reward on
  // the screen. This is the control for the zero case below — the point of
  // ARB-322's rule is the *difference* between the two, so a change that
  // dimmed every award would have to fail here.
  expect((await resultsLineAt(page, RESULTS.headline.y))?.text).toBe("The valley is quiet");
  expect(await resultsLineAt(page, RESULTS.fossils.y)).toMatchObject({
    text: `+${summary.fossilsAwarded} fossils`,
    fontSize: `${TYPE.vital}px`,
    color: hexCss(COLORS.checkpoint),
  });

  /**
   * The third of §9's award lines, which a real loss here cannot reach.
   *
   * `fossilAward` pays per egg kept, per migration cleared and per meat
   * unspent, so the zero case on a loss is a player who ends migration 1
   * with none of the three — `packages/content/test/content.test.ts` pins
   * that the all-zeros input pays zero, and this run banked meat it never
   * spent. Rather than contriving a drive for it, the scene is re-entered
   * with the same summary at an award of 0: `init()` is the whole of this
   * screen's input (§5.1 — it owns no `Game`), so a `scene.start` with a
   * `RunSummary` is the same entry the board makes.
   *
   * The wording is what is being checked. `No fossils for an ended run`
   * names **End run**, a button this player never pressed; telling someone
   * who lost migration 1 that would teach them a rule that does not exist.
   */
  await page.evaluate((s) => {
    window.mazeosaurResults!().scene.start("results", { ...s, fossilsAwarded: 0 });
  }, summary);
  await waitForResults(page);
  expect(await resultsLineAt(page, RESULTS.fossils.y)).toMatchObject({
    text: "No fossils earned",
    fontSize: `${TYPE.body}px`,
    color: COLORS.textDim,
  });
  expect((await resultsLineAt(page, RESULTS.headline.y))?.text).toBe("The valley is quiet");

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
