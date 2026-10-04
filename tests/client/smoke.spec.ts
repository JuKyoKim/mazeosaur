import { expect, test } from "@playwright/test";
import {
  GROW_BUTTON,
  PLAY_AGAIN_BUTTON,
  SELL_BUTTON,
  SEND_BUTTON,
  SPEED_BUTTON,
  cellCenter,
  loseOnNextLeak,
  openGame,
  paletteButtonCenter,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
  waitForEggsBelow,
  waitForRunOver,
  waitForTickAdvance,
} from "./helpers.js";

const SEED = 123;

// Off the direct spawn-to-checkpoint line (lane runs roughly from (0,0) to
// (19,9)), so these dinosaurs see no invaders and every migration-1 invader
// is free to walk to the nest and leak. That is the point: we need a leak,
// not a kill.
const DRAG_FROM = { x: 12, y: 2 };
const DRAG_TO = { x: 15, y: 2 };

test("full run: place, drag-paint at speed, grow, sell, send, leak, lose, play again", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // Explicitly select the cheapest hatchling rather than relying on the
  // palette's default selection, so the test still means something if that
  // default changes.
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);

  const before = await simSnapshot(page);
  expect(before.dinos).toBe(0);

  // Place a dinosaur, then drag fast to paint a line of walls. A real finger
  // skips cells between pointermove events; a single fast jump (no
  // intermediate steps) is exactly that. Placement must interpolate the
  // line between events, or this line has gaps a slow-drag test would miss.
  const from = cellCenter(DRAG_FROM.x, DRAG_FROM.y);
  const to = cellCenter(DRAG_TO.x, DRAG_TO.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up();
  await waitAFrame(page);

  const afterDrag = await simSnapshot(page);
  // Exclusive start, inclusive end: 12,13,14,15 at y=2 is 4 cells. Without
  // interpolation only the pointerdown cell and the final pointermove cell
  // would place, i.e. 2 — the exact bug this harness exists to catch.
  expect(afterDrag.dinos).toBe(4);
  expect(afterDrag.meat).toBe(before.meat - 4 * 10);

  // Grow the first dinosaur placed.
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
  await waitAFrame(page);

  // Sell a different one.
  await page.mouse.click(to.x, to.y);
  await page.mouse.click(SELL_BUTTON.x, SELL_BUTTON.y);
  await waitAFrame(page);

  const afterGrowSell = await simSnapshot(page);
  expect(afterGrowSell.dinos).toBe(3);

  // Send the migration early instead of waiting out the build timer.
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("migration");

  // Run at 3x so a real invader walk doesn't make this test slow.
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);

  // Nothing is in the invaders' way, so a leak is a certainty, not a race.
  await waitForEggsBelow(page, 20);

  // End the run and restart it the way a player does: the next leak loses
  // the nest, the client raises its own overlay, and the test clicks the
  // real "Play again" button on it.
  //
  // Calling `scene.restart()` straight out of a live migration would not
  // test this any more. Since saves landed, `flush()` keeps the in-flight
  // run on `doc`, and a restart mid-run therefore *resumes* it (see the
  // restart note in `BoardScene.create()`) — which is correct, and is why
  // the only `scene.restart()` in the client sits behind an overlay that
  // appears after the won/lost `flush()` has written `run: null`.
  await loseOnNextLeak(page);
  await waitForRunOver(page);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("lost");

  await page.mouse.click(PLAY_AGAIN_BUTTON.x, PLAY_AGAIN_BUTTON.y);
  await waitAFrame(page);

  const afterRestart = await simSnapshot(page);
  expect(afterRestart).toMatchObject({ meat: 60, eggs: 20, dinos: 0, phase: "build" });

  // The regression this harness exists for: a destroyed display object
  // referenced after restart stalls the update loop while the sim
  // underneath has already reset. Prove liveness by the sim's own tick
  // counter advancing — a WebGL canvas without `preserveDrawingBuffer`
  // can't be trusted by sampling pixels.
  await waitForTickAdvance(page, afterRestart.tick);

  expect(errors.messages).toEqual([]);
});
