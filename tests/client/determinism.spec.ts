import { expect, test } from "@playwright/test";
import { openGame } from "./helpers.js";

const SEED = 777;

/**
 * Drives the exact `Game` instance the real, bundled client creates (via
 * `BoardScene.sim`) through an identical command log twice, in two separate
 * browser contexts, and compares `Game.hash()` — the same fingerprint
 * `packages/sim/test/game.test.ts` uses and the one the proposal says the
 * server will use to verify runs (docs/00-proposal.md section 6). This is
 * cheap: it calls `tick()` in a tight loop rather than waiting on real
 * animation frames, so it adds seconds, not minutes.
 *
 * If this ever fails, it is not a client bug: it means the deterministic
 * core (packages/sim) or the data that feeds it (packages/content) is not
 * actually deterministic once loaded the way the real app loads it, which
 * breaks replays, saves and server verification. That goes to
 * maze-architect immediately, not back through the normal QA queue.
 */
async function playScript(page: import("@playwright/test").Page): Promise<{ hash: number; tick: number; phase: string }> {
  await openGame(page, SEED);
  return page.evaluate(() => {
    interface SimLike {
      state: { tick: number; phase: string };
      apply(cmd: unknown): string | null;
      tick(): void;
      hash(): number;
    }
    const w = window as unknown as { mazeosaur: { scene: { keys: { board: { sim: SimLike } } } } };
    const g = w.mazeosaur.scene.keys.board.sim;

    g.apply({ type: "place", defId: "raptor-1", x: 5, y: 5 });
    g.apply({ type: "place", defId: "armored-1", x: 8, y: 5 });
    for (let i = 0; i < 30; i++) g.tick();
    g.apply({ type: "grow", dinoId: 1 });
    g.apply({ type: "send" });
    for (let i = 0; i < 5000 && g.state.phase === "migration"; i++) g.tick();
    if (g.state.phase === "migration") throw new Error("migration never ended within 5000 ticks");

    return { hash: g.hash(), tick: g.state.tick, phase: g.state.phase };
  });
}

test("same seed and command log produce the same state hash through the real client", async ({ page, browser }) => {
  const first = await playScript(page);

  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    const second = await playScript(otherPage);
    expect(second).toEqual(first);
  } finally {
    await otherContext.close();
  }
});
