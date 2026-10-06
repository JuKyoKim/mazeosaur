import { expect, test } from "@playwright/test";
import { CONTENT_W, RESULTS, TYPE } from "@mazeosaur/game/layout";
import { COLORS } from "@mazeosaur/game/theme";
import {
  AGAIN_BUTTON,
  END_RUN_BUTTON,
  PAUSE_BUTTON,
  PAUSE_SCRIM_BARE,
  RESTART_RUN_BUTTON,
  RESUME_BUTTON,
  SEND_BUTTON,
  SPEED_BUTTON,
  airRouteSnapshot,
  bankedProfile,
  cellCenter,
  clockSnapshot,
  firstFlierMigration,
  openGame,
  paletteButtonCenter,
  replaySnapshot,
  resultsLineAt,
  resultsShown,
  resultsSummary,
  setMigration,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
  waitForResults,
  waitForTickAdvance,
} from "./helpers.js";

const SEED = 218;

// The same off-lane cells `smoke.spec.ts` builds on: not spawn, not a
// checkpoint, not the nest, so they take a dinosaur without depending on
// map data.
const CELL = { x: 12, y: 2 };
const WALL = [
  { x: 12, y: 2 },
  { x: 13, y: 2 },
];

/** Long enough that twenty ticks would have been taken at 1x (TICK_MS is 50). */
const A_SECOND = 1000;

/** Arms the first kind and taps a cell: one dinosaur, two taps, one-shot. */
async function place(page: import("@playwright/test").Page, cell: { x: number; y: number }): Promise<void> {
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await waitAFrame(page);
  const c = cellCenter(cell.x, cell.y);
  await page.mouse.click(c.x, c.y);
  await waitAFrame(page);
}

/**
 * The pause menu, driven the way a thumb drives it.
 *
 * The load-bearing claim is that a pause is **the client's clock stopping,
 * not a state the sim is in**: `packages/sim` is pure and has no timers, so
 * `BoardScene.update()` declining to call `tick()` is the whole mechanism.
 * Nothing may enter the command log, `state.tick` may not move, and the
 * hash of the resumed run has to be the hash it had when the menu opened —
 * otherwise a replay, a save or a server verification of a run that was
 * ever paused disagrees with the run that was played.
 * `packages/sim/test/save.test.ts` proves that round trip below the client;
 * these tests prove the client does not quietly add a tick or a command.
 *
 * It also carries the restart half of the gap `restart-regression.spec.ts`
 * covers. That spec restarts the scene straight off a page load, where
 * nothing has autosaved yet; the pause menu's "Restart run" is the first
 * path that restarts **mid-run**, with a live run already on `doc`. That
 * run coming back used to be the hazard — `create()` read `doc.run`
 * whenever it was non-null, so the restart was only safe because
 * `abandonRun()` had nulled it first. §5.3's entry mode is what makes it
 * safe now: `again` does not read the document's run, so this test asserts
 * a contract rather than an ordering. The seed still has to survive, and
 * the two per-run fields (`paused`, `abandoned`) are still state the
 * restart rule has to reset.
 */
test("pause stops the clock without the sim knowing, and resume picks the same run back up", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // A placement first, so "the log did not change across the pause" is a
  // real assertion rather than two empty arrays agreeing.
  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  // The clock is running before the pause, which is what makes it stopping
  // afterwards mean anything. The build phase ticks its own timer down, so
  // this does not need a migration in flight.
  const running = await replaySnapshot(page);
  await waitForTickAdvance(page, running.tick);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: true, abandoned: false });

  // Real wall-clock time, because that is the thing a pause has to absorb:
  // `update()` keeps being called every frame while the menu is up, and the
  // accumulator it would normally feed is what must not move.
  const atPause = await replaySnapshot(page);
  await page.waitForTimeout(A_SECOND);
  await waitAFrame(page);
  expect(await replaySnapshot(page)).toEqual(atPause);

  await page.mouse.click(RESUME_BUTTON.x, RESUME_BUTTON.y);
  await waitAFrame(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: false, abandoned: false });

  // The same run, continuing: the tick moves again from where it stopped,
  // the log is byte-identical, and the dinosaur placed before the pause is
  // still standing.
  await waitForTickAdvance(page, atPause.tick);
  expect((await replaySnapshot(page)).log).toBe(atPause.log);
  expect((await simSnapshot(page)).dinos).toBe(1);

  // Tapping the scrim is the other way out, and the scrim is also what
  // keeps a tap off the live HUD behind it.
  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(true);
  await page.mouse.click(PAUSE_SCRIM_BARE.x, PAUSE_SCRIM_BARE.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(false);
  await waitForTickAdvance(page, (await replaySnapshot(page)).tick);

  expect(errors.messages).toEqual([]);
});

