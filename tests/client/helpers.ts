import type { ConsoleMessage, Page } from "@playwright/test";
import type { BoardScene, GameHandle } from "@mazeosaur/game";
import { BOARD_H, CANVAS_W, CELL_PX, ROW1, ROW2, ROW3, kindButtonX } from "@mazeosaur/game/layout";

/**
 * Where to click. The board is one canvas with no DOM to query, so driving
 * it means clicking the same pixels a finger would — and those pixels come
 * from `packages/game/src/layout.ts`, imported rather than copied.
 *
 * Importing is the point. This file used to write the HUD's geometry out by
 * hand, which is the same defect ARB-186 fixed in the scene: a number that
 * exists twice agrees only until somebody edits one of the two. The import
 * resolves through the workspace symlink to a real path inside the repo, so
 * Playwright transforms it like any other spec file — `dino-sheet.spec.ts`
 * has imported `SHEET_COL_W` the same way since ARB-84.
 */
export { CANVAS_W, CELL_PX };

export function cellCenter(x: number, y: number): { x: number; y: number } {
  return { x: x * CELL_PX + CELL_PX / 2, y: y * CELL_PX + CELL_PX / 2 };
}

const center = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Center of the Nth kind card in the shop tray, left to right. */
export function paletteButtonCenter(index: number): { x: number; y: number } {
  return center({ ...ROW3.kindButton, x: kindButtonX(index) });
}

export const SEND_BUTTON = center(ROW1.send);
export const SPEED_BUTTON = center(ROW1.speed);
export const GROW_BUTTON = center(ROW3.grow);
export const SELL_BUTTON = center(ROW3.sell);

/**
 * A point in the HUD that is not any control: row 2, the migration line.
 * Nothing in that row takes a pointer — it is information only, which is
 * why §4 lets it sit under the hit floor — and Text objects are not
 * interactive, so a tap here reaches the scene's own `pointerdown`. That is
 * the "tap away to put the dinosaur back" half of cancel, and row 2 is now
 * the only place on the canvas that is neither a cell nor a control: row 3
 * is wall-to-wall tray.
 */
export const HUD_BARE = { x: CANVAS_W / 2, y: ROW2.y + ROW2.h / 2 };

/** The "Play again" button on the won/lost overlay (`showOverlay`). */
export const PLAY_AGAIN_BUTTON = { x: CANVAS_W / 2, y: BOARD_H / 2 + 60 + 64 / 2 };

/**
 * What the harness reaches for inside the page, declared against the real
 * types so `npm run typecheck` fails if the client's shape moves under it.
 * That is the point of typing these at all: the previous harness reached
 * `window.mazeosaur.scene.keys.board`, which went stale the moment
 * `mountGame` started returning a `GameHandle` instead of a `Phaser.Game`,
 * and nothing said so until a browser run three weeks later.
 *
 * `mazeosaur` is set by `apps/web/src/main.ts` under `import.meta.env.DEV`,
 * so every spec here depends on the dev server, not a production build.
 * `mazeosaurBoard` is installed by `openGame` below.
 */
declare global {
  interface Window {
    mazeosaur?: GameHandle;
    mazeosaurBoard?: () => BoardScene;
  }
}

export interface PageErrors {
  readonly messages: string[];
}

