import type { ConsoleMessage, Page } from "@playwright/test";
import type { BoardScene, GameHandle } from "@mazeosaur/game";

/**
 * Pixel geometry mirrors `packages/game/src/theme.ts` and the HUD layout
 * built in `packages/game/src/BoardScene.ts` (`buildHud`). The board is
 * drawn on a single canvas with no DOM to query, so driving it means
 * clicking the same pixels a finger would; these constants are the one
 * place that math lives so a HUD layout change only breaks one file.
 */
export const CELL_PX = 36;
export const CANVAS_W = 720;
const BOARD_H = 28 * CELL_PX; // content.valley.height * CELL_PX
const HUD_Y = BOARD_H;

export function cellCenter(x: number, y: number): { x: number; y: number } {
  return { x: x * CELL_PX + CELL_PX / 2, y: y * CELL_PX + CELL_PX / 2 };
}

/** Center of the Nth palette button (one per hatchling kind), left to right. */
export function paletteButtonCenter(index: number, kindCount = 6): { x: number; y: number } {
  const py = HUD_Y + 58;
  const bw = Math.floor((CANVAS_W - 32 - (kindCount - 1) * 4) / kindCount);
  return { x: 16 + index * (bw + 4) + bw / 2, y: py + 62 / 2 };
}

export const SEND_BUTTON = { x: 496 + 144 / 2, y: HUD_Y + 8 + 42 / 2 };
export const SPEED_BUTTON = { x: 648 + 56 / 2, y: HUD_Y + 8 + 42 / 2 };

/**
 * A point in the HUD that is not any control: the status/preview text
 * rows, between the kind buttons (which end at `HUD_Y + 120`) and the
 * dinosaur panel (which starts at `HUD_Y + 196`). Text objects are not
 * interactive, so a tap here reaches the scene's own `pointerdown` — this
 * is the "tap away to cancel" gesture, and the only place on the canvas
 * that is neither a cell nor a button.
 */
export const HUD_BARE = { x: CANVAS_W / 2, y: HUD_Y + 158 };

const PANEL_Y = HUD_Y + 196;
export const GROW_BUTTON = { x: CANVAS_W - 336 + 190 / 2, y: PANEL_Y + 8 + 52 / 2 };
export const SELL_BUTTON = { x: CANVAS_W - 136 + 120 / 2, y: PANEL_Y + 8 + 52 / 2 };

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
/**
 * Common tail of a (re)load: wait for the canvas, wait for the board scene
 * to be mounted inside it, then wait a frame so the first real draw has
 * happened before anything reads state off it.
 */
async function waitForBoardMounted(page: Page): Promise<void> {
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.mazeosaur?.phaser.scene.keys["board"] !== undefined);
  await waitAFrame(page);
}

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
  await waitForBoardMounted(page);
  const actualSeed = await page.evaluate(() => window.mazeosaurBoard!().sim.seed);
  if (actualSeed !== seed) {
    throw new Error(`asked for seed ${seed} but the client is running ${actualSeed}: a stored save resumed instead of a fresh run`);
  }
}

/**
 * Reloads the page the way a player's browser does on a real navigation,
 * and waits for the board scene to remount. `page.addInitScript` re-runs on
 * every navigation of the same page, so `window.mazeosaurBoard` is back
 * without re-installing it.
 *
 * Deliberately does not check the seed the way `openGame` does: the point
 * of this helper is a *resumed* run, which keeps the seed the stored save
 * was written with regardless of the URL.
 */
export async function reloadAndWaitForBoard(page: Page): Promise<void> {
  await page.reload();
  await waitForBoardMounted(page);
}

/**
 * Calls the same `flush()` that `autosave()` and `GameHandle.suspend()`
 * call, and awaits its promise. A real reload races `pagehide`'s
 * fire-and-forget write against the navigation tearing the page down, which
 * is the right thing for the shell to do but the wrong thing for a
 * deterministic test to depend on: this flushes the current run
 * synchronously first, so the reload that follows is a clean test of load
 * and resume rather than of that race.
 */
export async function flushSave(page: Page): Promise<void> {
  await page.evaluate(() => window.mazeosaurBoard!().flush());
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

/**
 * Points the sim at the last real migration, so the next "Send" follows the
 * game's only path to `won`: `clearMigration()`, called from inside
 * `tick()` once a migration's spawn queue and invaders are both empty
 * (`packages/sim/src/game.ts`). That path matters because it is the one
 * `BoardScene.update()` actually drains events on — `update()` only calls
 * `drainEvents()` while `phase` is `"build"` or `"migration"`
 * (`packages/game/src/BoardScene.ts`), so a `won` set any other way (e.g.
 * `startMigration` finding no next migration, which real play can never
 * reach because `clearMigration` already wins first) sets the sim's phase
 * but leaves the event undrained and the overlay never shows — a trap this
 * test fell into once. Pair with `clearActiveMigration` after sending,
 * rather than fighting fifty migrations' worth of real invaders to prove
 * the win screen, the same way `loseOnNextLeak` doesn't drain all twenty
 * eggs by hand.
 */
export async function winOnNextSend(page: Page): Promise<void> {
  await page.evaluate(() => {
    const board = window.mazeosaurBoard!();
    board.sim.state.migration = board.sim.content.migrations.length - 1;
  });
}

/** Empties the in-flight migration's spawns, so it clears on the next tick. */
export async function clearActiveMigration(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.mazeosaurBoard!().sim.state;
    s.spawnQueue.length = 0;
    s.invaders.length = 0;
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
