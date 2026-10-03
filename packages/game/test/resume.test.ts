import { describe, expect, it, vi } from "vitest";
import { content } from "@mazeosaur/content";
import { Game, replay, type RunSave } from "@mazeosaur/sim";
import { gameForRun } from "../src/resume.js";

// Vitest hoists this above the imports above, so `gameForRun` -- which
// imports `replay` from the same specifier -- resolves to the spy too.
vi.mock("@mazeosaur/sim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mazeosaur/sim")>();
  return { ...actual, replay: vi.fn(actual.replay) };
});

const BUILD = { commit: "dev", platform: "node" as const };

function freshRun(): { g: Game; run: RunSave } {
  const g = new Game(content, 1);
  for (let i = 0; i < 3; i++) g.tick();
  const run: RunSave = {
    valleyId: content.valley.id,
    seed: g.seed,
    contentVersion: content.version,
    startedBy: BUILD,
    log: g.log,
    tick: g.state.tick,
    hash: g.hash(),
    playedMs: 0,
  };
  return { g, run };
}

describe("gameForRun", () => {
  it("reuses the resumed Game and never calls replay -- the whole point of LoadOutcome.resumed", () => {
    vi.mocked(replay).mockClear();
    const { g, run } = freshRun();
    const out = gameForRun(content, run, g);
    expect(out).toBe(g);
    expect(replay).not.toHaveBeenCalled();
  });

  it("falls back to replay when resumed is null, reaching the same state replay always did", () => {
    vi.mocked(replay).mockClear();
    const { g, run } = freshRun();
    const out = gameForRun(content, run, null);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(out.hash()).toBe(g.hash());
    expect(out.state.tick).toBe(g.state.tick);
  });
});
