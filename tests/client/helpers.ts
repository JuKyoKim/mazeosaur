import { inflateSync } from "node:zlib";
import type { ConsoleMessage, Page } from "@playwright/test";
import type { BoardScene, GameHandle, ResultsScene, RunSummary } from "@mazeosaur/game";
// From the subpath, not the package root: this file runs in Node, and
// `@mazeosaur/game` imports Phaser, which does not. `entry.ts` imports
// nothing — it is §5.3's contract and three constructors for it — which is
// what makes it safe to pull into the harness and still be the same code
// the client narrows against.
import { again, type BoardEntry } from "@mazeosaur/game/entry";
import { CANVAS_W, CELL_PX, PAUSE_MENU, RESULTS, ROW1, ROW2, ROW3, kindButtonX } from "@mazeosaur/game/layout";

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
export const PAUSE_BUTTON = center(ROW1.pause);
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

/**
 * The "Again" button on the results screen.
 *
 * `RESULTS.again` is where the renderer gets it too, so this cannot drift
 * from the button actually on screen.
 *
 * The only end-of-run button there is. All three of §5.4's outcomes —
 * won, lost and the player's own `abandoned` — land on `results`, so the
 * in-board overlay's separate "Play again" and the `ENDED_RUN` geometry it
 * was drawn from are both gone.
 */
export const AGAIN_BUTTON = { x: RESULTS.again.x + RESULTS.again.w / 2, y: RESULTS.again.y + RESULTS.again.h / 2 };

/**
 * The pause menu's three entries, from `PAUSE_MENU` in `layout.ts` like
 * every other control here. A point on the scrim but on none of them, for
 * the tap-to-dismiss gesture, is the gap above the first button — derived
 * from `resume.y` rather than written as 420, so widening the gap cannot
 * quietly move the dismiss test onto a button.
 */
const entry = (e: { y: number }) => ({ x: PAUSE_MENU.x + PAUSE_MENU.w / 2, y: e.y + PAUSE_MENU.h / 2 });
export const RESUME_BUTTON = entry(PAUSE_MENU.resume);
export const RESTART_RUN_BUTTON = entry(PAUSE_MENU.restart);
export const END_RUN_BUTTON = entry(PAUSE_MENU.end);
export const PAUSE_SCRIM_BARE = { x: CANVAS_W / 2, y: PAUSE_MENU.resume.y - 12 };

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
    mazeosaurResults?: () => ResultsScene;
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
 * Common tail of a (re)load: wait for the canvas, wait for the board scene
 * to be mounted inside it, then wait a frame so the first real draw has
 * happened before anything reads state off it.
 */
