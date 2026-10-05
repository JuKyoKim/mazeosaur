import { DIFFICULTIES, TICKS_PER_SECOND } from "@mazeosaur/sim";
import type { Archetype, Content, Difficulty, DinoDef, InvaderDef, Kind, MigrationDef, ValleyDef } from "@mazeosaur/sim";

/**
 * The game's numbers. Every value here is tuning, not rules: the sim
 * decides what a shield or a stun *is*, this file decides how many and
 * how strong. The balance test in ./test runs a scripted player through
 * all fifty migrations so a change here shows up as a number, not a
 * feeling.
 *
 * Units, from the sim: milli-cells (1000 = one cell), ticks (20 per
 * second), integer damage and meat.
 *
 * Difficulty is here too, and only here. `contentFor(difficulty)` returns
 * one of three complete `Content` values; the sim is handed one of them and
 * never learns there were others.
 */

// ------------------------------------------------------------ dinosaurs

const dinoList: DinoDef[] = [
  // Raptor: cheap, quick bites, leaps at fliers. The wall you paint with.
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

  // Horned: a charge that stops the target cold for a moment. Ground only.
  { id: "horned-1", name: "Protoceratops", kind: "horned", stage: 1, cost: 20, range: 1800, damage: 12, cooldown: 16, targets: "ground", stun: { ticks: 8 }, growsTo: "horned-2" },
  { id: "horned-2", name: "Styracosaurus", kind: "horned", stage: 2, cost: 35, range: 1900, damage: 30, cooldown: 16, targets: "ground", stun: { ticks: 10 }, growsTo: "horned-3" },
  { id: "horned-3", name: "Triceratops", kind: "horned", stage: 3, cost: 70, range: 2000, damage: 75, cooldown: 16, targets: "ground", stun: { ticks: 12 } },

  // Longneck: a stomp that slows everything near the target. Long range, low damage.
  { id: "longneck-1", name: "Diplodocus", kind: "longneck", stage: 1, cost: 30, range: 2600, damage: 6, cooldown: 30, targets: "ground", splash: 2200, slow: { percent: 35, ticks: 30 }, growsTo: "longneck-2" },
  { id: "longneck-2", name: "Brachiosaurus", kind: "longneck", stage: 2, cost: 55, range: 2800, damage: 15, cooldown: 30, targets: "ground", splash: 2500, slow: { percent: 40, ticks: 30 }, growsTo: "longneck-3" },
  { id: "longneck-3", name: "Argentinosaurus", kind: "longneck", stage: 3, cost: 110, range: 3000, damage: 36, cooldown: 30, targets: "ground", splash: 2800, slow: { percent: 45, ticks: 30 } },

  // Flier: dives on two or three targets at once. The anti-air line.
  { id: "flier-1", name: "Rhamphorhynchus", kind: "flier", stage: 1, cost: 15, range: 2400, damage: 6, cooldown: 12, targets: "both", targetCount: 2, growsTo: "flier-2" },
  { id: "flier-2", name: "Pteranodon", kind: "flier", stage: 2, cost: 30, range: 2600, damage: 15, cooldown: 12, targets: "both", targetCount: 2, growsTo: "flier-3" },
  { id: "flier-3", name: "Quetzalcoatlus", kind: "flier", stage: 3, cost: 60, range: 2800, damage: 36, cooldown: 12, targets: "both", targetCount: 3 },
];

// ----------------------------------------------------------- difficulty

/**
 * What a difficulty is allowed to change. The owner's model
 * ([ARB-216](/ARB/issues/ARB-216) item 3) is three levers — how many
 * invaders come, how much punishment each one takes, and how long the
 * player gets to maze between migrations — plus one the model needs in
 * order to mean what it says, `bountyPercent`.
 *
 * Percents, not floats, so every derived number stays integer arithmetic
 * — the same convention as `kindMultiplier`, `slow.percent` and the sell
 * refunds. `percentOf` rounds once, at the end.
 *
 * Levers deliberately *not* here, so the table stays small enough to
 * reason about: `shield` (an attack count, not hit points, so it is a
 * different kind of tanky), speed, spacing, starting meat, eggs, the
 * clear bonus and the fossil weights.
 */
