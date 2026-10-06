import { fossilAward } from "@mazeosaur/content";
import type { Content, Dino, DinoDef, Kind } from "@mazeosaur/sim";

/**
 * What the results screen is given, and the whole of it.
 *
 * Section 5.1 of `docs/01-v1-architecture.md`: `results` owns the
 * end-of-run summary and **no** `Game`. This type is why that is
 * enforceable rather than merely intended — it is plain numbers and
 * strings, so a finished run cannot be resurrected by the screen that only
 * describes it. Building it here, outside the scene, is what keeps it
 * unit-testable without Phaser.
 */
export interface RunSummary {
  readonly outcome: "won" | "lost";
  /**
   * Migrations fully turned back. `state.migration` is the index of the
   * one in progress, which is exactly the count of the ones before it, so
   * a loss on the first migration is 0 cleared rather than 1. The same
   * number `flush()` hands `runFinished`, for the same reason.
   */
  readonly migrationsCleared: number;
  readonly migrationsTotal: number;
  readonly eggsKept: number;
  readonly meatUnspent: number;
  /** This run's award only, not the profile's running total. */
  readonly fossilsEarned: number;
  /** So the run can be reproduced with `?seed=`. */
  readonly seed: number;
  readonly pack: readonly PackEntry[];
}

/**
 * One genus in the pack row, with how many of it the player grew.
 *
 * Grouped rather than one entry per animal because the genus is the point
 * — section 9 of `docs/01-art-hud-and-audio.md` calls the row "the
 * collection, which is the reason the stages are real genus names", and
 * its own example is "three *Utahraptors* and one *Triceratops*". A count
 * says that in one line; four unlabelled blocks do not.
 */
export interface PackEntry {
  readonly defId: string;
  readonly name: string;
  readonly kind: Kind;
  readonly count: number;
}

/** Stage 3. The pack is what the player *grew*, not what they placed. */
const ADULT_STAGE = 3;

/**
 * The adults standing when the run ended, grouped by genus and ordered by
 * the first one grown.
 *
 * Insertion order, not alphabetical and not by count: the row then reads
 * in the order the player built it, which is the order they remember. A
 * `Map` keyed by `defId` gives that for free.
 */
export function packFrom(dinos: readonly Dino[], dinoDef: (d: Dino) => DinoDef): PackEntry[] {
  const byDef = new Map<string, PackEntry>();
  for (const d of dinos) {
    const def = dinoDef(d);
    if (def.stage !== ADULT_STAGE) continue;
    const seen = byDef.get(def.id);
    byDef.set(def.id, { defId: def.id, name: def.name, kind: def.kind, count: (seen?.count ?? 0) + 1 });
  }
  return [...byDef.values()];
}

/**
 * Build the summary for a run that has just ended.
 *
 * The fossil figure comes from `fossilAward` with `content.rules.
 * fossilWeights` — the same pure function on the same numbers that
 * `runFinished` uses when `flush()` accounts the finish, so the number on
 * screen cannot disagree with the number banked. It is not recomputed from
 * a formula here; rule 4 keeps the weights in content.
 */
export function runSummary(
  outcome: "won" | "lost",
  state: { readonly migration: number; readonly eggs: number; readonly meat: number; readonly dinos: readonly Dino[] },
  dinoDef: (d: Dino) => DinoDef,
  seed: number,
  content: Content,
): RunSummary {
  const migrationsCleared = state.migration;
  return {
    outcome,
    migrationsCleared,
    migrationsTotal: content.migrations.length,
    eggsKept: state.eggs,
    meatUnspent: state.meat,
    fossilsEarned: fossilAward(content.rules.fossilWeights, {
      eggsLeft: state.eggs,
      migrationsCleared,
      meatUnspent: state.meat,
    }),
    seed,
    pack: packFrom(state.dinos, dinoDef),
  };
}
