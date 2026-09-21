import { describe, expect, it } from "vitest";
import { Game, laneIsOpen, Grid, KIND_CYCLE } from "@mazeosaur/sim";
import { content, hatchlings } from "../src/index.js";

describe("content integrity", () => {
  it("every migration references a known invader and every growsTo a known next stage", () => {
    for (const m of content.migrations) {
      for (const g of m.groups) {
        expect(content.invaders[g.invader], `${m.id} -> ${g.invader}`).toBeDefined();
        expect(g.count).toBeGreaterThan(0);
        expect(g.spacing).toBeGreaterThan(0);
      }
    }
    for (const d of Object.values(content.dinos)) {
      expect(KIND_CYCLE).toContain(d.kind);
      if (d.growsTo) {
        const next = content.dinos[d.growsTo];
        expect(next, `${d.id} grows to ${d.growsTo}`).toBeDefined();
        expect(next!.stage).toBe(d.stage + 1);
        expect(next!.kind).toBe(d.kind);
      } else {
        expect(d.stage).toBe(3);
      }
    }
    for (const i of Object.values(content.invaders)) expect(KIND_CYCLE).toContain(i.kind);
    expect(hatchlings.length).toBeGreaterThanOrEqual(3);
  });

  it("the empty valley is walkable and the lane cells are inside it", () => {
    const v = content.valley;
    const grid = new Grid(v.width, v.height);
    for (const r of v.rock) grid.setBlocked(r.x, r.y, true);
    expect(laneIsOpen(grid, v.lane)).toBe(true);
    for (const p of [v.lane.spawn, v.lane.exit, ...v.lane.checkpoints]) expect(grid.inBounds(p.x, p.y)).toBe(true);
  });

  it("a scripted starter maze clears the first migration without leaking", () => {
    const g = new Game(content, 2026);
    // a row of raptors under the spawn, then a wall that forces a detour
    const placements = [
      [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
    ];
    for (const [x, y] of placements) {
      expect(g.apply({ type: "place", defId: "raptor-1", x: x!, y: y! })).toBeNull();
    }
    g.apply({ type: "send" });
    let leaks = 0;
    let kills = 0;
    for (let i = 0; i < 20_000 && g.state.phase === "migration"; i++) {
      g.tick();
      for (const e of g.drainEvents()) {
        if (e.type === "leaked") leaks++;
        if (e.type === "killed") kills++;
      }
    }
    expect(g.state.phase).toBe("build");
    expect(kills).toBe(10);
    expect(leaks).toBe(0);
    expect(g.state.eggs).toBe(20);
  });
});
