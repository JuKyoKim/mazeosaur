import type { Content, DinoDef, InvaderDef, MigrationDef, ValleyDef } from "@mazeosaur/sim";

/**
 * M1 content: three kinds, ten migrations, one valley. Every number here is
 * a first guess to make the prototype playable; the balance harness (M2)
 * is what turns guesses into tuning.
 *
 * Units, from the sim: milli-cells (1000 = one cell), ticks (20 per
 * second), integer damage and meat.
 */

const dinoList: DinoDef[] = [
  // Raptor: cheap, fast, hits fliers. The wall you paint with.
  { id: "raptor-1", name: "Velociraptor", kind: "raptor", stage: 1, cost: 10, range: 1800, damage: 4, cooldown: 10, targets: "both", growsTo: "raptor-2" },
  { id: "raptor-2", name: "Deinonychus", kind: "raptor", stage: 2, cost: 20, range: 2000, damage: 10, cooldown: 8, targets: "both", growsTo: "raptor-3" },
  { id: "raptor-3", name: "Utahraptor", kind: "raptor", stage: 3, cost: 40, range: 2200, damage: 24, cooldown: 6, targets: "both" },

  // Tyrant: slow, heavy bites. Ground only.
  { id: "tyrant-1", name: "Tarbosaurus", kind: "tyrant", stage: 1, cost: 25, range: 2200, damage: 30, cooldown: 30, targets: "ground", growsTo: "tyrant-2" },
  { id: "tyrant-2", name: "Daspletosaurus", kind: "tyrant", stage: 2, cost: 45, range: 2400, damage: 80, cooldown: 28, targets: "ground", growsTo: "tyrant-3" },
  { id: "tyrant-3", name: "Tyrannosaurus", kind: "tyrant", stage: 3, cost: 90, range: 2600, damage: 200, cooldown: 26, targets: "ground" },

  // Armored: tail-club splash. Ground only.
  { id: "armored-1", name: "Nodosaurus", kind: "armored", stage: 1, cost: 20, range: 1600, damage: 8, cooldown: 20, targets: "ground", splash: 1000, growsTo: "armored-2" },
  { id: "armored-2", name: "Euoplocephalus", kind: "armored", stage: 2, cost: 35, range: 1700, damage: 20, cooldown: 20, targets: "ground", splash: 1200, growsTo: "armored-3" },
  { id: "armored-3", name: "Ankylosaurus", kind: "armored", stage: 3, cost: 70, range: 1800, damage: 50, cooldown: 20, targets: "ground", splash: 1400 },
];

const invaderList: InvaderDef[] = [
  { id: "compsognathus", name: "Compsognathus", kind: "raptor", hp: 25, speed: 100, flying: false, bounty: 2, eggs: 1 },
  { id: "parasaurolophus", name: "Parasaurolophus", kind: "longneck", hp: 60, speed: 90, flying: false, bounty: 4, eggs: 1 },
  { id: "gallimimus", name: "Gallimimus", kind: "raptor", hp: 50, speed: 170, flying: false, bounty: 4, eggs: 1 },
  { id: "pachycephalosaurus", name: "Pachycephalosaurus", kind: "horned", hp: 120, speed: 100, flying: false, bounty: 6, eggs: 1 },
  { id: "pteranodon", name: "Pteranodon", kind: "flier", hp: 90, speed: 110, flying: true, bounty: 6, eggs: 1 },
  { id: "stegosaurus", name: "Stegosaurus", kind: "armored", hp: 220, speed: 80, flying: false, bounty: 8, eggs: 1 },
  { id: "iguanodon", name: "Iguanodon", kind: "longneck", hp: 200, speed: 100, flying: false, bounty: 8, eggs: 1 },
  { id: "ankylosaurus", name: "Ankylosaurus", kind: "armored", hp: 450, speed: 70, flying: false, bounty: 12, eggs: 1 },
  { id: "dromaeosaurus", name: "Dromaeosaurus", kind: "raptor", hp: 150, speed: 160, flying: false, bounty: 7, eggs: 1 },
  { id: "giganotosaurus", name: "Giganotosaurus", kind: "tyrant", hp: 3000, speed: 80, flying: false, bounty: 100, eggs: 5, boss: true },
];

const migrations: MigrationDef[] = [
  { id: "m01", name: "Scavengers", groups: [{ invader: "compsognathus", count: 10, spacing: 16 }], clearBonus: 13 },
  { id: "m02", name: "Crested herd", groups: [{ invader: "parasaurolophus", count: 8, spacing: 20 }], clearBonus: 16 },
  { id: "m03", name: "Sprinters", groups: [{ invader: "gallimimus", count: 10, spacing: 12 }], clearBonus: 19 },
  { id: "m04", name: "Headbutters", groups: [{ invader: "pachycephalosaurus", count: 8, spacing: 20 }], clearBonus: 22 },
  { id: "m05", name: "Overflight", groups: [{ invader: "pteranodon", count: 8, spacing: 18 }], clearBonus: 25 },
  { id: "m06", name: "Plated column", groups: [{ invader: "stegosaurus", count: 8, spacing: 24 }], clearBonus: 28 },
  { id: "m07", name: "Thumb-spikes", groups: [{ invader: "iguanodon", count: 10, spacing: 18 }], clearBonus: 31 },
  { id: "m08", name: "Living walls", groups: [{ invader: "ankylosaurus", count: 6, spacing: 30 }], clearBonus: 34 },
  { id: "m09", name: "Pack hunt", groups: [{ invader: "dromaeosaurus", count: 14, spacing: 10 }], clearBonus: 37 },
  { id: "m10", name: "The Giant", groups: [{ invader: "giganotosaurus", count: 1, spacing: 1 }], clearBonus: 60 },
];

/**
 * The first valley: 20 wide, 28 tall, portrait. Spawn top-left, nest
 * bottom-right, checkpoints on alternating sides so the shortest natural
 * route is already an S and every wall the player adds lengthens it.
 */
const valley: ValleyDef = {
  id: "nesting-grounds",
  name: "Nesting Grounds",
  width: 20,
  height: 28,
  lane: {
    spawn: { x: 0, y: 0 },
    checkpoints: [
      { x: 19, y: 9 },
      { x: 0, y: 18 },
    ],
    exit: { x: 19, y: 27 },
  },
  rock: [],
};

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of list) {
    if (out[item.id]) throw new Error(`duplicate id ${item.id}`);
    out[item.id] = item;
  }
  return out;
}

export const content: Content = {
  version: "m1.0",
  rules: {
    startingMeat: 60,
    eggs: 20,
    buildPhaseTicks: 30 * 20,
    earlyBonusPerSecond: 1,
    sellRefundBuildPercent: 80,
    sellRefundMigrationPercent: 60,
  },
  dinos: byId(dinoList),
  invaders: byId(invaderList),
  migrations,
  valley,
};

/** The stage-1 dinosaurs the player can buy, in palette order. */
export const hatchlings: readonly DinoDef[] = dinoList.filter((d) => d.stage === 1);