test("restart from the pause menu starts a fresh run mid-run, not the one it threw away", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  const before = await simSnapshot(page);
  expect(before.dinos).toBe(0);

  for (const cell of WALL) await place(page, cell);

  // Sending the migration is the part that matters: `migration-started`
  // autosaves, which is what puts a live run on `doc` — the state a
  // mid-run restart has to discard rather than resume.
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("migration");

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(RESTART_RUN_BUTTON.x, RESTART_RUN_BUTTON.y);
  await waitAFrame(page);

  // Back to a run's opening state: the build phase, the starting meat and
  // eggs, and an empty valley. Four dinosaurs in `migration` would be the
  // discarded run coming back.
  const fresh = await simSnapshot(page);
  expect(fresh).toMatchObject({ meat: before.meat, eggs: before.eggs, dinos: 0, phase: "build" });
  // Section 5.3: a restart is "again (same seed)".
  expect(await page.evaluate(() => window.mazeosaurBoard!().sim.seed)).toBe(SEED);
  // Both new per-run fields reset, which is the restart rule applied to
  // them: a `paused` that survived the restart would freeze the new run.
  expect(await clockSnapshot(page)).toMatchObject({ paused: false, abandoned: false, speed: 1 });

  // The canvas is still rendering, which is the destroyed-display-object
  // regression `restart-regression.spec.ts` exists for, here on the
  // mid-run path.
  await waitForTickAdvance(page, fresh.tick);

  expect(errors.messages).toEqual([]);
});

test("ending the run lands on results as `abandoned`, and leaves nothing to resume", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // Read before the run is thrown away, so the assertion below is "these
  // two numbers did not move" and not "these two numbers happen to be 0".
  const banked = await bankedProfile(page);
  expect(await resultsShown(page)).toBe(false);

  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(END_RUN_BUTTON.x, END_RUN_BUTTON.y);
  await waitForResults(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: true, abandoned: true });

  // §5.4's third outcome, and the screen it is drawn on: the same
  // `results` a win and a loss reach, not an overlay of its own.
  const summary = await resultsSummary(page);
  expect(summary.outcome).toBe("abandoned");
  expect(summary.seed).toBe(SEED);

  // **The point of the issue.** Quitting pays nothing: `flush()` tests the
  // `won` and `lost` phases only, so no fossil award is produced and the
  // run is not counted as finished. Without that, "End run" is the optimal
  // way to farm fossils — a balance hole dressed as a kindness.
  expect(summary.fossilsAwarded).toBe(0);
  expect(await bankedProfile(page)).toEqual(banked);

  // And what the player is told it was, which is the other half of the same
  // rule. §9 (ARB-322) gives this outcome its own headline: a quit is not a
  // defeat, so "The valley is quiet" here would tell someone who walked away
  // that the nest had fallen — the exact wrong string the `Record<Outcome,
  // string>` in `ResultsScene` exists to make unreachable.
  const headline = await resultsLineAt(page, RESULTS.headline.y);
  expect(headline?.text).toBe("The pack withdraws");
  // Centred and never wrapped, so a headline wider than the content column
  // is clipped at the canvas edge rather than reflowed. §9's bound, not its
  // measured px: the face is whatever this machine resolves `system-ui` to.
  expect(headline?.width).toBeLessThanOrEqual(CONTENT_W);

  // The zero award says why, quietly: `body` in `textDim` and not `vital` in
  // checkpoint yellow, because yellow at `vital` is this screen's reward
  // signal and a zero is not a prize (§9). The size and the colour are the
  // assertion as much as the words are — keeping the string and dropping the
  // de-emphasis is the regression this is here for.
  const award = await resultsLineAt(page, RESULTS.fossils.y);
  expect(award).toMatchObject({
    text: "No fossils for an ended run",
    fontSize: `${TYPE.body}px`,
    color: COLORS.textDim,
  });

  // An ended run's phase is still `build`, so unlike a win or a loss there
  // is nothing but the stopped clock to keep the board from ticking on
  // behind the results scrim.
  const ended = await replaySnapshot(page);
  await page.waitForTimeout(A_SECOND);
  await waitAFrame(page);
  expect(await replaySnapshot(page)).toEqual(ended);

  // And the board underneath takes no input, though it is still in `build`
  // and all of its controls would accept one. `showResults()` pauses the
  // scene, which takes its input plugin down with it, and `ResultsScene`'s
  // scrim swallows what is left.
  //
  // The speed toggle and Pause, and deliberately **not** Send: §9 puts
  // `Again` in the HUD band "at the same height Send was, so the thumb does
  // not move between the run that ended and the next one", and it is 328
  // wide against row 1's 82 — so `RESULTS.again` spans x 196–524 and Send's
  // centre at 485 is inside it. A tap there is a tap on Again, which starts
  // the next run; it proves nothing about the one that ended. The speed
  // toggle (663) and Pause (533–615) are the two controls clear of it.
  expect((await clockSnapshot(page)).speed).toBe(1);
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  // A live board would have doubled the speed and re-raised the menu; a
  // dead one is still on the results screen at 1x.
  expect((await clockSnapshot(page)).speed).toBe(1);
  expect(await resultsShown(page)).toBe(true);
  expect(await replaySnapshot(page)).toEqual(ended);
  expect((await simSnapshot(page)).phase).toBe("build");

  // Nothing to resume. `flush()` is the same function `autosave()` and
  // `GameHandle.suspend()` call, awaited here so the reload is a test of
  // load-and-resume rather than of `pagehide`'s race.
  await page.evaluate(() => window.mazeosaurBoard!().flush());
  await page.reload();
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.mazeosaur?.phaser.scene.keys["board"] !== undefined);
  await waitAFrame(page);

  // One dinosaur and a non-zero tick here would be the ended run coming
  // back off disk.
  const afterReload = await simSnapshot(page);
  expect(afterReload).toMatchObject({ dinos: 0, phase: "build" });
  await waitForTickAdvance(page, afterReload.tick);

  expect(errors.messages).toEqual([]);
});

