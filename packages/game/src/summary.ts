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
  readonly outcome: Outcome;
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
  /**
   * What this run earned. Computed once, where it was awarded — §5.4. This
   * run's award only, not `profile.fossilsEarned`'s running total. Always 0
   * on an `abandoned` run, because nothing pays one; see `Outcome`.
   */
  readonly fossilsAwarded: number;
  /** So the run can be reproduced with `?seed=`. */
  readonly seed: number;
  readonly pack: readonly PackEntry[];
}

/**
 * How a run ended. `abandoned` is the player's own "End run" from the
 * pause menu, and it is a third value rather than a flag beside `outcome`
 * or a reuse of `lost`: quitting is a distinct terminal event, and a save
 * or a replay should be able to tell a run that was beaten from one that
 * was walked out of.
 *
 * It is **not** a *finished* run. `BoardScene.flush()` tests only the
 * `won` and `lost` phases before paying the fossil award, so an abandoned
 * run earns 0 and leaves `profile.runsFinished` alone — otherwise "End
 * run" would be the optimal way to farm fossils.
 */
export type Outcome = "won" | "lost" | "abandoned";

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
 * `fossilsAwarded` is passed in rather than computed here, and that is the
 * point of §5.4: the run is paid for in `board`, by the `fossilAward` call
 * inside `runFinished` that `flush()` makes at the terminal save. This
 * function hands that number to the screen; it never produces one. A
 * second `fossilAward` call on these same numbers would be a figure to
 * keep in step with the banked one for no gain — and the two drifting is
 * invisible to the player, who sees only one of them.
 */
export function runSummary(
  outcome: Outcome,
  state: { readonly migration: number; readonly eggs: number; readonly meat: number; readonly dinos: readonly Dino[] },
  dinoDef: (d: Dino) => DinoDef,
  seed: number,
  content: Content,
  fossilsAwarded: number,
): RunSummary {
  return {
    outcome,
    migrationsCleared: state.migration,
    migrationsTotal: content.migrations.length,
    eggsKept: state.eggs,
    meatUnspent: state.meat,
    fossilsAwarded,
    seed,
    pack: packFrom(state.dinos, dinoDef),
  };
}
