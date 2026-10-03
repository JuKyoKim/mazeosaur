/**
 * A rewrite from one save-format version to the next. `up` takes a document
 * at version `to - 1` and returns one shaped like version `to`; it must not
 * assume anything beyond "valid JSON object", because it is the thing that
 * makes that true.
 */
export interface SaveMigration {
  /** The version this entry produces. Entry at index n produces version n + 2. */
  readonly to: number;
  /** Why the format changed. One line; it is the changelog. */
  readonly because: string;
  /** Rewrite a document at version `to - 1` into one at version `to`. */
  readonly up: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Numbered, append-only, ascending by `to`. Never edit a landed entry:
 * somebody's phone holds a save that already went through it.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  // Version 1 is the first format. There is nothing to migrate from.
];
