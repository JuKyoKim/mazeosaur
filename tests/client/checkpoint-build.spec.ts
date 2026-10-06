import { expect, test } from "@playwright/test";
import {
  SEND_BUTTON,
  SPEED_BUTTON,
  cellCenter,
  openGame,
  paletteButtonCenter,
  selectionSnapshot,
  simSnapshot,
  trackPageErrors,
  waitAFrame,
} from "./helpers.js";

const SEED = 221;

/**
 * `content.valley.lane` — the cells the board marks `1`, `2`, `S` and `N`.
 * The two checkpoints are buildable and the spawn is not, which is the whole
 * subject of this spec, so they are named rather than derived: a content edit
 * that moves them should fail here loudly instead of quietly testing a
 * different cell.
 */
const CHECKPOINT_1 = { x: 19, y: 9 };
const CHECKPOINT_2 = { x: 0, y: 18 };
const SPAWN = { x: 0, y: 0 };

/** Arms the first palette card and taps `cell`, one frame behind each input. */
async function selectAndTap(page: import("@playwright/test").Page, cell: { x: number; y: number }): Promise<void> {
  const button = paletteButtonCenter(0);
  await page.mouse.click(button.x, button.y);
  await waitAFrame(page);
  expect((await selectionSnapshot(page)).kindId).not.toBeNull();
  const at = cellCenter(cell.x, cell.y);
  await page.mouse.click(at.x, at.y);
  await waitAFrame(page);
}

function migrationIndex(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => window.mazeosaurBoard!().sim.state.migration);
}

function dinoCells(page: import("@playwright/test").Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => window.mazeosaurBoard!().sim.state.dinos.map((d) => ({ x: d.x, y: d.y })));
}

test("a dinosaur stands on both checkpoints and the migration still walks every leg", async ({ page }, testInfo) => {
  // A whole migration walked end to end is well past the config's 60 s
  // default even at 3x.
  test.setTimeout(180_000);
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  // Each checkpoint takes a dinosaur: the owner's "points 1 and 2 needs to
  // not be physically blocking".
  await selectAndTap(page, CHECKPOINT_1);
  await selectAndTap(page, CHECKPOINT_2);
  expect(await dinoCells(page)).toEqual([CHECKPOINT_1, CHECKPOINT_2]);

  // The spawn still refuses, so "buildable" did not become "anywhere".
  await selectAndTap(page, SPAWN);
  expect(await dinoCells(page)).toEqual([CHECKPOINT_1, CHECKPOINT_2]);

  await testInfo.attach("both-checkpoints-occupied", {
    body: await page.screenshot({ path: testInfo.outputPath("both-checkpoints-occupied.png") }),
    contentType: "image/png",
  });

  // The routing is what the owner asked to keep. A leak is the only state
  // that proves every leg finished: the invader reached the nest, which it
  // can only do by completing leg 0 and leg 1 beside the two occupied
  // waypoints first.
  const migrationBefore = await migrationIndex(page);
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("migration");
  // 3x, because six invaders crossing the valley three times is minutes of
  // wall clock at 1x. Speed is ticks per frame and nothing else, so the run
  // the assertions below see is the same run.
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await page.mouse.click(SPEED_BUTTON.x, SPEED_BUTTON.y);
  await waitAFrame(page);

  await page.waitForFunction(
    () => window.mazeosaurBoard!().sim.state.invaders.some((i) => !i.flying && i.leg > 0),
    undefined,
    { timeout: 60_000 },
  );
  await testInfo.attach("invaders-past-checkpoint-1", {
    body: await page.screenshot({ path: testInfo.outputPath("invaders-past-checkpoint-1.png") }),
    contentType: "image/png",
  });

  // Leg 2 is the run to the nest, so a ground invader on it has finished both
  // checkpoint legs with a dinosaur standing on each waypoint. Not pinned to
  // the first migration: two hatchlings may kill a whole early wave short of
  // the nest, and which wave supplies the invader is not the claim.
  await page.waitForFunction(
    () => window.mazeosaurBoard!().sim.state.invaders.some((i) => !i.flying && i.leg > 1),
    undefined,
    { timeout: 60_000 },
  );
  await testInfo.attach("invaders-past-checkpoint-2", {
    body: await page.screenshot({ path: testInfo.outputPath("invaders-past-checkpoint-2.png") }),
    contentType: "image/png",
  });

  // And the migration ends, which is the softlock guard: an invader that
  // could not finish a leg would stand still and the phase would never flip.
  await page.waitForFunction(() => window.mazeosaurBoard!().sim.state.phase !== "migration", undefined, { timeout: 120_000 });
  expect(await migrationIndex(page)).toBeGreaterThan(migrationBefore);
  expect(errors.messages).toEqual([]);
});
