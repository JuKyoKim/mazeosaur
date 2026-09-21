import { describe, expect, it } from "vitest";
import { Game, type Content, type GameEvent } from "../src/index.js";
import { fixture } from "./fixture.js";

/** The fixture plus the M2 mechanics, one migration at a time. */
function withMigration(extra: Partial<Content>, groups: { invader: string; count: number; spacing: number }[]): Content {
  return {
    ...fixture,
    ...extra,
    dinos: { ...fixture.dinos, ...(extra.dinos ?? {}) },
    invaders: { ...fixture.invaders, ...(extra.invaders ?? {}) },
    migrations: [{ id: "only", name: "only", groups, clearBonus: 0 }],
  };
}

function runUntil(game: Game, pred: () => boolean, max = 3000): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !pred(); i++) {
    game.tick();
    events.push(...game.drainEvents());
  }
  if (!pred()) throw new Error("condition never met");
  return events;
}

const done = (g: Game) => g.state.phase !== "migration";

describe("shields", () => {
  it("absorb whole attacks, including slow and stun, before any damage lands", () => {
    const c = withMigration(
      {
        dinos: {
          "horned-1": { id: "horned-1", name: "Protoceratops", kind: "horned", stage: 1, cost: 10, range: 1500, damage: 100, cooldown: 1, targets: "ground", stun: { ticks: 6 } },
        },
        invaders: {
          shelled: { id: "shelled", name: "Scelidosaurus", kind: "armored", archetype: "shielded", hp: 10, speed: 250, flying: false, bounty: 1, eggs: 1, shield: 2 },
        },
      },
      [{ invader: "shelled", count: 1, spacing: 1 }],
    );
    const g = new Game(c, 1);
    g.apply({ type: "place", defId: "horned-1", x: 1, y: 1 });
    g.apply({ type: "send" });
    const ev = runUntil(g, () => done(g));
    const attacks = ev.filter((e) => e.type === "attack") as { damage: number }[];
    expect(attacks.slice(0, 2).map((a) => a.damage)).toEqual([0, 0]);
    expect(attacks[2]?.damage).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === "killed")).toBe(true);
  });
});

describe("splitters", () => {
  it("spawn their children where they died, on the same leg, and the children count toward the migration", () => {
    const c = withMigration(
      {
        dinos: {
          hunter: { id: "hunter", name: "Hunter", kind: "raptor", stage: 1, cost: 10, range: 9000, damage: 10, cooldown: 2, targets: "ground" },
        },
        invaders: {
          herd: { id: "herd", name: "Psittacosaurus", kind: "raptor", archetype: "splitter", hp: 5, speed: 250, flying: false, bounty: 2, eggs: 1, splitsInto: { invader: "compy", count: 2 } },
        },
      },
      [{ invader: "herd", count: 1, spacing: 1 }],
    );
    const g = new Game(c, 1);
    g.apply({ type: "place", defId: "hunter", x: 1, y: 1 });
    g.apply({ type: "send" });
    const ev = runUntil(g, () => g.state.invaders.length === 2, 200);
    const split = ev.find((e) => e.type === "split") as { into: number[] } | undefined;
    expect(split?.into).toHaveLength(2);
    expect(g.state.invaders.every((i) => i.defId === "compy")).toBe(true);
    const all = runUntil(g, () => done(g));
    // three kills in total: the parent and both children
    expect([...ev, ...all].filter((e) => e.type === "killed")).toHaveLength(3);
  });
});

describe("regenerators", () => {
  it("heal once a second, never above max", () => {
    const c = withMigration(
      {
        invaders: {
          healer: { id: "healer", name: "Plateosaurus", kind: "longneck", archetype: "regenerator", hp: 100, speed: 1, flying: false, bounty: 1, eggs: 1, regen: 10 },
        },
      },
      [{ invader: "healer", count: 1, spacing: 1 }],
    );
    const g = new Game(c, 1);
    g.apply({ type: "send" });
    runUntil(g, () => g.state.invaders.length === 1, 10);
    const inv = g.state.invaders[0]!;
    inv.hp = 50;
    const before = g.state.tick;
    runUntil(g, () => g.state.tick >= before + 45, 100);
    expect(inv.hp).toBe(70); // two whole seconds elapsed
    inv.hp = 95;
    runUntil(g, () => g.state.tick >= before + 65, 100);
    expect(inv.hp).toBe(100);
  });
});

describe("stun", () => {
  it("freezes a ground invader in place and does nothing to fliers", () => {
    const c = withMigration(
      {
        dinos: {
          "horned-1": { id: "horned-1", name: "Protoceratops", kind: "horned", stage: 1, cost: 10, range: 3000, damage: 1, cooldown: 100, targets: "both", stun: { ticks: 10 } },
        },
        invaders: {
          walker: { id: "walker", name: "Iguanodon", kind: "longneck", archetype: "normal", hp: 1000, speed: 100, flying: false, bounty: 1, eggs: 1 },
        },
      },
      [{ invader: "walker", count: 1, spacing: 1 }],
    );
    const g = new Game(c, 1);
    g.apply({ type: "place", defId: "horned-1", x: 2, y: 2 });
    g.apply({ type: "send" });
    runUntil(g, () => g.state.invaders.length === 1, 10);
    const inv = g.state.invaders[0]!;
    // the first attack lands on the first tick the invader exists in range
    runUntil(g, () => inv.stunUntil > 0, 20);
    const frozenAt = { x: inv.px, y: inv.py };
    runUntil(g, () => g.state.tick >= inv.stunUntil - 1, 40);
    expect({ x: inv.px, y: inv.py }).toEqual(frozenAt);
    runUntil(g, () => g.state.tick >= inv.stunUntil + 2, 40);
    expect({ x: inv.px, y: inv.py }).not.toEqual(frozenAt);

    const f = withMigration(
      { dinos: c.dinos },
      [{ invader: "ptero", count: 1, spacing: 1 }],
    );
    const h = new Game(f, 1);
    h.apply({ type: "place", defId: "horned-1", x: 2, y: 2 });
    h.apply({ type: "send" });
    runUntil(h, () => h.state.invaders.length === 1, 10);
    const p = h.state.invaders[0]!;
    runUntil(h, () => h.state.tick >= 5, 20);
    expect(p.stunUntil).toBe(0);
  });
});

describe("multi-target", () => {
  it("hits the N furthest-along invaders per cooldown", () => {
    const c = withMigration(
      {
        dinos: {
          "flier-1": { id: "flier-1", name: "Rhamphorhynchus", kind: "flier", stage: 1, cost: 10, range: 6000, damage: 1, cooldown: 1000, targets: "both", targetCount: 2 },
        },
      },
      [{ invader: "compy", count: 3, spacing: 1 }],
    );
    const g = new Game(c, 1);
    g.apply({ type: "place", defId: "flier-1", x: 2, y: 2 });
    g.apply({ type: "send" });
    // hold the first volley until all three have spawned
    g.state.dinos[0]!.cooldown = 10;
    const ev = runUntil(g, () => g.state.tick >= 12, 30);
    const attacks = ev.filter((e) => e.type === "attack") as { invaderId: number }[];
    expect(attacks).toHaveLength(2);
    // the first spawned (lowest id) is furthest along; it and the second are hit, the third is not
    const ids = g.state.invaders.map((i) => i.id).sort((a, b) => a - b);
    expect(ids).toHaveLength(3);
    expect(attacks.map((a) => a.invaderId).sort((a, b) => a - b)).toEqual([ids[0], ids[1]]);
  });
});
