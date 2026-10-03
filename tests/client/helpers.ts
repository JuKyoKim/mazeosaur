import type { ConsoleMessage, Page } from "@playwright/test";

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

const PANEL_Y = HUD_Y + 196;
export const GROW_BUTTON = { x: CANVAS_W - 336 + 190 / 2, y: PANEL_Y + 8 + 52 / 2 };
export const SELL_BUTTON = { x: CANVAS_W - 136 + 120 / 2, y: PANEL_Y + 8 + 52 / 2 };

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

export async function canvasSnapshot(page: Page): Promise<string> {
  const data = await page.evaluate(() => document.querySelector("canvas")?.toDataURL() ?? "");
  if (!data) throw new Error("no canvas found on the page");
  return data;
}

/** Loads the game pinned to a seed and waits for the first real frame. */
export async function openGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForSelector("canvas");
  await waitAFrame(page);
}

/**
 * The mounted scene exposes its sim via `BoardScene.sim`, and `main.ts`
 * exposes the mounted `Phaser.Game` as `window.mazeosaur` in dev builds
 * "for tests and debugging from the console" (see BoardScene.ts). This is
 * that console, automated.
 */
export function simSnapshot(page: Page): Promise<{ meat: number; eggs: number; dinos: number; phase: string }> {
  return page.evaluate(() => {
    const w = window as unknown as { mazeosaur: { scene: { keys: { board: { sim: { state: Record<string, unknown> } } } } } };
    const s = w.mazeosaur.scene.keys.board.sim.state as { meat: number; eggs: number; dinos: unknown[]; phase: string };
    return { meat: s.meat, eggs: s.eggs, dinos: s.dinos.length, phase: s.phase };
  });
}
