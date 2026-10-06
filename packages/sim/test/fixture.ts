import type { Content } from "../src/index.js";

/**
 * A tiny content set for sim tests: a 6x6 valley with one checkpoint,
 * two dinosaur kinds, two invaders, two migrations. Numbers are chosen
 * to be easy to reason about, not to be fun.
 */
export const fixture: Content = {
  version: "test",
  difficulty: "easy",
  rules: {
    startingMeat: 50,
    eggs: 3,
    buildPhaseTicks: 100,
    earlyBonusPerSecond: 2,
    sellRefundBuildPercent: 80,
    sellRefundMigrationPercent: 60,
    fossilWeights: { perEggKept: 1, perMigrationCleared: 1, perMeatUnspent: 1 },
  },
  dinos: {
    "raptor-1": {
      id: "raptor-1",
      name: "Velociraptor",
      kind: "raptor",
      stage: 1,
      cost: 10,
      range: 1500,
      damage: 5,
      cooldown: 4,
      targets: "both",
      growsTo: "raptor-2",
    },
    "raptor-2": {
      id: "raptor-2",
      name: "Deinonychus",
      kind: "raptor",
      stage: 2,
      cost: 15,
      range: 1800,
      damage: 12,
      cooldown: 4,
      targets: "both",
    },
    "armored-1": {
      id: "armored-1",
      name: "Nodosaurus",
      kind: "armored",
      stage: 1,
      cost: 20,
      range: 1500,
      damage: 6,
      cooldown: 10,
      targets: "ground",
      splash: 1000,
    },
  },
  invaders: {
    compy: { id: "compy", name: "Compsognathus", kind: "raptor", archetype: "normal", hp: 10, speed: 250, flying: false, bounty: 3, eggs: 1 },
    ptero: { id: "ptero", name: "Pteranodon", kind: "flier", archetype: "flying", hp: 10, speed: 250, flying: true, bounty: 4, eggs: 1 },
  },
  migrations: [
    { id: "m1", name: "Compies", groups: [{ invader: "compy", count: 2, spacing: 5 }], clearBonus: 7 },
    { id: "m2", name: "Pteros", groups: [{ invader: "ptero", count: 1, spacing: 5 }], clearBonus: 9 },
  ],
  valley: {
    id: "test",
    name: "Test valley",
    width: 6,
    height: 6,
    lane: { spawn: { x: 0, y: 0 }, checkpoints: [{ x: 5, y: 0 }], exit: { x: 5, y: 5 } },
    rock: [{ x: 2, y: 3 }],
  },
};
