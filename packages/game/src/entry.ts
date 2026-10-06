/**
 * §5.3's entry contract: how a caller says which way it is going into
 * `board`.
 *
 * There are three ways in, and what separates them is only where the seed
 * comes from — a fresh run (`title`'s New run, and the mount until `title`
 * lands), a resume of the saved run (`title`'s Continue), and *again* on
 * the seed just played (`results`' Again, and the pause menu's Restart
 * run). Phaser hands `init(data)` whatever `scene.start("board", data)`
 * passed, so the intent is **data on the transition, not state on the
 * scene**: `BoardScene` used to infer it from an instance field that
 * survived the previous `create()`, which answers "is this my first
 * create()" when the question is "where does the seed come from" — §5.2's
 * mistake in a different field.
 *
 * What this changes for a caller: **`fresh` and `again` do not read the
 * document's run.** Nothing has to null `doc.run` before entering `board`
 * to avoid resuming by accident, which until now was a convention that
 * every producer had to keep, each with its own comment explaining why its
 * statement order mattered. `title`'s New run is the case that would have
 * broken it, because it sits on top of exactly the save it must not
 * resume.
 */
export type BoardEntry =
  /** A new run on a new seed, from `MountOptions.nextSeed`. */
  | { readonly mode: "fresh" }
  /**
   * The run in the save document — or a fresh one if it has none, which
   * §1.5's dropped run is an honest way to arrive at.
   */
  | { readonly mode: "resume" }
  /** §5.3's `again (same seed)`: this seed, from tick 0. */
  | { readonly mode: "again"; readonly seed: number };

/** A new run. Named so that a call site reads as the transition it is. */
export const FRESH: BoardEntry = { mode: "fresh" };

/** The saved run. Only the first entry of a mount can mean anything by it. */
export const RESUME: BoardEntry = { mode: "resume" };

/** The seed just played, again. The seed rides the transition. */
export function again(seed: number): BoardEntry {
  return { mode: "again", seed };
}

/**
 * Narrows whatever Phaser handed `init()`, and throws on anything else.
 *
 * The throw is the point: it is what §5.3's "third producer" hazard gets
 * instead of a silently wrong run. Phaser keeps `settings.data` from the
 * previous start, so a caller that passes nothing does not arrive here as
 * `undefined` — it arrives as the *last* caller's data, which on the path
 * that matters is a mid-run `resume`. `BoardScene.init` therefore clears
 * the data after reading it, which turns a bare `scene.start("board")`
 * into the `{}` this rejects. A board that throws at the transition is a
 * bug somebody finds in the first drive; a board that resumes a run the
 * player did not ask for is a bug that looks like the save system.
 */
export function boardEntry(data: unknown): BoardEntry {
  const mode = (data as { mode?: unknown } | null | undefined)?.mode;
  if (mode === "fresh") return FRESH;
  if (mode === "resume") return RESUME;
  if (mode === "again") {
    const seed = (data as { seed?: unknown }).seed;
    // `Rng` takes an unsigned 32-bit integer and the whole run is
    // reproduced from it (§1.2), so a number that is not one is not a seed.
    if (typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) return again(seed);
    throw new TypeError(`board: "again" needs the seed to play again, got ${JSON.stringify(seed)}`);
  }
  throw new TypeError(`board: every entry says which way it is (§5.3). Expected { mode: "fresh" | "resume" | "again" }, got ${JSON.stringify(data)}`);
}