async function waitForBoardMounted(page: Page): Promise<void> {
  await page.waitForSelector("canvas");
  await page.waitForFunction(() => window.mazeosaur?.phaser.scene.keys["board"] !== undefined);
  await waitAFrame(page);
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
    window.mazeosaurResults = () => {
      const handle = window.mazeosaur;
      if (!handle) throw new Error("window.mazeosaur is unset: the client only exposes it in a dev build");
      const scene = handle.phaser.scene.keys["results"];
      if (!scene) throw new Error("the results scene is not registered");
      return scene as ResultsScene;
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
 *
 * This is the one to call before a reload. `flushAndSnapshot` below reads
 * back tick/hash/log in the same breath as the flush and deliberately does
 * not await the write — do not substitute it here.
 */
export async function flushSave(page: Page): Promise<void> {
  await page.evaluate(() => window.mazeosaurBoard!().flush());
}

/**
 * Flushes and reads back the tick, hash and log `flush()` just stamped into
 * the document, in one round trip rather than two.
 *
 * `flush()` builds the `RunSave` synchronously, before its own `await` on
 * the store write, so a `sim` read on the very next line of the same
 * `page.evaluate` sees exactly the state that was stamped — nothing else can
 * run on the page's single JS thread in between. `flushSave` followed by a
 * *separate* `replaySnapshot` call does not have that guarantee: the board
 * keeps ticking in `build`/`migration` phase between the two round trips, so
 * occasionally one more tick lands before the second one reads, and the
 * snapshot comes back one tick ahead of what was actually saved. That is
 * ARB-349: `board-entry.spec.ts` compared a resumed run's tick against that
 * inflated snapshot and failed on the coin flip.
 *
 * Does NOT await the write (`void board.flush()` inside the evaluate) —
 * that await is exactly what would let a build-phase tick land between the
 * flush and the read, the race this helper exists to avoid. That makes it
 * the wrong helper before a reload: `IndexedDbSaveStore.put` coalesces a
 * write for up to `COALESCE_MS`, and with the promise discarded nothing
 * waits for it, so a reload can land on a stale save. Use `flushSave` there.
 */
export function flushAndSnapshot(page: Page): Promise<{ tick: number; hash: number; log: string }> {
  return page.evaluate(() => {
    const board = window.mazeosaurBoard!();
    void board.flush();
    const sim = board.sim;
    return { tick: sim.state.tick, hash: sim.hash(), log: JSON.stringify(sim.log) };
  });
}

/**
 * The mounted scene exposes its sim via `BoardScene.sim` ("for tests and
 * debugging from the console"), and the shell exposes the `GameHandle` as
 * `window.mazeosaur` in dev builds. This is that console, automated.
 */
export function simSnapshot(page: Page): Promise<{ meat: number; eggs: number; dinos: number; phase: string; tick: number; migration: number }> {
  return page.evaluate(() => {
    const s = window.mazeosaurBoard!().sim.state;
    // `migration` is the index of the current or next one, which is also
    // the count of the ones already cleared — the number the results
    // screen reports, so a spec can check the screen against the sim.
    return { meat: s.meat, eggs: s.eggs, dinos: s.dinos.length, phase: s.phase as string, tick: s.tick, migration: s.migration };
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
 * The profile `flush()` last wrote: the award a finished run actually
 * banked.
 *
 * `runsStarted` is in the shape because it is what keeps "the profile did
 * not move" from being vacuous across a re-entry: a spec that drives
 * `Again` can assert the two banked figures held while the counter that
 * *should* move did.
 */
export function bankedProfile(page: Page): Promise<{ fossilsEarned: number; runsFinished: number; runsStarted: number }> {
  return page.evaluate(() => window.mazeosaurBoard!().bankedProfile);
}

/** Whether the board's toast is on screen. */
export function toastShown(page: Page): Promise<boolean> {
  return page.evaluate(() => window.mazeosaurBoard!().toastShown);
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

/**
 * Drives `BoardScene.advanceTicks(1)` in a tight loop, at CPU speed,
 * instead of waiting for `update()`'s real-time accumulator
 * (`this.acc += delta * this.speed`) to deliver enough animation frames to
 * cover the same ground. That accumulator paces ticks to the browser's
 * actual frame rate — even at the 3x the "Speed" button offers — so an
 * invader's walk down the full lane took real wall-clock seconds that grew
 * or shrank with whatever else was loading the CI runner. That was
 * ARB-242: the same full-run spec timed out at the 60s Playwright limit on
 * one run and passed in 53.5s on another, with no gameplay difference
 * between them.
 *
 * `advanceTicks` runs the same per-tick pipeline the update loop runs —
 * sim tick, then `handleEvents` on whatever drained — so the leak, the
 * loss and the overlay `handleEvents` raises on it all still come from the
 * real code path, just not paced by frame delivery. One tick per call
 * (rather than handing `advanceTicks` the whole `maxTicks` budget up
 * front) stops as soon as the condition is met instead of running the
 * rest of the migration for free.
 */
async function fastForwardUntil(page: Page, until: "eggsBelow" | "runOver", arg: number, maxTicks: number): Promise<boolean> {
  return page.evaluate(
    ({ until, arg, maxTicks }) => {
      const board = window.mazeosaurBoard!();
      const reached = () => (until === "eggsBelow" ? board.sim.state.eggs < arg : board.sim.state.phase === "won" || board.sim.state.phase === "lost");
      let n = 0;
      while (!reached() && n < maxTicks) {
        board.advanceTicks(1);
        n++;
      }
      return reached();
    },
    { until, arg, maxTicks },
  );
}

/**
 * Fast-forwards until an egg is lost, i.e. until an invader reaches the
 * nest. See `fastForwardUntil` for why this drives the sim directly
 * instead of waiting on real time.
 */
export async function fastForwardUntilEggsBelow(page: Page, eggs: number, maxTicks = 20_000): Promise<void> {
  const reached = await fastForwardUntil(page, "eggsBelow", eggs, maxTicks);
  if (!reached) throw new Error(`eggs did not drop below ${eggs} within ${maxTicks} ticks`);
}

/**
 * Fast-forwards until the run ends, won or lost. See `fastForwardUntil`
 * for why this drives the sim directly instead of waiting on real time.
 */
export async function fastForwardUntilRunOver(page: Page, maxTicks = 20_000): Promise<void> {
  const reached = await fastForwardUntil(page, "runOver", 0, maxTicks);
  if (!reached) throw new Error(`run did not end within ${maxTicks} ticks`);
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
 * Calls `scene.restart()` on the board directly, so the restart hazard can
 * be exercised without winning or losing a run first.
 *
 * This is no longer the same call the player's button makes — "Again" on
 * the results screen does `scene.start("board")` from a *different* scene.
 * Both re-run `BoardScene.create()`, which is what the regression this
 * guards is about, and the player's path is covered end to end by
 * `results.spec.ts`.
 *
 * The harness is the third producer §5.3 warns about, so it says which
 * entry it means like any other caller: this one is `again` on the seed
 * already running, which is what the pause menu's "Restart run" passes.
 * The entry is built here with the game package's own `again()` and handed
 * into the page as plain data — the same reason the geometry at the top of
 * this file is imported rather than written out.
 */
export async function restartScene(page: Page): Promise<void> {
  const seed = await page.evaluate(() => window.mazeosaurBoard!().sim.seed);
  await startBoard(page, again(seed), "restart");
}

/**
 * Enters `board` with a §5.3 entry the harness chooses, which is the only
 * way to drive a transition no button reaches yet: `title`'s New run and
 * Continue are `FRESH` and `RESUME` from a scene that does not exist until
 * ARB-217 lands, and `board` has to be right about them before it does.
 *
 * `how` picks which Phaser call carries it. They are different code paths —
 * `restart` stops and restarts the scene it is called on, `start` enters it
 * from somewhere else — and both have to deliver the entry data, so a spec
 * can ask for either.
 */
export async function startBoard(page: Page, entry: BoardEntry, how: "start" | "restart" = "start"): Promise<void> {
  await page.evaluate(
    ({ entry, how }) => {
      const board = window.mazeosaurBoard!();
      if (how === "restart") board.scene.restart(entry);
      else board.scene.start("board", entry);
    },
    { entry, how },
  );
}

/**
 * Enters `board` with no entry data at all, which is what a producer that
 * has not read §5.3 does. `BoardScene.init` rejects it, so this is expected
 * to leave an uncaught error on the page rather than a running board —
 * drive it last in a spec, and read the error from `trackPageErrors`.
 */
export async function startBoardWithNoEntry(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.mazeosaurBoard!().scene.start("board");
  });
}

/** Whether the results scene is the one currently running. */
export function resultsShown(page: Page): Promise<boolean> {
  return page.evaluate(() => window.mazeosaurResults!().scene.isActive());
}

/**
 * The `RunSummary` the board handed the results screen — the numbers the
 * screen is drawing, read from the scene rather than guessed from pixels.
 */
export function resultsSummary(page: Page): Promise<RunSummary> {
  return page.evaluate(() => window.mazeosaurResults!().runSummary);
}

/** One line of text on the results screen, as a spec reads it back. */
export interface ResultsLine {
  readonly text: string;
  readonly y: number;
  readonly width: number;
  readonly fontSize: string;
  readonly color: string;
}

/**
 * Every line the results screen is drawing, keyed by nothing: §9 gives each
 * element a string, a type size and a colour, and all three are read off the
 * scene here rather than guessed from pixels.
 *
 * Colour and size are the point, not decoration. §9's zero-award rule is
 * about *emphasis* — the same y, the same origin, a smaller type and a dim
 * colour — so a change that kept the wording and dropped the de-emphasis
 * would pass a text-only assertion while putting the reward signal back on
 * the thing the player did not get.
 */
export function resultsLines(page: Page): Promise<ResultsLine[]> {
  return page.evaluate(() => {
    const scene = window.mazeosaurResults!() as unknown as Phaser.Scene;
    type T = Phaser.GameObjects.Text;
    return (scene.children.list as unknown[])
      .filter((o): o is T => typeof (o as T).text === "string" && typeof (o as T).width === "number")
      .map((t) => ({
        text: t.text,
        y: Math.round(t.y),
        width: Math.round(t.width),
        fontSize: String(t.style.fontSize),
        // Phaser types this as a gradient or a pattern too, which nothing
        // on this screen uses: `text()` in `theme.ts` only ever sets a CSS
        // string, so stringifying is the narrowing and not a cast.
        color: String(t.style.color),
      }));
  });
}

/** The one results line at `y`, which §9's element table makes unique. */
export async function resultsLineAt(page: Page, y: number): Promise<ResultsLine | undefined> {
  return (await resultsLines(page)).find((l) => l.y === y);
}

/** Resolves once the board has handed off and `results` is up. */
export async function waitForResults(page: Page): Promise<void> {
  await page.waitForFunction(() => window.mazeosaurResults?.().scene.isActive() === true);
  await waitAFrame(page);
}

/**
 * One pixel of the canvas as the player's screen has it, after compositing.
 *
 * Every other reader in this file goes through the scene graph —
 * `resultsLines`, `simSnapshot`, `hudTargets` — which is the right default
 * because it reads what the client *meant*. The gap is that a display
 * object exists, carries its text and reports its colour whether or not a
 * single pixel of it survives to the canvas, so the whole suite was blind
 * to compositing: `results` spent a release rendering underneath the paused
 * `board`, every assertion about it green, and the player saw the board.
 *
 * Phaser runs on WebGL here, so the drawing buffer is not readable from the
 * page (no `preserveDrawingBuffer`) and `toDataURL` comes back blank.
 * Playwright's screenshot composites the way the compositor does, which is
 * the thing being asked about, so the pixel is clipped out of one.
 *
 * Coordinates are canvas-internal (the same `layout.ts` numbers every
 * control here is expressed in) and are mapped through the canvas's own
 * bounding rect, so a harness viewport that does not happen to match
 * `CANVAS_W`x`CANVAS_H` 1:1 reads an unshifted point, not an unblended one.
 * Below 1:1 several canvas-internal pixels collapse into the one CSS pixel
 * the screenshot clips, so the sample is a neighbourhood average rather than
 * that pixel's own colour — a 1px grid line has read back as `0x27392d`
 * instead of `COLORS.gridLine`'s `0x2c4033` for exactly this reason. Sample a
 * flat fill, never an edge or a 1px feature: the phone-scale capture recipe's
 * 390px-wide resize is already a 0.54 downscale of `CANVAS_W`, so a sample
 * taken after it is in the failing case on the first try.
 */
export async function canvasPixel(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas on the page: the game has not mounted");
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height, innerW: canvas.width, innerH: canvas.height };
  });
  const png = await page.screenshot({
    clip: {
      x: rect.left + (x * rect.width) / rect.innerW,
      y: rect.top + (y * rect.height) / rect.innerH,
      width: 1,
      height: 1,
    },
  });
  return decodeOnePixel(png);
}

/** `COLORS.x` as `canvasPixel` returns it, so a spec compares like with like. */
export function rgbOf(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

/**
 * The RGB of a 1x1 PNG, which is all `canvasPixel` ever decodes.
 *
 * A general PNG decoder would have to undo the five scanline filters
 * against the pixel to the left and the row above. At one pixel there is
 * neither: `a`, `b` and `c` are 0 for every filter, and Sub, Up, Average
 * and Paeth all reduce to the stored byte. So the filter byte can be
 * skipped rather than interpreted, and this stays a few lines instead of
 * pulling an image library into the harness.
 *
 * That shortcut only holds for 8-bit RGB/RGBA: a 16-bit sample is two bytes
 * wide and a palette entry is an index, not a colour, so either would decode
 * to a silently wrong number rather than a thrown error. Chromium's own
 * screenshot encoder emits neither today, but IHDR says what it emitted, so
 * read it and throw by name rather than let a future encoder change surface
 * as a mystery colour mismatch three specs away.
 */
function decodeOnePixel(png: Buffer): { r: number; g: number; b: number } {
  const idat: Buffer[] = [];
  let bitDepth: number | undefined;
  let colorType: number | undefined;
  // 8-byte signature, then length/type/data/CRC chunks.
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") {
      // width(4) height(4) bit depth(1) colour type(1) ...
      bitDepth = png.readUInt8(at + 8 + 8);
      colorType = png.readUInt8(at + 8 + 9);
    }
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += length + 12;
  }
  // Colour type 2 is truecolor (RGB), 6 is truecolor+alpha (RGBA) — the only
  // two the byte offsets below are valid for.
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`canvasPixel only decodes 8-bit RGB/RGBA PNGs; got bit depth ${bitDepth}, colour type ${colorType}`);
  }
  if (idat.length === 0) throw new Error("screenshot PNG carried no IDAT");
  const raw = inflateSync(Buffer.concat(idat));
  // [filter, r, g, b, (a)] — see above for why the filter is skipped.
  return { r: raw[1]!, g: raw[2]!, b: raw[3]! };
}