/** Captures uncaught exceptions and console.error calls for the life of the page. */
export function trackPageErrors(page: Page): PageErrors {
  const messages: string[] = [];
  page.on("pageerror", (err) => messages.push(`pageerror: ${err.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") messages.push(`console.error: ${msg.text()}`);
  });
  return { messages };
}

/**
 * The renderer draws on the next animation frame; a capture or an assertion
 * made in the same instant as an input sees the state before it, which
 * looks like a bug that is not there. Wait two frames to be safe.
 */
export async function waitAFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Loads the game pinned to a seed and waits for the first real frame.
 *
 * Two things this has to wait for that a `?seed=` page load does not give
 * for free. `main.ts` boots asynchronously — it reads the save out of
 * IndexedDB before it calls `mountGame` — so the canvas and
 * `window.mazeosaur` appear some time after `goto` resolves. And the seed
 * is only honoured for a *fresh* run: a stored save resumes with its own
 * seed and ignores the query string. Asserting `sim.seed` therefore checks
 * both at once, and turns a save leaking between tests into a loud failure
 * here rather than a quiet drift in whichever spec runs second.
 */
export async function openGame(page: Page, seed: number): Promise<void> {
  // Installed before any page script runs, so it is there for the first
  // evaluate after load. One accessor, so the path into the page is
  // written once and type-checked once.
  await page.addInitScript(() => {
    window.mazeosaurBoard = () => {
      const handle = window.mazeosaur;
      if (!handle) throw new Error("window.mazeosaur is unset: the client only exposes it in a dev build");
      const scene = handle.phaser.scene.keys["board"];
      if (!scene) throw new Error("the board scene is not mounted");
      return scene as BoardScene;
    };
  });
  await page.goto(`/?seed=${seed}`);
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.mazeosaur?.phaser.scene.keys["board"] !== undefined);
  const actualSeed = await page.evaluate(() => window.mazeosaurBoard!().sim.seed);
  if (actualSeed !== seed) {
    throw new Error(`asked for seed ${seed} but the client is running ${actualSeed}: a stored save resumed instead of a fresh run`);
  }
  await waitAFrame(page);
}

/**
 * The mounted scene exposes its sim via `BoardScene.sim` ("for tests and
 * debugging from the console"), and the shell exposes the `GameHandle` as
 * `window.mazeosaur` in dev builds. This is that console, automated.
 */
export function simSnapshot(page: Page): Promise<{ meat: number; eggs: number; dinos: number; phase: string; tick: number }> {
  return page.evaluate(() => {
    const s = window.mazeosaurBoard!().sim.state;
    return { meat: s.meat, eggs: s.eggs, dinos: s.dinos.length, phase: s.phase as string, tick: s.tick };
  });
}

/**
 * What the tray has armed, which cell the placement preview is on, and
 * which dinosaur's sheet is open. Placement is two taps now, so a sim
 * snapshot is no longer enough to tell the cases apart: a tap that
 * refused and a tap that was swallowed by a cleared selection both leave
 * `dinos` where it was.
 */
export function selectionSnapshot(page: Page): Promise<{ kindId: string | null; dinoId: number | null; preview: { x: number; y: number } | null }> {
  return page.evaluate(() => window.mazeosaurBoard!().selection);
}

/**
 * Every HUD control's geometry as the renderer built it
 * (`BoardScene.hudTargets`), which is the only thing that can tell a
 * layout constant from the box actually on screen.
 */
export function hudTargets(page: Page): Promise<{ name: string; x: number; y: number; w: number; h: number }[]> {
  return page.evaluate(() => window.mazeosaurBoard!().hudTargets);
}

/**
 * Whether the fliers' air route is drawn, at which of its two strengths,
 * and the segment it runs along (`BoardScene.airRoute`).
 */
export function airRouteSnapshot(page: Page): Promise<{ shown: boolean; subdued: boolean; from: { x: number; y: number }; to: { x: number; y: number } }> {
  return page.evaluate(() => window.mazeosaurBoard!().airRoute);
}

/**
 * The index of the first migration that contains a flier, read out of the
 * running content rather than written down here. Rule 4: which migration
 * the fliers arrive on is a content edit, and a test that hardcodes it
 * fails on the edit instead of following it.
 */
export function firstFlierMigration(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = window.mazeosaurBoard!().sim.content;
    return c.migrations.findIndex((m) => m.groups.some((g) => c.invaders[g.invader]?.flying));
  });
}

/**
 * Points the sim at a given migration, so a test can reach a late one
 * without fighting every migration before it — the same shortcut
 * `winOnNextSend` takes, which is this with the last index. `currentMigration()`
 * reads `state.migration` directly, so the HUD's preview row and anything
 * derived from it (the air route) see the new migration on the next frame.
 */
export async function setMigration(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    window.mazeosaurBoard!().sim.state.migration = i;
  }, index);
}

/**
 * Phaser picks WebGL via `type: Phaser.AUTO` and the game is created without
 * `preserveDrawingBuffer`, so `canvas.toDataURL()` cannot be trusted to show
 * what was last drawn — sampling it is not a liveness check, WebGL or not.
 * `state.tick` is the real signal: the update loop only advances it while
 * ticking, so a frozen renderer (the destroyed-display-object bug this
 * harness exists to catch) stalls it, whether or not Phaser also throws.
 */
export async function waitForTickAdvance(page: Page, fromTick: number, timeoutMs = 5_000): Promise<void> {
  await page.waitForFunction((t) => window.mazeosaurBoard!().sim.state.tick > t, fromTick, { timeout: timeoutMs });
}

/** Waits for an egg to be lost, i.e. for an invader to reach the nest. */
export async function waitForEggsBelow(page: Page, eggs: number, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction((n) => window.mazeosaurBoard!().sim.state.eggs < n, eggs, { timeout: timeoutMs });
}

/**
 * Loses the run on the next leak, by leaving one egg in the nest.
 *
 * There is no command for "lose", and leaking all twenty eggs honestly
 * takes several migrations with a thirty-second build phase between each —
 * minutes of wall clock for a state the sim reaches in one tick. So the
 * test sets up the condition and lets the real leak spring it: the `lost`
 * event, the overlay, and the `run: null` save all still come from the
 * client's own code path. Nothing inconsistent is persisted, because a
 * finished run is written with no log at all (`BoardScene.flush`).
 */
export async function loseOnNextLeak(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.mazeosaurBoard!().sim.state.eggs = 1;
  });
}

/** Waits for the run to end, won or lost. */
export async function waitForRunOver(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const phase = window.mazeosaurBoard!().sim.state.phase;
      return phase === "won" || phase === "lost";
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Calls the same `scene.restart()` the "Play again" button calls, so a
 * restart can be exercised without winning or losing a run first.
 */
export async function restartScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.mazeosaurBoard!().scene.restart();
  });
}