export interface DifficultyTuning {
  /** Applied to every group's size, including migration 1's override. */
  readonly countPercent: number;
  /** Applied to every invader's hit points, and to a regenerator's regen. */
  readonly hpPercent: number;
  /**
   * Applied to every invader's bounty. Roughly the inverse of
   * `countPercent`, so a migration pays about the same meat however many
   * invaders are in it. Without this lever "more invaders" is *income*,
   * not pressure: the scripted player is meat-bound, not hit-point-bound,
   * and at 100 percent it reaches further on medium than on easy and wins
   * the valley outright. The numbers are in the pull request for ARB-219.
   */
  readonly bountyPercent: number;
  /** Build phase before each migration. The owner's "timer in between wave". */
  readonly buildPhaseSeconds: number;
}

/**
 * The first pass. The owner said in [ARB-216](/ARB/issues/ARB-216) that
 * they will tune these, so the shape is the deliverable and the values are
 * a starting point:
 *
 * - **easy is today's game.** Every invader number is bit-for-bit what it
 *   was before this table existed (`hpPercent`/`countPercent` of 100 are
 *   the identity), and the only change is the build phase: 30s -> 35s, the
 *   "bit more time to the mob/wave spawn" of item 8. Easy is the default
 *   and the one the onboarding promise in `content.test.ts` is pinned to.
 * - **medium is more invaders, same hit points, same timer.** 130% is
 *   ten Parasaurolophus becoming thirteen and a swarm of twenty-four
 *   becoming thirty-one. A boss stays one: `percentOf(1, 130)` rounds to 1.
 *   `bountyPercent` of 77 is 100/1.3, so thirteen invaders pay about what
 *   ten did and the extra three are pressure rather than income.
 * - **hard is medium plus tankier, minus three seconds.** 140% hit points
 *   on the same 130% counts, and 32s = easy's 35 - 3. Item 3's point was
 *   that the harder it is, the faster the player has to maze.
 */
export const DIFFICULTY_TUNING: Readonly<Record<Difficulty, DifficultyTuning>> = {
  easy: { countPercent: 100, hpPercent: 100, bountyPercent: 100, buildPhaseSeconds: 35 },
  medium: { countPercent: 130, hpPercent: 100, bountyPercent: 77, buildPhaseSeconds: 35 },
  hard: { countPercent: 130, hpPercent: 140, bountyPercent: 77, buildPhaseSeconds: 32 },
};

/** The difficulty a new run starts at, and the one a v1 save migrates to. */
export const DEFAULT_DIFFICULTY: Difficulty = "easy";

/**
 * `base * percent / 100`, rounded once and never below 1. At 100 percent
 * an integer `base` comes back unchanged, which is what makes easy
 * identical to the pre-difficulty numbers rather than merely close.
 */
function percentOf(base: number, percent: number): number {
  return Math.max(1, Math.round((base * percent) / 100));
}

// ------------------------------------------------------------- invaders

/**
 * Each archetype is a shape; the migration number sets the size. hp is a
 * multiple of the curve below, speed is milli-cells per tick, count and
 * spacing are the group, bounty is a multiple of the bounty curve.
 *
 * These are easy's numbers. The difficulty table above scales `hp` and
 * `count`; speed, spacing and bounty are the same on all three.
 */
const ARCHETYPES: Record<Archetype, { hp: number; speed: number; count: number; spacing: number; bounty: number; eggs: number }> = {
  normal: { hp: 1, speed: 100, count: 10, spacing: 16, bounty: 1, eggs: 1 },
  fast: { hp: 0.6, speed: 170, count: 12, spacing: 12, bounty: 1, eggs: 1 },
  tank: { hp: 2.5, speed: 70, count: 6, spacing: 28, bounty: 1.6, eggs: 1 },
  flying: { hp: 0.8, speed: 110, count: 8, spacing: 16, bounty: 1.2, eggs: 1 },
  swarm: { hp: 0.35, speed: 120, count: 24, spacing: 6, bounty: 0.4, eggs: 1 },
  splitter: { hp: 0.8, speed: 100, count: 8, spacing: 20, bounty: 0.8, eggs: 1 },
  regenerator: { hp: 1.2, speed: 90, count: 8, spacing: 20, bounty: 1.2, eggs: 1 },
  shielded: { hp: 0.9, speed: 100, count: 8, spacing: 18, bounty: 1.2, eggs: 1 },
  boss: { hp: 12, speed: 70, count: 1, spacing: 1, bounty: 15, eggs: 5 },
};

