import { describe, expect, it } from "vitest";
import { DIFFICULTIES, Game, laneIsOpen, Grid, KIND_CYCLE, TICKS_PER_SECOND, type Content } from "@mazeosaur/sim";
import { allContent, content, contentFor, DEFAULT_DIFFICULTY, DIFFICULTY_TUNING, fossilAward, hatchlings } from "../src/index.js";

/** Total hit points a difficulty asks the player to chew through. */
function hpPool(c: Content): number {
  return c.migrations.reduce((sum, m) => sum + m.groups.reduce((t, g) => t + g.count * c.invaders[g.invader]!.hp, 0), 0);
}

/** Invaders a difficulty sends, across all fifty migrations. */
function invaderCount(c: Content): number {
  return c.migrations.reduce((sum, m) => sum + m.groups.reduce((t, g) => t + g.count, 0), 0);
}

describe("content integrity", () => {
  it.each(DIFFICULTIES)("%s: every migration references a known invader and every growsTo a known next stage", (difficulty) => {
    const content = contentFor(difficulty);
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
    for (const i of Object.values(content.invaders)) {
      expect(KIND_CYCLE).toContain(i.kind);
      expect(i.hp, `${i.id} hp`).toBeGreaterThan(0);
      expect(i.bounty, `${i.id} bounty`).toBeGreaterThan(0);
    }
    expect(hatchlings.length).toBeGreaterThanOrEqual(3);
  });

  it("the empty valley is walkable and the lane cells are inside it", () => {
    const v = content.valley;
    const grid = new Grid(v.width, v.height);
    for (const r of v.rock) grid.setBlocked(r.x, r.y, true);
    expect(laneIsOpen(grid, v.lane)).toBe(true);
    for (const p of [v.lane.spawn, v.lane.exit, ...v.lane.checkpoints]) expect(grid.inBounds(p.x, p.y)).toBe(true);
  });

  it("the fossil weights are non-negative, so no run is ever worth negative fossils", () => {
    const w = content.rules.fossilWeights;
    expect(w.perEggKept).toBeGreaterThanOrEqual(0);
    expect(w.perMigrationCleared).toBeGreaterThanOrEqual(0);
    expect(w.perMeatUnspent).toBeGreaterThanOrEqual(0);
    expect(fossilAward(w, { eggsLeft: 0, migrationsCleared: 0, meatUnspent: 0 })).toBe(0);
    expect(fossilAward(w, { eggsLeft: 20, migrationsCleared: 50, meatUnspent: 300 })).toBeGreaterThan(
      fossilAward(w, { eggsLeft: 0, migrationsCleared: 1, meatUnspent: 0 }),
    );
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
    expect(kills).toBe(content.migrations[0]!.groups[0]!.count);
    expect(leaks).toBe(0);
    expect(g.state.eggs).toBe(20);
  });

  /**
   * Section 8 of `docs/01-art-hud-and-audio.md` teaches mazing with a single
   * placement: the player taps the one lit button, the path bends, and the
   * first migration is small enough that one dinosaur is a kill to watch and
   * no egg lost. Every number behind that promise lives in content, so the
   * promise can drift without anyone editing the spec. This pins it.
   */
  it("one hatchling is enough for the first migration on easy, as onboarding promises", () => {
    const g = new Game(contentFor("easy"), 1);
    expect(g.apply({ type: "place", defId: "raptor-1", x: 1, y: 1 })).toBeNull();
    g.apply({ type: "send" });
    let kills = 0;
    for (let i = 0; i < 20_000 && g.state.phase === "migration"; i++) {
      g.tick();
      for (const e of g.drainEvents()) if (e.type === "killed") kills++;
    }
    expect(g.state.phase).toBe("build");
    // "enough to watch a kill"
    expect(kills).toBeGreaterThan(0);
    // "not enough to lose an egg even with one dinosaur placed"
    expect(g.state.eggs).toBe(content.rules.eggs);
  });
});

/**
 * Difficulty is content data: three complete `Content` values out of one
 * tuning table. These tests pin the *ordering* the owner asked for in
 * [ARB-216](/ARB/issues/ARB-216) item 3, which is the part a tuning pass
 * can accidentally break, and the version-string rule the save format
 * leans on.
 */
