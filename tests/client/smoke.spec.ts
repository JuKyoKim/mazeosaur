import { expect, test } from "@playwright/test";
import {
  GROW_BUTTON,
  HUD_BARE,
  PLAY_AGAIN_BUTTON,
  SELL_BUTTON,
  SEND_BUTTON,
  SPEED_BUTTON,
  cellCenter,
  loseOnNextLeak,
  openGame,
  paletteButtonCenter,
  selectionSnapshot,
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
const WALL = [
  { x: 12, y: 2 },
  { x: 13, y: 2 },
  { x: 14, y: 2 },
  { x: 15, y: 2 },
];
/** One more cell on the same row, placed without re-arming the tray. */
const AFTER_REFUSAL = { x: 16, y: 2 };

// The lane's spawn cell. `buildRefusal` rejects the spawn, both
// checkpoints and the nest outright, so this is a refusal that does not
// depend on what is already built or on how much meat is left — and
// `content.valley.rock` is empty, so a lane cell is the only terrain that
// can refuse at all.
const LANE_CELL = { x: 0, y: 0 };

const HATCHLING_COST = 10;

test("full run: arm, place four taps, grow, sell, send, leak, lose, play again", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // Nothing is armed until a card is tapped, which is the state a run
  // starts in. Arming has to be a step of the test because it is a step
  // for the player.
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  // Phaser queues DOM pointer events and processes them in its own step,
  // so every assertion about input here has to be one frame behind the
  // click that caused it — the same reason a screenshot does.
  await waitAFrame(page);
  const armed = (await selectionSnapshot(page)).kindId;
  expect(armed).not.toBeNull();

  const before = await simSnapshot(page);
  expect(before.dinos).toBe(0);

  // Four discrete taps, four dinosaurs. This replaces a drag-interpolation
  // assertion: what it proves now is that the selection is **sticky**, so
  // a wall costs one tap per cell and not a re-arm between each. If a
  // placement cleared the selection, taps two through four would be
  // swallowed and this would read 1.
  for (const cell of WALL) {
    const c = cellCenter(cell.x, cell.y);
    await page.mouse.click(c.x, c.y);
    await waitAFrame(page);
    // The armed kind must be the same one after every placement, not just
    // at the end — a selection cleared and re-defaulted by `buildHud`'s
    // fallback would still end up non-null.
    expect((await selectionSnapshot(page)).kindId).toBe(armed);
  }

  const afterWall = await simSnapshot(page);
  expect(afterWall.dinos).toBe(WALL.length);
  expect(afterWall.meat).toBe(before.meat - WALL.length * HATCHLING_COST);

  // A refused tap must not disarm the tray. Tap the lane's spawn cell,
  // which always refuses, then tap a valid cell with no re-arm in
  // between: if the refusal had cleared the selection, the second tap
  // would place nothing.
  const lane = cellCenter(LANE_CELL.x, LANE_CELL.y);
  await page.mouse.click(lane.x, lane.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).dinos).toBe(WALL.length);
  expect((await selectionSnapshot(page)).kindId).toBe(armed);

  const extra = cellCenter(AFTER_REFUSAL.x, AFTER_REFUSAL.y);
  await page.mouse.click(extra.x, extra.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).dinos).toBe(WALL.length + 1);

  // Grow the first dinosaur placed.
  const first = cellCenter(WALL[0]!.x, WALL[0]!.y);
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
  await waitAFrame(page);

  // Sell a different one.
  const last = cellCenter(WALL[WALL.length - 1]!.x, WALL[WALL.length - 1]!.y);
  await page.mouse.click(last.x, last.y);
  await page.mouse.click(SELL_BUTTON.x, SELL_BUTTON.y);
  await waitAFrame(page);

  const afterGrowSell = await simSnapshot(page);
  expect(afterGrowSell.dinos).toBe(WALL.length);

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

/**
 * The two ways out of the armed state. Before tap-to-place there was no
 * way out at all — `selectedDef` was set by the tray and never cleared —
 * so neither of these has ever had coverage, and the failure mode is a
 * player stuck in a mode where every tap on the valley spends meat.
 */