/**
 * Base hp for migration w (1-based): +10% a migration, ~x100 by fifty.
 * Bounty compounds too, a little slower, so late meat buys late dinosaurs
 * and the squeeze comes from the gap between the two rates plus the kind
 * chart, not from income going flat.
 */
export function hpCurve(w: number): number {
  let hp = 25;
  for (let i = 1; i < w; i++) hp = Math.round(hp * 1.1);
  return hp;
}

/** Base bounty for migration w: +7% a migration. */
export function bountyCurve(w: number): number {
  let b = 2;
  for (let i = 1; i < w; i++) b = b * 1.07;
  return Math.max(1, Math.round(b));
}

export function clearBonus(w: number): number {
  return 10 + 3 * w;
}

/**
 * Per-migration overrides on the derived numbers, for the migrations the
 * curve cannot describe.
 *
 * Migration 1 is one of those: it is the tutorial, so it is authored.
 * Section 8 of `docs/01-art-hud-and-audio.md` promises a first-time player
 * who places one dinosaur a kill to watch and no egg lost. The curve gives
 * ten Parasaurolophus at twenty-five hit points, and one Velociraptor
 * hatchling does four damage a hit: it lands sixteen hits across the whole
 * herd and kills none of them, so the first migration shows no kill and
 * takes ten of the twenty eggs. Eight hit points is two hits from that
 * hatchling, which is few enough that the strike reads as the cause of the
 * fall, and half speed keeps the herd inside its 1.8-cell range long
 * enough to land them. At those numbers one hatchling clears all six and
 * loses nothing.
 */
const OVERRIDES: Record<number, { hp?: number; speed?: number; count?: number }> = {
  1: { hp: 8, speed: 50, count: 6 },
};

/**
 * The fifty migrations: archetype, genus, kind. Fliers every six or so
 * (the maze is useless against them), a boss every ten, kinds rotating
 * so no single counter carries. Genus names are real and public.
 */
const SCHEDULE: readonly [Archetype, string, Kind][] = [
  ["normal", "Parasaurolophus", "longneck"],
  ["fast", "Gallimimus", "raptor"],
  ["swarm", "Compsognathus", "raptor"],
  ["normal", "Pachycephalosaurus", "horned"],
  ["flying", "Pteranodon", "flier"],
  ["tank", "Sauropelta", "armored"],
  ["splitter", "Psittacosaurus", "horned"],
  ["regenerator", "Plateosaurus", "longneck"],
  ["shielded", "Scelidosaurus", "armored"],
  ["boss", "Giganotosaurus", "tyrant"],
  ["flying", "Rhamphorhynchus", "flier"],
  ["normal", "Allosaurus", "tyrant"],
  ["fast", "Struthiomimus", "raptor"],
  ["swarm", "Microraptor", "raptor"],
  ["tank", "Apatosaurus", "longneck"],
  ["splitter", "Protoceratops", "horned"],
  ["flying", "Dimorphodon", "flier"],
  ["regenerator", "Baryonyx", "tyrant"],
  ["shielded", "Styracosaurus", "horned"],
  ["boss", "Argentinosaurus", "longneck"],
  ["normal", "Carnotaurus", "tyrant"],
  ["fast", "Dryosaurus", "horned"],
  ["flying", "Tapejara", "flier"],
  ["tank", "Euoplocephalus", "armored"],
  ["swarm", "Sinosauropteryx", "raptor"],
  ["splitter", "Maiasaura", "longneck"],
  ["regenerator", "Deinocheirus", "longneck"],
  ["shielded", "Kentrosaurus", "armored"],
  ["flying", "Tropeognathus", "flier"],
  ["boss", "Quetzalcoatlus", "flier"],
  ["normal", "Edmontosaurus", "longneck"],
  ["fast", "Ornithomimus", "raptor"],
  ["tank", "Camarasaurus", "longneck"],
  ["swarm", "Lesothosaurus", "horned"],
  ["flying", "Nyctosaurus", "flier"],
  ["splitter", "Oviraptor", "raptor"],
  ["regenerator", "Therizinosaurus", "longneck"],
  ["shielded", "Pentaceratops", "horned"],
  ["fast", "Coelophysis", "raptor"],
  ["boss", "Tarchia", "armored"],
  ["flying", "Anhanguera", "flier"],
  ["normal", "Camptosaurus", "horned"],
  ["tank", "Torosaurus", "horned"],
  ["swarm", "Heterodontosaurus", "horned"],
  ["splitter", "Orodromeus", "horned"],
  ["regenerator", "Diplodocus", "longneck"],
  ["flying", "Hatzegopteryx", "flier"],
  ["shielded", "Triceratops", "horned"],
  ["fast", "Dakotaraptor", "raptor"],
  ["boss", "Spinosaurus", "tyrant"],
];

