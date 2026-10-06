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

export const SEND_BUTTON = { x: 496 + 96 / 2, y: HUD_Y + 8 + 42 / 2 };
export const PAUSE_BUTTON = { x: 600 + 48 / 2, y: HUD_Y + 8 + 42 / 2 };
export const SPEED_BUTTON = { x: 656 + 48 / 2, y: HUD_Y + 8 + 42 / 2 };

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

/** The "Play again" button on the end-of-run overlay (`showOverlay`). */
export const PLAY_AGAIN_BUTTON = { x: CANVAS_W / 2, y: BOARD_H / 2 + 60 + 64 / 2 };

/**
 * The pause menu's three entries (`PAUSE_MENU` in `BoardScene.ts`): 328
 * wide, `MIN_HIT` (82) tall, centred in the board area. A point on the
 * scrim but on none of them, for the tap-to-dismiss gesture, is the gap
 * above the first button.
 */
const PAUSE_MENU = { x: CANVAS_W / 2, h: 82 };
export const RESUME_BUTTON = { x: PAUSE_MENU.x, y: 432 + PAUSE_MENU.h / 2 };
export const RESTART_RUN_BUTTON = { x: PAUSE_MENU.x, y: 528 + PAUSE_MENU.h / 2 };
export const END_RUN_BUTTON = { x: PAUSE_MENU.x, y: 624 + PAUSE_MENU.h / 2 };
export const PAUSE_SCRIM_BARE = { x: PAUSE_MENU.x, y: 420 };

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
 * Whether the fliers' air route is drawn, at which of its two strengths,
 * where its lights' blink has got to, and the segment it runs along
 * (`BoardScene.airRoute`).
 */
export function airRouteSnapshot(page: Page): Promise<{ shown: boolean; subdued: boolean; blink: number; from: { x: number; y: number }; to: { x: number; y: number } }> {
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
 * Whether the clock is running, from `BoardScene.clock`. A pause is
 * invisible below the client by design, so `state.tick` holding still is
 * all a sim snapshot can see — and a frozen renderer looks identical.
 */
export function clockSnapshot(page: Page): Promise<{ paused: boolean; abandoned: boolean; speed: number }> {
  return page.evaluate(() => window.mazeosaurBoard!().clock);
}

/**
 * Everything a replay is a function of: the tick reached, the command log,
 * and the state hash those two produce. This is the determinism assertion
 * a pause has to survive — `packages/sim/test/save.test.ts` proves the
 * round trip below the client, and this proves the client did not quietly
 * add a tick or a command while the menu was up.
 */
export function replaySnapshot(page: Page): Promise<{ tick: number; hash: number; log: string }> {
  return page.evaluate(() => {
    const sim = window.mazeosaurBoard!().sim;
    return { tick: sim.state.tick, hash: sim.hash(), log: JSON.stringify(sim.log) };
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
