import { describe, expect, it } from "vitest";
import { Game, KIND_CYCLE, type Content, type Kind } from "@mazeosaur/sim";
import { content, hatchlings } from "../src/index.js";

/**
 * A scripted player, deliberately unremarkable: it paints the obvious
 * serpentine, buys the kind that counters the next migration, grows what
 * it can, and always sends early. A human should beat it; a change that
 * makes it die ten migrations earlier is a balance change, not a fix.
 */

interface MigrationResult {
  w: number;
  leaks: number;
  eggs: number;
  meat: number;
  dinos: number;
}

/** Wall rows every third row, gaps alternating sides; the lane cells stay open. */
function serpentine(c: Content): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const w = c.valley.width;
  for (let y = 3; y < c.valley.height - 1; y += 3) {
    const gapRight = (y / 3) % 2 === 1;
    const from = gapRight ? 0 : 2;
    const to = gapRight ? w - 2 : w;
    for (let x = from; x < to; x++) cells.push({ x, y });
  }
  return cells;
}

/**
 * Cells beside the straight flight line from spawn to nest. Fliers ignore
 * the maze, so anti-air goes here; a person sees the line and does this.
 */
function flightLine(c: Content): { x: number; y: number }[] {
  const { spawn, exit } = c.valley.lane;
  const cells: { x: number; y: number }[] = [];
  const steps = Math.max(Math.abs(exit.x - spawn.x), Math.abs(exit.y - spawn.y));
  const seen = new Set<string>();
  for (let i = 1; i < steps; i++) {
    const x = Math.round(spawn.x + ((exit.x - spawn.x) * i) / steps);
    const y = Math.round(spawn.y + ((exit.y - spawn.y) * i) / steps);
    for (const cell of [
      { x: x + 1, y },
      { x: x - 1, y },
    ]) {
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key) || cell.x < 0 || cell.x >= c.valley.width) continue;
      seen.add(key);
      cells.push(cell);
    }
  }
  return cells;
}

/** The attacking kind that does double damage to `defender`. */
export function counterOf(defender: Kind): Kind {
  const i = KIND_CYCLE.indexOf(defender);
  return KIND_CYCLE[(i - 1 + KIND_CYCLE.length) % KIND_CYCLE.length] as Kind;
}

/** Read through a call so TypeScript does not narrow a phase that tick() mutates. */
const phaseOf = (g: Game) => g.state.phase;

export function playScripted(c: Content, seed: number, maxMigrations = c.migrations.length): MigrationResult[] {
  const g = new Game(c, seed);
  const maze = serpentine(c);
  const air = flightLine(c);
  let mazeIndex = 0;
  let airIndex = 0;
  const results: MigrationResult[] = [];
  const hatchlingOf = (kind: Kind) => hatchlings.find((h) => h.kind === kind);

  const spend = () => {
    const m = g.currentMigration();
    if (!m) return;
    const first = c.invaders[m.groups[0]!.invader]!;
    let counter = counterOf(first.kind);
    if (first.flying && !["raptor", "flier"].includes(counter)) counter = "raptor";
    for (let guard = 0; guard < 400; guard++) {
      // 0. before a flying migration, line the flight path with anti-air
      if (first.flying && airIndex < air.length) {
        const cell = air[airIndex]!;
        const def = hatchlingOf(counter)!;
        if (g.state.meat < def.cost) return;
        g.apply({ type: "place", defId: def.id, x: cell.x, y: cell.y });
        airIndex++;
        continue;
      }
      // 1. extend the maze with the counter kind when affordable, else the cheapest wall
      if (mazeIndex < maze.length) {
        const cell = maze[mazeIndex]!;
        const want = hatchlingOf(counter)!;
        const cheap = hatchlings[0]!;
        const def = g.state.meat >= want.cost ? want : g.state.meat >= cheap.cost ? cheap : null;
        if (!def) return;
        const r = g.apply({ type: "place", defId: def.id, x: cell.x, y: cell.y });
        mazeIndex++;
        if (r && r !== "occupied") continue;
        continue;
      }
      // 2. grow: counter kind first, cheapest growth first
      const candidates = g.state.dinos
        .map((d) => ({ d, def: g.dinoDef(d) }))
        .filter(({ def }) => def.growsTo)
        .map(({ d, def }) => ({ d, next: c.dinos[def.growsTo!]! }))
        .filter(({ next }) => g.state.meat >= next.cost)
        .sort((a, b) => Number(b.next.kind === counter) - Number(a.next.kind === counter) || a.next.cost - b.next.cost || a.d.id - b.d.id);
      const pick = candidates[0];
      if (!pick) return;
      g.apply({ type: "grow", dinoId: pick.d.id });
    }
  };

  while (phaseOf(g) === "build" && results.length < maxMigrations) {
    spend();
    const w = g.state.migration + 1;
    g.apply({ type: "send" });
    let leaks = 0;
    for (let i = 0; i < 200_000 && phaseOf(g) === "migration"; i++) {
      g.tick();
      for (const e of g.drainEvents()) if (e.type === "leaked") leaks++;
    }
    results.push({ w, leaks, eggs: g.state.eggs, meat: g.state.meat, dinos: g.state.dinos.length });
    if (phaseOf(g) === "lost") break;
  }
  return results;
}

describe("balance harness", () => {
  it("the scripted player survives at least thirty-five migrations", () => {
    const results = playScripted(content, 1);
    const lines = results.map((r) => `m${String(r.w).padStart(2, "0")} leaks=${r.leaks} eggs=${r.eggs} meat=${r.meat} dinos=${r.dinos}`);
    console.log(["", "scripted player, seed 1:", ...lines].join("\n"));
    const last = results[results.length - 1]!;
    expect(last.w, "migrations reached").toBeGreaterThanOrEqual(35);
  });

  it("without any dinosaurs the nest falls by migration three", () => {
    const g = new Game(content, 1);
    let w = 0;
    while (phaseOf(g) === "build") {
      w = g.state.migration + 1;
      g.apply({ type: "send" });
      for (let i = 0; i < 100_000 && phaseOf(g) === "migration"; i++) g.tick();
    }
    expect(g.state.phase).toBe("lost");
    expect(w).toBeLessThanOrEqual(3);
  });
});
