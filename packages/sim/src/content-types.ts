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
  readonly growsTo?: string;
}

export interface InvaderDef {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly hp: number;
  /** milli-cells per tick */
  readonly speed: number;
  readonly flying: boolean;
  readonly bounty: number;
  /** eggs eaten on a leak */
  readonly eggs: number;
  readonly boss?: boolean;
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

export interface Rules {
  readonly startingMeat: number;
  readonly eggs: number;
  readonly buildPhaseTicks: number;
  /** meat per whole second left on the timer when the player sends early */
  readonly earlyBonusPerSecond: number;
  readonly sellRefundBuildPercent: number;
  readonly sellRefundMigrationPercent: number;
}

export interface Content {
  readonly version: string;
  readonly rules: Rules;
  readonly dinos: Readonly<Record<string, DinoDef>>;
  readonly invaders: Readonly<Record<string, InvaderDef>>;
  readonly migrations: readonly MigrationDef[];
  readonly valley: ValleyDef;
}
