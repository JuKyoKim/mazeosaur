import type { Point } from "./grid.js";
import type { Lane } from "./lane.js";

/**
 * The shapes the simulation consumes. The data itself lives in
 * @mazeosaur/content; the sim never imports it, so a headless test can
 * hand in a three-line fixture and a balance harness can mutate numbers.
 *
 * Units: distances in milli-cells (1000 per cell), time in ticks
 * (TICKS_PER_SECOND per second), damage and meat as integers.
 */

export const TICKS_PER_SECOND = 20;
export const CELL = 1000;

/**
 * The three difficulties. The *names* are here; the *numbers* are not.
 * No rule in this package branches on a difficulty, and nothing in here
 * knows that hard has tankier invaders: a difficulty selects which
 * `Content` the shell hands in (`contentFor` in @mazeosaur/content), so a
 * run is still exactly (seed, content, command log) and there is no
 * difficulty switch anywhere in the simulation — rule 4 holds.
 *
 * The type lives here anyway because the save format does: a resumed run
 * has to say which difficulty it was played at, and `narrowRunSave` can
 * only check that exhaustively against a closed union. `SettingsSave.speed`
 * is here for the same reason.
 */
export type Difficulty = "easy" | "medium" | "hard";

/** Ascending by how hard it is: menu order, and the order a test iterates. */
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/** For the save narrower and for a shell reading a difficulty off a URL. */
export function isDifficulty(x: unknown): x is Difficulty {
  return x === "easy" || x === "medium" || x === "hard";
}

export type Kind = "tyrant" | "longneck" | "horned" | "raptor" | "flier" | "armored";

/** The kind chart is one cycle: each kind beats the next and is weak to the previous. */
export const KIND_CYCLE: readonly Kind[] = ["tyrant", "longneck", "horned", "raptor", "flier", "armored"];

/** Damage multiplier in percent: 200 / 100 / 50. */
export function kindMultiplier(attacker: Kind, defender: Kind): number {
  const a = KIND_CYCLE.indexOf(attacker);
  const d = KIND_CYCLE.indexOf(defender);
  const n = KIND_CYCLE.length;
  if ((a + 1) % n === d) return 200;
  if ((d + 1) % n === a) return 50;
  return 100;
}

export type Stage = 1 | 2 | 3;
export type Targets = "ground" | "air" | "both";

export interface DinoDef {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly stage: Stage;
  /** meat to place a stage-1 hatchling, or to grow into this stage */
  readonly cost: number;
  readonly range: number;
  readonly damage: number;
  /** ticks between attacks */
  readonly cooldown: number;
  readonly targets: Targets;
  /** milli-cell radius; every invader within it of the target takes full damage */
  readonly splash?: number;
  readonly slow?: { readonly percent: number; readonly ticks: number };
  /** the target cannot move for this many ticks */
  readonly stun?: { readonly ticks: number };
  /** attack this many invaders per cooldown (default 1) */
  readonly targetCount?: number;
  readonly growsTo?: string;
}

export type Archetype = "normal" | "fast" | "tank" | "flying" | "swarm" | "splitter" | "regenerator" | "shielded" | "boss";

export interface InvaderDef {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly archetype: Archetype;
  readonly hp: number;
  /** milli-cells per tick */
  readonly speed: number;
  readonly flying: boolean;
  readonly bounty: number;
  /** eggs eaten on a leak */
  readonly eggs: number;
  /** hp restored per second, applied once a second */
  readonly regen?: number;
  /** attacks absorbed before any damage or effect lands */
  readonly shield?: number;
  /** on death, spawn these where it died */
  readonly splitsInto?: { readonly invader: string; readonly count: number };
}

export interface MigrationGroup {
  readonly invader: string;
  readonly count: number;
  readonly spacing: number;
}

export interface MigrationDef {
  readonly id: string;
  readonly name: string;
  readonly groups: readonly MigrationGroup[];
  readonly clearBonus: number;
}

export interface ValleyDef {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly lane: Lane;
  /** cells that can never be built on and never walked through */
  readonly rock: readonly Point[];
}

/**
 * Weights for the fossil award a finished run pays out. The formula
 * (eggs kept, migrations cleared, meat unspent) is balance, so only the
 * weights live here; the arithmetic that applies them lives next to them
 * in `@mazeosaur/content`, never as a number in the sim or in
 * `packages/game` — rule 4.
 */
export interface FossilWeights {
  readonly perEggKept: number;
  readonly perMigrationCleared: number;
  readonly perMeatUnspent: number;
}

export interface Rules {
  readonly startingMeat: number;
  readonly eggs: number;
  readonly buildPhaseTicks: number;
  /** meat per whole second left on the timer when the player sends early */
  readonly earlyBonusPerSecond: number;
  readonly sellRefundBuildPercent: number;
  readonly sellRefundMigrationPercent: number;
  readonly fossilWeights: FossilWeights;
}

export interface Content {
  readonly version: string;
  /**
   * Which difficulty's numbers these are. A label, never an input: the sim
   * reads this field nowhere, and a HUD that wants to print "Hard" reads it
   * here rather than parsing it back out of `version`.
   */
  readonly difficulty: Difficulty;
  readonly rules: Rules;
  readonly dinos: Readonly<Record<string, DinoDef>>;
  readonly invaders: Readonly<Record<string, InvaderDef>>;
  readonly migrations: readonly MigrationDef[];
  readonly valley: ValleyDef;
}