/**
 * "Again" on the results screen a quit lands on, clicked — the second half
 * of §5.3's loop from the one entrance into it that is not a win or a loss.
 *
 * The assertions are about **taps landing**, not about a screen being gone.
 * `overlay` is a per-run field holding a display object, and `wireInput`'s
 * `pointerdown` returns early whenever it is set, so a board that came back
 * without `create()` nulling it restarts, resets its sim and redraws its
 * HUD while swallowing every tap before `cellAt` — including the pause
 * button's. That looks entirely correct in a sim snapshot and in a
 * screenshot; it only shows up when something is clicked. It is the
 * ARB-312 defect, and the pause menu still sets the field this path leaves
 * behind, so the reset is still what this spec is guarding.
 */
test("Again after a quit gives back a board that takes a tap", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(END_RUN_BUTTON.x, END_RUN_BUTTON.y);
  await waitForResults(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: true, abandoned: true });

  await page.mouse.click(AGAIN_BUTTON.x, AGAIN_BUTTON.y);
  await waitAFrame(page);
  expect(await resultsShown(page)).toBe(false);

  // A run's opening state, on the same seed: §5.3's "again (same seed)".
  // Not `tick: 0` — the clock is running again by the time this is read,
  // which is the point of `waitForTickAdvance` below.
  const fresh = await simSnapshot(page);
  expect(fresh).toMatchObject({ dinos: 0, phase: "build" });
  expect(await page.evaluate(() => window.mazeosaurBoard!().sim.seed)).toBe(SEED);
  expect(await clockSnapshot(page)).toMatchObject({ paused: false, abandoned: false, speed: 1 });
  await waitForTickAdvance(page, fresh.tick);

  // The assertion the regression turns on: two taps, one dinosaur. A
  // stale `overlay` makes this 0 while everything above still passes.
  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  // And the pause button, which guards on the same field, so a stale
  // `overlay` locks the player out of the menu as well as the board.
  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(true);
  await page.mouse.click(RESUME_BUTTON.x, RESUME_BUTTON.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(false);
  await waitForTickAdvance(page, (await replaySnapshot(page)).tick);

  expect(errors.messages).toEqual([]);
});

/**
 * The pause has to stop everything that is drawn on a clock, not just the
 * sim's. Effects already age on the stopped clock for this reason; the
 * fliers' air route was the other one, and it is the loudest — a line of
 * lights marching spawn-to-nest over a frozen migration reads as the game
 * still being alive, which is the one thing a pause has to deny.
 *
 * Asserts the freeze, not the motion: that the lights march at all is
 * `smoke.spec.ts`'s claim, and two samples of a triangle wave taken while
 * the clock runs are unequal only up to float luck.
 */
test("the fliers' air route holds still under the pause scrim", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // The route is only drawn for a migration that actually has a flier in
  // it, so the pause has nothing to freeze until one is named.
  await setMigration(page, await firstFlierMigration(page));
  await waitAFrame(page);
  expect((await airRouteSnapshot(page)).shown).toBe(true);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(true);

  // A full blink cycle of wall clock, which is what the lights would have
  // marched through had they been reading `time.now`.
  const atPause = await airRouteSnapshot(page);
  await page.waitForTimeout(A_SECOND);
  await waitAFrame(page);
  expect(await airRouteSnapshot(page)).toEqual(atPause);

  // And the route comes back with the run: still drawn, on a clock that is
  // running again. Not asserted here: that the wave resumes exactly where
  // it stopped. It does — `pause()` folds the session into `playedMsBase`
  // before stopping, so the clock does not jump at either edge — but the
  // number of frames between a click and a read is not fixed, and at ~1000
  // frame-ms per cycle a tolerance wide enough never to flake is wide
  // enough to pass on a clock that jumped.
  await page.mouse.click(RESUME_BUTTON.x, RESUME_BUTTON.y);
  await waitAFrame(page);
  expect((await clockSnapshot(page)).paused).toBe(false);
  expect((await airRouteSnapshot(page)).shown).toBe(true);
  await waitForTickAdvance(page, (await replaySnapshot(page)).tick);

  expect(errors.messages).toEqual([]);
});