test("selection: the lit card and bare HUD both cancel, and a cancelled tray places nothing", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  const card = paletteButtonCenter(0);
  const empty = cellCenter(WALL[0]!.x, WALL[0]!.y);

  // Cancel by re-tapping the lit card.
  await page.mouse.click(card.x, card.y);
  await waitAFrame(page);
  const armed = (await selectionSnapshot(page)).kindId;
  expect(armed).not.toBeNull();

  await page.mouse.click(card.x, card.y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).kindId).toBeNull();

  // A cleared tray is really cleared: a tap on an empty cell is inert
  // rather than falling back to whatever was armed last.
  const before = await simSnapshot(page);
  await page.mouse.click(empty.x, empty.y);
  await waitAFrame(page);
  expect(await simSnapshot(page)).toMatchObject({ dinos: before.dinos, meat: before.meat });

  // Cancel by tapping HUD that is not a control. This is the one gesture
  // that can collide with the tray: a tray card only avoids cancelling
  // itself because `button()` stops propagation before the scene's own
  // `pointerdown` runs. The re-arm below is the assertion that it does —
  // if it did not, this click would select and immediately clear.
  await page.mouse.click(card.x, card.y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).kindId).toBe(armed);

  await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).kindId).toBeNull();

  await page.mouse.click(empty.x, empty.y);
  await waitAFrame(page);
  expect(await simSnapshot(page)).toMatchObject({ dinos: before.dinos, meat: before.meat });

  expect(errors.messages).toEqual([]);
});

/**
 * The preview is the only thing that tells a player a tap landed on a cell
 * that will not take a dinosaur. "Nothing drawn" is the failure mode: it
 * reads as a tap the client dropped. The draw itself is pixels on a WebGL
 * canvas and not assertable here, so what this covers is the state the
 * draw is keyed off — that a *tap* arms it at all, which a touchscreen
 * cannot do by hovering.
 */
test("preview: a tap arms the preview cell, including the tap that was refused", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).preview).toBeNull();

  const lane = cellCenter(LANE_CELL.x, LANE_CELL.y);
  await page.mouse.click(lane.x, lane.y);
  await waitAFrame(page);
  const refused = await selectionSnapshot(page);
  expect(refused.preview).toEqual(LANE_CELL);
  expect(refused.kindId).not.toBeNull();
  expect((await simSnapshot(page)).dinos).toBe(0);

  // Cancelling takes the preview with it, or a stale square is left
  // sitting on the valley with nothing armed to place there.
  await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).preview).toBeNull();

  expect(errors.messages).toEqual([]);
});

/**
 * The two selections are mutually exclusive, per §4 of
 * `docs/01-art-hud-and-audio.md`: a kind armed in the tray and a placed
 * dinosaur under inspection are never live at once. The value of it is that
 * "what will a tap on a cell do" has one answer readable from one field.
 *
 * This is the one place the spec overrode the behaviour that was here
 * before, so it is asserted rather than left to the comment: opening a
 * sheet used to leave the tray armed, and the tap that dismissed the sheet
 * then placed in the same gesture. With exclusion there is nothing left
 * armed to place, and the dismissing tap has to be inert — otherwise a
 * player who taps a dinosaur to read its range pays 10 meat to stop
 * reading it.
 */
test("selection: a sheet and an armed card are never both live", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await waitAFrame(page);

  const wall = cellCenter(WALL[0]!.x, WALL[0]!.y);
  await page.mouse.click(wall.x, wall.y);
  await waitAFrame(page);
  const placed = await simSnapshot(page);
  expect(placed.dinos).toBe(1);
  expect((await selectionSnapshot(page)).kindId).not.toBeNull();

  // Tapping the dinosaur opens its sheet and disarms the tray.
  await page.mouse.click(wall.x, wall.y);
  await waitAFrame(page);
  const inspecting = await selectionSnapshot(page);
  expect(inspecting.dinoId).not.toBeNull();
  expect(inspecting.kindId).toBeNull();

  // Dismissing it on an empty cell closes the sheet and places nothing,
  // and does not restore the kind the sheet replaced.
  const empty = cellCenter(AFTER_REFUSAL.x, AFTER_REFUSAL.y);
  await page.mouse.click(empty.x, empty.y);
  await waitAFrame(page);
  const after = await selectionSnapshot(page);
  expect(after.dinoId).toBeNull();
  expect(after.kindId).toBeNull();
  expect(await simSnapshot(page)).toMatchObject({ dinos: 1, meat: placed.meat });

  expect(errors.messages).toEqual([]);
});
