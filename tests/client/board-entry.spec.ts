import { expect, test, type Page } from "@playwright/test";
import { FRESH, RESUME, again } from "@mazeosaur/game/entry";
import {
  cellCenter,
  flushSave,
  openGame,
  paletteButtonCenter,
  replaySnapshot,
  simSnapshot,
  startBoard,
  startBoardWithNoEntry,
  trackPageErrors,
  waitAFrame,
  waitForTickAdvance,
} from "./helpers.js";

const SEED = 42;
/** Not the pinned seed, so "the board played the seed it was handed" is visible. */
const OTHER_SEED = 1234567;

/** The same off-lane cell `pause.spec.ts` builds on: it takes a dinosaur. */
const CELL = { x: 12, y: 2 };

/** Arms the first kind and taps a cell: one dinosaur, two taps, one command. */
async function place(page: Page): Promise<void> {
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await waitAFrame(page);
  const c = cellCenter(CELL.x, CELL.y);
  await page.mouse.click(c.x, c.y);
  await waitAFrame(page);
}

/**
 * Puts a run on the document the way the client does, and proves it is
 * there: one command in the log, one dinosaur on the valley. `flush()`
 * assigns `doc` synchronously, so after this the board's own document has
 * a non-null `run` — which is the state the entry modes have to disagree
 * about, and the state `title`'s New run will sit on top of.
 */
async function aRunOnTheDocument(page: Page): Promise<{ tick: number; hash: number; log: string }> {
  await place(page);
  await flushSave(page);
  const mid = await replaySnapshot(page);
  expect(JSON.parse(mid.log)).toHaveLength(1);
  expect((await simSnapshot(page)).dinos).toBe(1);
  return mid;
}

/**
 * §5.3's entry contract, from the caller's side.
 *
 * Every way into `board` says which way it is, as data on the transition.
 * The three modes exist because what separates the three entries is only
 * where the seed comes from, and the instance field that used to answer it
 * answered a different question — "is this my first `create()`" — which is
 * right for a restart and wrong for a second producer.
 *
 * These drive the transition from the harness rather than through a
 * button, because the two modes that matter most have no button yet:
 * `title`'s New run and Continue are ARB-217's to draw, and `board` has to
 * be right about them before that scene is written on top of it. The modes
 * that do have buttons are covered where the button is — `pause.spec.ts`
 * for "Restart run", `results.spec.ts` and `smoke.spec.ts` for "Again".
 */

test("a fresh entry starts a new run rather than resuming the saved one", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  const mid = await aRunOnTheDocument(page);

  await startBoard(page, FRESH);
  await waitAFrame(page);

  // The run on the document did not come back. Before the entry mode this
  // same call resumed it, because `create()` read `doc.run` whenever it was
  // non-null and nothing on this path had nulled it first — which is the
  // bug `title` would have shipped on its first New run.
  const after = await replaySnapshot(page);
  expect(JSON.parse(after.log)).toHaveLength(0);
  expect(after.hash).not.toBe(mid.hash);
  expect(await simSnapshot(page)).toMatchObject({ dinos: 0, phase: "build" });

  // And it is a live board rather than a frozen one (§5.2's restart rule).
  await waitForTickAdvance(page, after.tick);
  expect(errors.messages).toEqual([]);
});

test("a resume entry picks the saved run back up, log and all", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  const mid = await aRunOnTheDocument(page);

  await startBoard(page, RESUME);
  await waitAFrame(page);

  // The same run: the log it was saved with, replayed to the tick it
  // reached, and the dinosaur still standing. This is the control for the
  // test above — `fresh` and `resume` differ in nothing but the mode, so
  // without it a `create()` that had simply stopped resuming anything at
  // all would read as a pass.
  const after = await replaySnapshot(page);
  expect(after.log).toBe(mid.log);
  expect(after.tick).toBeGreaterThanOrEqual(mid.tick);
  expect((await simSnapshot(page)).dinos).toBe(1);

  expect(errors.messages).toEqual([]);
});

test("an again entry plays the seed it was handed, not the one the page was opened on", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // `?seed=` pins what `nextSeed()` returns, so the sim running OTHER_SEED
  // can only have got it from the transition. That is the assertion: the
  // seed of an "again" is data now, and not a field that outlived the
  // previous `create()`.
  await startBoard(page, again(OTHER_SEED));
  await waitAFrame(page);
  expect(await page.evaluate(() => window.mazeosaurBoard!().sim.seed)).toBe(OTHER_SEED);
  expect(await simSnapshot(page)).toMatchObject({ dinos: 0, phase: "build" });

  await waitForTickAdvance(page, (await simSnapshot(page)).tick);
  expect(errors.messages).toEqual([]);
});

/**
 * §5.3's third-producer hazard, made loud. Last in the file because it
 * leaves the board deliberately unstarted.
 *
 * Phaser keeps `settings.data` from the previous start, so a caller that
 * passes nothing does not arrive as `undefined` — it inherits the last
 * caller's mode. That is why `BoardScene.init` consumes the entry rather
 * than only reading it. The old shape's failure on this path was silent and
 * was a resume: the board handed back whatever run was on the document.
 */
test("an entry with no mode throws at the transition instead of resuming something", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  await aRunOnTheDocument(page);

  await startBoardWithNoEntry(page);
  await waitAFrame(page);

  const thrown = errors.messages.join("\n");
  expect(thrown, `expected the data-less entry to throw, got:\n${thrown}`).toContain("every entry says which way it is");
});
