import { expect, test } from "@playwright/test";
import {
  END_RUN_BUTTON,
  PAUSE_BUTTON,
  PAUSE_SCRIM_BARE,
  PLAY_AGAIN_BUTTON,
  RESTART_RUN_BUTTON,
  RESUME_BUTTON,
  SEND_BUTTON,
  airRouteSnapshot,
  cellCenter,
  clockSnapshot,
  firstFlierMigration,
  openGame,
  paletteButtonCenter,
  replaySnapshot,
  setMigration,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
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
 * path that restarts **mid-run**, with a live run already on `doc` — which
 * `BoardScene.create()` resumes unless the restart discards it first. A
 * restart that skipped the discard would hand back the very run it was
 * asked to throw away, and the two new per-run fields (`paused`,
 * `abandoned`) are state the restart rule now has to reset.
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

test("ending the run shows the end-of-run screen and leaves nothing to resume", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(END_RUN_BUTTON.x, END_RUN_BUTTON.y);
  await waitAFrame(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: true, abandoned: true });

  // An ended run's phase is still `build`, so unlike a win or a loss there
  // is nothing but the stopped clock to keep the board from ticking on
  // behind the overlay.
  const ended = await replaySnapshot(page);
  await page.waitForTimeout(A_SECOND);
  await waitAFrame(page);
  expect(await replaySnapshot(page)).toEqual(ended);

  // And the scrim swallows the tap, so Send — which is live, in `build`,
  // directly underneath — cannot take a command on a run that is over.
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
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
 * "Play again" on the ended-run overlay, clicked.
 *
 * This is the one `scene.restart()` a finger can still reach — the results
 * screen's "Again" is a `scene.start("board")` from another scene, and
 * `restart-regression.spec.ts` drives `scene.restart()` from the harness
 * rather than through a button. So it is the only place a spec can catch
 * the pair that broke here: `showOverlay`'s button restarts *without*
 * calling `closeOverlay()`, which is only safe because `create()` nulls
 * `overlay` — and `wireInput`'s `pointerdown` returns early whenever that
 * field is set. Drop the reset and every tap on the restarted board is
 * swallowed before `cellAt`, including the pause button's.
 *
 * Which is why the assertions are about **taps landing**, not about the
 * overlay being gone. A board that restarted, reset its sim, and redrew
 * its HUD but takes no input looks entirely correct in a sim snapshot and
 * in a screenshot; it only shows up when something is clicked.
 */
test("Play again on the ended-run screen gives back a board that takes a tap", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await place(page, CELL);
  expect((await simSnapshot(page)).dinos).toBe(1);

  await page.mouse.click(PAUSE_BUTTON.x, PAUSE_BUTTON.y);
  await waitAFrame(page);
  await page.mouse.click(END_RUN_BUTTON.x, END_RUN_BUTTON.y);
  await waitAFrame(page);
  expect(await clockSnapshot(page)).toMatchObject({ paused: true, abandoned: true });

  await page.mouse.click(PLAY_AGAIN_BUTTON.x, PLAY_AGAIN_BUTTON.y);
  await waitAFrame(page);

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
