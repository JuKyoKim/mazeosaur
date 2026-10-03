import { describe, expect, it } from "vitest";
import { Game, kindMultiplier, type GameEvent } from "../src/index.js";
import { fixture } from "./fixture.js";

function run(game: Game, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    game.tick();
    events.push(...game.drainEvents());
  }
  return events;
}

function runUntil(game: Game, pred: () => boolean, max = 5000): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !pred(); i++) {
    game.tick();
    events.push(...game.drainEvents());
  }
  if (!pred()) throw new Error("condition never met");
  return events;
}

describe("kind chart", () => {
  it("is one cycle: beats the next, weak to the previous, neutral otherwise", () => {
    expect(kindMultiplier("tyrant", "longneck")).toBe(200);
    expect(kindMultiplier("longneck", "tyrant")).toBe(50);
    expect(kindMultiplier("armored", "tyrant")).toBe(200);
    expect(kindMultiplier("tyrant", "armored")).toBe(50);
    expect(kindMultiplier("tyrant", "horned")).toBe(100);
    expect(kindMultiplier("raptor", "raptor")).toBe(100);
  });
});

describe("placing, growing, selling", () => {
  it("charges meat, blocks the cell, and refuses when broke", () => {
    const g = new Game(fixture, 1);
    expect(g.apply({ type: "place", defId: "raptor-1", x: 2, y: 2 })).toBeNull();
    expect(g.state.meat).toBe(40);
    expect(g.grid.isBlocked(2, 2)).toBe(true);
    expect(g.apply({ type: "place", defId: "raptor-1", x: 2, y: 2 })).toBe("occupied");
    for (let i = 0; i < 4; i++) expect(g.apply({ type: "place", defId: "raptor-1", x: i, y: 4 })).toBeNull();
    expect(g.state.meat).toBe(0);
    expect(g.apply({ type: "place", defId: "raptor-1", x: 4, y: 4 })).toBe("no-meat");
    expect(g.log).toHaveLength(5);
  });

  it("refuses rock, lane cells, stage-2 defs and unknown defs", () => {
    const g = new Game(fixture, 1);
    expect(g.apply({ type: "place", defId: "raptor-1", x: 2, y: 3 })).toBe("rock");
    expect(g.apply({ type: "place", defId: "raptor-1", x: 5, y: 0 })).toBe("lane-cell");
    expect(g.apply({ type: "place", defId: "raptor-2", x: 1, y: 1 })).toBe("unknown-dino");
    expect(g.apply({ type: "place", defId: "nope", x: 1, y: 1 })).toBe("unknown-dino");
    expect(g.log).toHaveLength(0);
  });

  it("refuses the placement that would seal the valley", () => {
    const g = new Game(fixture, 1);
    // wall row 2 except x=5; then x=5 would seal spawn/checkpoint off from the nest
    for (let x = 0; x < 5; x++) expect(g.apply({ type: "place", defId: "raptor-1", x, y: 2 })).toBeNull();
    expect(g.apply({ type: "place", defId: "raptor-1", x: 5, y: 2 })).toBe("would-block");
  });

  it("grows in place and refunds a share of everything invested", () => {
    const g = new Game(fixture, 1);
    g.apply({ type: "place", defId: "raptor-1", x: 2, y: 2 });
    const dino = g.dinoAt(2, 2)!;
    expect(g.apply({ type: "grow", dinoId: dino.id })).toBeNull();
    expect(dino.defId).toBe("raptor-2");
    expect(dino.invested).toBe(25);
    expect(g.state.meat).toBe(25);
    expect(g.apply({ type: "grow", dinoId: dino.id })).toBe("fully-grown");
    expect(g.sellValue(dino)).toBe(20); // 80% of 25 in a build phase
    expect(g.apply({ type: "sell", dinoId: dino.id })).toBeNull();
    expect(g.state.meat).toBe(45);
    expect(g.grid.isBlocked(2, 2)).toBe(false);
    expect(g.apply({ type: "sell", dinoId: dino.id })).toBe("not-yours");
  });
});