const MIGRATION_NAMES: Record<Archetype, string> = {
  normal: "Herd on the move",
  fast: "Sprinters",
  tank: "Living walls",
  flying: "Overflight",
  swarm: "Scavengers",
  splitter: "Scattering herd",
  regenerator: "Thick hides",
  shielded: "Plated column",
  boss: "The Giant",
};

function slug(genus: string): string {
  return genus.toLowerCase();
}

function buildInvadersAndMigrations(t: DifficultyTuning): { invaders: Record<string, InvaderDef>; migrations: MigrationDef[] } {
  const invaders: Record<string, InvaderDef> = {};
  const migrations: MigrationDef[] = [];
  SCHEDULE.forEach(([archetype, genus, kind], i) => {
    const w = i + 1;
    const a = ARCHETYPES[archetype];
    const over = OVERRIDES[w] ?? {};
    const baseHp = hpCurve(w);
    const baseBounty = bountyCurve(w);
    const id = `${slug(genus)}-${w}`;
    const flying = archetype === "flying" || (archetype === "boss" && kind === "flier");
    const def: InvaderDef = {
      id,
      name: genus,
      kind,
      archetype,
      hp: percentOf(over.hp ?? Math.max(1, Math.round(baseHp * a.hp)), t.hpPercent),
      speed: over.speed ?? a.speed,
      flying,
      bounty: percentOf(Math.max(1, Math.round(baseBounty * a.bounty)), t.bountyPercent),
      eggs: a.eggs,
      // Regen scales with hp so a regenerator stays the same fraction of
      // itself per second on every difficulty, rather than getting
      // relatively weaker the tankier it is.
      ...(archetype === "regenerator" ? { regen: percentOf(Math.max(1, Math.round(baseHp * a.hp * 0.04)), t.hpPercent) } : {}),
      ...(archetype === "shielded" ? { shield: 2 + Math.floor(w / 10) } : {}),
      ...(archetype === "splitter" ? { splitsInto: { invader: `${id}-young`, count: 2 } } : {}),
    };
    invaders[id] = def;
    if (archetype === "splitter") {
      invaders[`${id}-young`] = {
        id: `${id}-young`,
        name: `young ${genus}`,
        kind,
        archetype: "normal",
        hp: percentOf(Math.max(1, Math.round(baseHp * 0.4)), t.hpPercent),
        speed: 130,
        flying: false,
        bounty: percentOf(Math.max(1, Math.round(baseBounty * 0.3)), t.bountyPercent),
        eggs: 1,
      };
    }
    const name = archetype === "boss" ? `${MIGRATION_NAMES.boss}: ${genus}` : MIGRATION_NAMES[archetype];
    migrations.push({
      id: `m${String(w).padStart(2, "0")}`,
      name,
      groups: [{ invader: id, count: percentOf(over.count ?? a.count, t.countPercent), spacing: a.spacing }],
      clearBonus: clearBonus(w),
    });
  });
  return { invaders, migrations };
}

