import { describe, expect, it } from "vitest";
import { freshSave, type ProfileSave } from "@mazeosaur/sim";
import { runFinished, runStarted } from "../src/profile.js";

const WEIGHTS = { perEggKept: 2, perMigrationCleared: 20, perMeatUnspent: 1 };
const BUILD = { commit: "dev", platform: "node" as const };

function profile(overrides: Partial<ProfileSave> = {}): ProfileSave {
  return { ...freshSave(BUILD).profile, ...overrides };
}

describe("runStarted", () => {
  it("bumps only runsStarted", () => {
    const p = profile({ runsStarted: 3, fossilsEarned: 40 });
    const next = runStarted(p);
    expect(next.runsStarted).toBe(4);
    expect(next.fossilsEarned).toBe(40);
    expect(next.runsFinished).toBe(p.runsFinished);
  });
});

describe("runFinished", () => {
  const outcome = { valleyId: "nesting-grounds", seed: 7, contentVersion: "m1.0", migrationsCleared: 10, eggsLeft: 15, meatUnspent: 25 };

  it("awards fossils from the weight table and bumps runsFinished", () => {
    const p = profile();
    const next = runFinished(p, WEIGHTS, outcome);
    // 15*2 + 10*20 + 25*1 = 255
    expect(next.fossilsEarned).toBe(255);
    expect(next.runsFinished).toBe(1);
  });

  it("records a first result as best for that valley", () => {
    const p = profile();
    const next = runFinished(p, WEIGHTS, outcome);
    expect(next.best["nesting-grounds"]).toEqual({
      migrationsCleared: 10,
      eggsLeft: 15,
      fossils: 255,
      seed: 7,
      contentVersion: "m1.0",
    });
  });

  it("replaces best when more migrations are cleared", () => {
    const p = profile({ best: { "nesting-grounds": { migrationsCleared: 5, eggsLeft: 1, fossils: 9, seed: 1, contentVersion: "m1.0" } } });
    const next = runFinished(p, WEIGHTS, outcome);
    expect(next.best["nesting-grounds"]!.migrationsCleared).toBe(10);
  });

  it("keeps the existing best when the new run clears fewer migrations", () => {
    const existing = { migrationsCleared: 20, eggsLeft: 1, fossils: 999, seed: 1, contentVersion: "m1.0" };
    const p = profile({ best: { "nesting-grounds": existing } });
    const next = runFinished(p, WEIGHTS, outcome);
    expect(next.best["nesting-grounds"]).toEqual(existing);
  });

  it("leaves other valleys' best untouched", () => {
    const other = { migrationsCleared: 2, eggsLeft: 0, fossils: 40, seed: 1, contentVersion: "m1.0" };
    const p = profile({ best: { "other-valley": other } });
    const next = runFinished(p, WEIGHTS, outcome);
    expect(next.best["other-valley"]).toEqual(other);
    expect(next.best["nesting-grounds"]).toBeDefined();
  });

  it("asserts fossilsEarned - fossilsSpent never goes negative", () => {
    const p = profile({ fossilsEarned: 0, fossilsSpent: 100 });
    expect(() => runFinished(p, WEIGHTS, { ...outcome, migrationsCleared: 0, eggsLeft: 0, meatUnspent: 0 })).toThrow();
  });
});
