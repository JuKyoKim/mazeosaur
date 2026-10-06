import type { BestRunSave, FossilWeights, ProfileSave } from "@mazeosaur/sim";
import { fossilAward } from "@mazeosaur/content";

/**
 * Pure profile accounting, kept out of `BoardScene` so it can be unit
 * tested without Phaser: the scene only supplies the numbers a run ended
 * with, never the formula (rule 4 — the weight table lives in
 * `@mazeosaur/content`, not here and not in the sim).
 */

/** A run began with nothing to resume. §1.2's `runsStarted`; no formula. */
export function runStarted(profile: ProfileSave): ProfileSave {
  return { ...profile, runsStarted: profile.runsStarted + 1 };
}

export interface RunOutcome {
  readonly valleyId: string;
  readonly seed: number;
  readonly contentVersion: string;
  /** How many migrations the run cleared. A win is content.migrations.length. */
  readonly migrationsCleared: number;
  readonly eggsLeft: number;
  readonly meatUnspent: number;
}

function isBetter(candidate: BestRunSave, existing: BestRunSave | undefined): boolean {
  if (!existing) return true;
  if (candidate.migrationsCleared !== existing.migrationsCleared) return candidate.migrationsCleared > existing.migrationsCleared;
  return candidate.fossils > existing.fossils;
}

/**
 * The result of accounting a finished run: the next profile, and what that
 * run earned.
 *
 * The award is returned rather than left inside because `results` has to
 * show the same figure that was banked. Section 5.4 of
 * `docs/01-v1-architecture.md` rules out the obvious alternative — a second
 * `fossilAward` call on the summary's own numbers — since two call sites on
 * the same inputs are two things to keep in step, and a player shown one
 * figure and credited another cannot tell which of the two is wrong.
 */
export interface RunFinish {
  readonly profile: ProfileSave;
  /** This run's award alone, not `profile.fossilsEarned`'s lifetime total. */
  readonly fossilsAwarded: number;
}

/**
 * A run ended won or lost: §1.2's `runsFinished`, the fossil award (read
 * from `weights`, never a constant here), and `profile.best` for the
 * valley the run was played in.
 *
 * `fossilsEarned` is monotonic (§1.2), so `fossilsEarned - fossilsSpent`
 * can never go negative; thrown rather than silently clamped, because a
 * negative balance here means the award or the save itself is wrong, not
 * that there is a sensible fallback value.
 */
export function runFinished(profile: ProfileSave, weights: FossilWeights, outcome: RunOutcome): RunFinish {
  const award = fossilAward(weights, {
    eggsLeft: outcome.eggsLeft,
    migrationsCleared: outcome.migrationsCleared,
    meatUnspent: outcome.meatUnspent,
  });
  const fossilsEarned = profile.fossilsEarned + award;
  if (fossilsEarned - profile.fossilsSpent < 0) {
    throw new Error(`fossil balance would go negative: earned ${fossilsEarned}, spent ${profile.fossilsSpent}`);
  }
  const candidate: BestRunSave = {
    migrationsCleared: outcome.migrationsCleared,
    eggsLeft: outcome.eggsLeft,
    fossils: award,
    seed: outcome.seed,
    contentVersion: outcome.contentVersion,
  };
  const best = isBetter(candidate, profile.best[outcome.valleyId]) ? { ...profile.best, [outcome.valleyId]: candidate } : profile.best;
  return {
    profile: { ...profile, fossilsEarned, runsFinished: profile.runsFinished + 1, best },
    fossilsAwarded: award,
  };
}