describe("difficulty", () => {
  it("each difficulty is its own content, and says which one it is", () => {
    for (const difficulty of DIFFICULTIES) {
      const c = contentFor(difficulty);
      expect(c.difficulty, "the label matches the key it was fetched by").toBe(difficulty);
      expect(c.version, "the difficulty is part of the version string").toContain(difficulty);
      // Referentially stable: a `Game` holds its `Content` for a whole run.
      expect(contentFor(difficulty)).toBe(c);
    }
    const versions = allContent.map((c) => c.version);
    expect(new Set(versions).size, `distinct content versions: ${versions.join(", ")}`).toBe(DIFFICULTIES.length);
    expect(content).toBe(contentFor(DEFAULT_DIFFICULTY));
  });

  /**
   * Section 1.5 of `docs/01-v1-architecture.md`: `loadSave` compares
   * `run.contentVersion` with `content.version` using `===`. Because the
   * difficulty is in that string, a resume handed the wrong difficulty's
   * content drops the run instead of replaying it at numbers the player
   * never played. That is the whole determinism argument, so it gets a
   * test rather than a sentence.
   */
  it("no two difficulties could ever be mistaken for each other by the save's version check", () => {
    for (const a of DIFFICULTIES) {
      for (const b of DIFFICULTIES) {
        if (a === b) continue;
        expect(contentFor(a).version).not.toBe(contentFor(b).version);
      }
    }
  });

  it("easy is exactly today's invader numbers: the identity, not an approximation", () => {
    const easy = DIFFICULTY_TUNING.easy;
    expect(easy.countPercent).toBe(100);
    expect(easy.hpPercent).toBe(100);
    expect(easy.bountyPercent).toBe(100);
  });

  it("more invaders on medium, tankier ones on hard, and neither takes any away", () => {
    const [easy, medium, hard] = [contentFor("easy"), contentFor("medium"), contentFor("hard")];

    // "medium lets make the waves have more enemies"
    expect(invaderCount(medium)).toBeGreaterThan(invaderCount(easy));
    // "hard more enemies with more health or tankyness"
    expect(invaderCount(hard)).toBeGreaterThanOrEqual(invaderCount(medium));
    expect(hpPool(hard)).toBeGreaterThan(hpPool(medium));
    expect(hpPool(medium)).toBeGreaterThan(hpPool(easy));

    // A boss is still one boss: percentOf(1, 130) rounds back to 1.
    for (const c of [medium, hard]) {
      for (const m of c.migrations) {
        for (const g of m.groups) {
          if (c.invaders[g.invader]!.archetype === "boss") expect(g.count, `${c.difficulty} ${m.id}`).toBe(1);
        }
      }
    }
  });

  /**
   * The lever that makes "more enemies" mean pressure instead of income.
   * Thirty percent more invaders at full bounty paid for thirty percent
   * more maze, and the scripted player reached *further* on medium than on
   * easy and won the valley. Flat meat per migration is the fix, and this
   * is the assertion that keeps it fixed.
   */
  it("a harder difficulty never pays more meat than an easier one", () => {
    const meatPool = (c: Content) =>
      c.migrations.reduce((sum, m) => sum + m.clearBonus + m.groups.reduce((t, g) => t + g.count * c.invaders[g.invader]!.bounty, 0), 0);
    expect(meatPool(contentFor("medium"))).toBeLessThanOrEqual(meatPool(contentFor("easy")));
    expect(meatPool(contentFor("hard"))).toBeLessThanOrEqual(meatPool(contentFor("medium")));
  });

  /**
   * Item 8 asked for "a bit more time to the mob/wave spawn" and item 3
   * for hard's timer to be "3 seconds shorter". Both land on the same
   * field, so both are pinned here: the three-second gap in particular,
   * because it is a number the owner named out loud.
   */
  it("hard gives three seconds less to maze than medium, and medium gives easy's", () => {
    const seconds = (c: Content) => c.rules.buildPhaseTicks / TICKS_PER_SECOND;
    expect(seconds(contentFor("easy")), "item 8: more than the 30s it was").toBeGreaterThan(30);
    expect(seconds(contentFor("medium"))).toBe(seconds(contentFor("easy")));
    expect(seconds(contentFor("hard"))).toBe(seconds(contentFor("medium")) - 3);
    for (const c of allContent) expect(Number.isInteger(c.rules.buildPhaseTicks), c.difficulty).toBe(true);
  });
});
