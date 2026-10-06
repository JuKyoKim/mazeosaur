import { describe, expect, it } from "vitest";
import { freshSave, type Dino, type DinoDef } from "@mazeosaur/sim";
import { content } from "@mazeosaur/content";
import { packFrom, runSummary } from "../src/summary.js";
import { runFinished } from "../src/profile.js";

/**
 * `summary.ts` is the half of the results screen that can be tested
 * without a browser: what the screen is *told*. What it draws with that is
 * Phaser and is checked by `tests/client/results.spec.ts`.
 */

const BUILD = { commit: "dev", platform: "node" as const };

function dino(id: number, defId: string): Dino {
  return { id, defId, x: 0, y: 0, cooldown: 0, invested: 0 };
}

/** The real content's defs, so the stage filter is tested against real data. */
const defOf = (d: Dino): DinoDef => {
  const def = content.dinos[d.defId];
  if (!def) throw new Error(`no such def: ${d.defId}`);
  return def;
};

/** One adult and one hatchling of a known line, read out of the content. */
const adults = Object.values(content.dinos).filter((d) => d.stage === 3);
const hatchling = Object.values(content.dinos).find((d) => d.stage === 1)!;
const adultA = adults[0]!;
const adultB = adults.find((d) => d.kind !== adultA.kind)!;

describe("packFrom", () => {
  it("keeps adults only — the pack is what the player grew, not what they placed", () => {
    const pack = packFrom([dino(1, hatchling.id), dino(2, adultA.id)], defOf);
    expect(pack).toEqual([{ defId: adultA.id, name: adultA.name, kind: adultA.kind, count: 1 }]);
  });

  it("groups a genus and counts it, so three of one read as three", () => {
    const pack = packFrom([dino(1, adultA.id), dino(2, adultA.id), dino(3, adultA.id)], defOf);
    expect(pack).toHaveLength(1);
    expect(pack[0]).toMatchObject({ name: adultA.name, count: 3 });
  });

  it("orders by the first one grown, not alphabetically or by count", () => {
    const pack = packFrom([dino(1, adultB.id), dino(2, adultA.id), dino(3, adultA.id)], defOf);
    expect(pack.map((p) => p.defId)).toEqual([adultB.id, adultA.id]);
    expect(pack.map((p) => p.count)).toEqual([1, 2]);
  });

  it("is empty when nothing was grown, which the screen has to render", () => {
    expect(packFrom([dino(1, hatchling.id)], defOf)).toEqual([]);
  });
});

describe("runSummary", () => {
  const state = { migration: 12, eggs: 15, meat: 25, dinos: [dino(1, adultA.id)] };

  it("reports migrations cleared as the index, so a loss on the first is 0", () => {
    const first = runSummary("lost", { ...state, migration: 0 }, defOf, 7, content, 0);
    expect(first.migrationsCleared).toBe(0);
    expect(first.migrationsTotal).toBe(content.migrations.length);
  });

  it("carries the seed so the run can be reproduced", () => {
    expect(runSummary("lost", state, defOf, 4242, content, 0).seed).toBe(4242);
  });

  /**
   * §5.4: the screen shows the figure the board banked, and this is the
   * seam that carries it. A player shown one number and credited another
   * has no way to tell which of the two is wrong, so the summary is handed
   * the award rather than deriving one — `runSummary` has no access to
   * `fossilWeights` any more, which makes a second derivation a type error
   * rather than a thing to remember not to write.
   *
   * Composed against the real `runFinished` rather than an invented number,
   * because the claim is about the two agreeing and not about either on its
   * own.
   */
  it("carries exactly the award flush() banked for the same run", () => {
    const before = freshSave(BUILD).profile;
    const finish = runFinished(before, content.rules.fossilWeights, {
      valleyId: content.valley.id,
      seed: 7,
      contentVersion: content.version,
      migrationsCleared: state.migration,
      eggsLeft: state.eggs,
      meatUnspent: state.meat,
    });
    const s = runSummary("won", state, defOf, 7, content, finish.fossilsAwarded);
    expect(s.fossilsAwarded).toBe(finish.profile.fossilsEarned - before.fossilsEarned);
    // Non-zero, or the equality above would hold for a summary that simply
    // dropped the award on the floor.
    expect(s.fossilsAwarded).toBeGreaterThan(0);
  });

  it("passes the outcome through, which is the only thing the headline reads", () => {
    expect(runSummary("won", state, defOf, 1, content, 0).outcome).toBe("won");
    expect(runSummary("lost", state, defOf, 1, content, 0).outcome).toBe("lost");
  });
});