// --------------------------------------------------------------- valley

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

// -------------------------------------------------------------- content

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of list) {
    if (out[item.id]) throw new Error(`duplicate id ${item.id}`);
    out[item.id] = item;
  }
  return out;
}

/**
 * The fossil award on a finished run: eggs kept, migrations cleared and
 * meat unspent, each worth a flat amount. Migrations cleared dominates
 * (fifty of them, each worth as much as ten eggs) because it is the
 * number that tracks skill; eggs and leftover meat round out a loss so a
 * wipe on migration one is never worth zero.
 */
const FOSSIL_WEIGHTS = {
  perEggKept: 2,
  perMigrationCleared: 20,
  perMeatUnspent: 1,
};

/** eggsLeft, migrationsCleared and meatUnspent are all >= 0; so is the result. */
export function fossilAward(
  weights: { readonly perEggKept: number; readonly perMigrationCleared: number; readonly perMeatUnspent: number },
  result: { readonly eggsLeft: number; readonly migrationsCleared: number; readonly meatUnspent: number },
): number {
  return Math.round(
    result.eggsLeft * weights.perEggKept + result.migrationsCleared * weights.perMigrationCleared + result.meatUnspent * weights.perMeatUnspent,
  );
}

/**
 * The content-version generation, bumped when a sim-visible number changes
 * (section 1.5 of `docs/01-v1-architecture.md`). This change is one of
 * those: easy's build phase went from 30s to 35s, so m2.0 runs stop
 * resuming, which is the designed cost of the rule.
 *
 * The difficulty is part of the version string on purpose. `loadSave`
 * compares `run.contentVersion` with `content.version` using `===`, so a
 * resume handed the wrong difficulty's `Content` *drops the run* instead of
 * quietly replaying it at numbers the player never played. That makes the
 * determinism guarantee mechanical rather than a thing the shell has to
 * remember.
 */
const VERSION_GENERATION = "m3.0";

function buildContent(difficulty: Difficulty): Content {
  const t = DIFFICULTY_TUNING[difficulty];
  const generated = buildInvadersAndMigrations(t);
  return {
    version: `${VERSION_GENERATION}-${difficulty}`,
    difficulty,
    rules: {
      startingMeat: 60,
      eggs: 20,
      buildPhaseTicks: t.buildPhaseSeconds * TICKS_PER_SECOND,
      earlyBonusPerSecond: 1,
      sellRefundBuildPercent: 80,
      sellRefundMigrationPercent: 60,
      fossilWeights: FOSSIL_WEIGHTS,
    },
    dinos: byId(dinoList),
    invaders: generated.invaders,
    migrations: generated.migrations,
    valley,
  };
}

/**
 * Built once each, eagerly, so `contentFor(d)` is referentially stable:
 * `Game` holds the `Content` it was constructed with for the life of a
 * run, and two calls returning two equal-but-distinct objects would be a
 * trap waiting for the first identity comparison.
 */
const BY_DIFFICULTY: Readonly<Record<Difficulty, Content>> = {
  easy: buildContent("easy"),
  medium: buildContent("medium"),
  hard: buildContent("hard"),
};

/**
 * The content for a difficulty. This is the only way to get a `Content`,
 * and a run is `(seed, this Content, command log)` — difficulty is not a
 * fourth input to the sim, it is which of these three it was handed.
 */
export function contentFor(difficulty: Difficulty): Content {
  return BY_DIFFICULTY[difficulty];
}

/** All three, ascending by difficulty. For a menu, and for a test to sweep. */
export const allContent: readonly Content[] = DIFFICULTIES.map(contentFor);

/**
 * The default difficulty's content, for a call site that has no run to
 * read a difficulty from: the art tools, a fixture, a module that only
 * wants the dinosaur table. **A call site that starts or resumes a run
 * must use `contentFor(difficulty)`** — the run's own difficulty, from the
 * menu or from the save — never this.
 */
export const content: Content = contentFor(DEFAULT_DIFFICULTY);

/** The stage-1 dinosaurs the player can buy, in palette order. */
export const hatchlings: readonly DinoDef[] = dinoList.filter((d) => d.stage === 1);
