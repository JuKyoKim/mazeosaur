import { replay, type Content, type Game, type RunSave } from "@mazeosaur/sim";

/**
 * The Game for this create()'s run. `resumed` is `LoadOutcome.resumed`
 * (or null on a shell that lost it): the Game the mount-time load's own
 * replay already built, at `run.tick`. Reusing it is the whole point of
 * this function -- `replay` runs the same log again, 452 ms of blocked
 * main thread at full run length (docs/01-v1-architecture.md §1.4) -- so
 * it is the fallback, not the first choice, for a `resumed` that is null
 * when `run` says it should not be.
 *
 * No Phaser import here on purpose: it is what lets this decision be
 * tested directly, since BoardScene itself cannot be constructed outside
 * a running Phaser.Game.
 */
export function gameForRun(content: Content, run: RunSave, resumed: Game | null): Game {
  return resumed ?? replay(content, run);
}