describe("migrations", () => {
  it("starts when the build timer runs out and pays a bonus for sending early", () => {
    const g = new Game(fixture, 1);
    run(g, 99);
    expect(g.state.phase).toBe("build");
    run(g, 1);
    expect(g.state.phase).toBe("migration");

    const h = new Game(fixture, 1);
    run(h, 60); // 40 ticks = 2 whole seconds left
    expect(h.earlySendBonus()).toBe(4);
    expect(h.apply({ type: "send" })).toBeNull();
    expect(h.state.meat).toBe(54);
    expect(h.state.phase).toBe("migration");
    expect(h.apply({ type: "send" })).toBe("wrong-phase");
  });

  it("leaks eat eggs and an empty nest loses the game", () => {
    const g = new Game(fixture, 1);
    g.apply({ type: "send" });
    const events = runUntil(g, () => g.state.invaders.length === 0 && g.state.spawnQueue.length === 0);
    const leaks = events.filter((e) => e.type === "leaked");
    expect(leaks).toHaveLength(2);
    expect(g.state.eggs).toBe(1);
    expect(g.state.phase).toBe("build");
    expect(g.state.migration).toBe(1);
    g.apply({ type: "send" });
    runUntil(g, () => g.state.phase === "lost");
    expect(g.state.eggs).toBe(0);
  });

  it("kills pay bounty, clearing pays the bonus, and clearing the last migration wins", () => {
    const g = new Game(fixture, 7);
    // a raptor next to the spawn kills compies (10 hp, 5 dmg every 4 ticks) before they get far
    for (const p of [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]) {
      expect(g.apply({ type: "place", defId: "raptor-1", x: p.x, y: p.y })).toBeNull();
    }
    g.apply({ type: "send" });
    const ev = runUntil(g, () => g.state.phase === "build");
    expect(ev.filter((e) => e.type === "killed")).toHaveLength(2);
    expect(ev.filter((e) => e.type === "leaked")).toHaveLength(0);
    expect(ev.some((e) => e.type === "migration-cleared")).toBe(true);
    // 50 start - 30 placed + 10 early bonus (5 s * 2) + 2 kills * 3 + 7 clear
    expect(g.state.meat).toBe(50 - 30 + 10 + 2 * 3 + 7);
    g.apply({ type: "send" });
    runUntil(g, () => g.state.phase === "won" || g.state.phase === "lost");
    expect(g.state.phase).toBe("won");
    // state.migration is a count of migrations cleared, not the highest index
    // cleared: it is what BestRunSave.migrationsCleared stores, so a win has to
    // read as all of them rather than as one short.
    expect(g.state.migration).toBe(fixture.migrations.length);
  });

  it("ground-only dinosaurs ignore fliers", () => {
    const g = new Game(fixture, 3);
    g.apply({ type: "send" }); // compies, will leak past nothing
    runUntil(g, () => g.state.phase === "build");
    expect(g.state.eggs).toBe(1);
    // an armored (ground only) in the flight path does nothing to the ptero
    g.apply({ type: "place", defId: "armored-1", x: 2, y: 2 });
    g.apply({ type: "send" });
    const ev = runUntil(g, () => g.state.phase === "lost" || g.state.phase === "build");
    expect(ev.filter((e) => e.type === "attack")).toHaveLength(0);
    expect(g.state.phase).toBe("lost");
  });

  it("refuses to build on a cell an invader is in or walking into", () => {
    const g = new Game(fixture, 3);
    g.apply({ type: "send" });
    run(g, 3); // first compy has spawned at (0,0) and is heading right
    const inv = g.state.invaders[0]!;
    const cx = Math.floor(inv.px / 1000);
    const cy = Math.floor(inv.py / 1000);
    expect(g.apply({ type: "place", defId: "raptor-1", x: cx, y: cy })).toMatch(/invader-in-the-way|lane-cell/);
    if (inv.next) {
      expect(g.apply({ type: "place", defId: "raptor-1", x: inv.next.x, y: inv.next.y })).toBe("invader-in-the-way");
    }
  });
});

describe("determinism", () => {
  it("the same seed and command log produce the same state hash", () => {
    const play = (seed: number) => {
      const g = new Game(fixture, seed);
      g.apply({ type: "place", defId: "raptor-1", x: 1, y: 1 });
      g.apply({ type: "place", defId: "armored-1", x: 3, y: 3 });
      run(g, 30);
      g.apply({ type: "send" });
      runUntil(g, () => g.state.phase !== "migration");
      return g.hash();
    };
    expect(play(42)).toBe(play(42));
    const other = new Game(fixture, 42);
    other.apply({ type: "place", defId: "raptor-1", x: 1, y: 1 });
    run(other, 30);
    other.apply({ type: "send" });
    runUntil(other, () => other.state.phase !== "migration");
    expect(other.hash()).not.toBe(play(42));
  });
});
