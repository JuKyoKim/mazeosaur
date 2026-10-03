import type { Content } from "./content-types.js";
import { Game, type Command, type LoggedCommand } from "./game.js";
import { SAVE_MIGRATIONS, type SaveMigration } from "./save-migrations.js";

export const SAVE_FORMAT = "mazeosaur.save";

/** 1 + SAVE_MIGRATIONS.length. A test asserts that. */
export const SAVE_VERSION = 1;

export interface BuildStamp {
  /**
   * The commit the build was made from: 40 lowercase hex, or "dev" for a
   * build nobody stamped (`npm run dev`, a test, a local `npm run build`).
   */
  readonly commit: string;
  /** Which shell wrote it. */
  readonly platform: "web" | "ios" | "android" | "node";
}

export interface BestRunSave {
  /** Highest migration index cleared. */
  readonly migrationsCleared: number;
  readonly eggsLeft: number;
  readonly fossils: number;
  /** The seed, so the run can be replayed or shared. */
  readonly seed: number;
  /** The content version it was played against, so the table can say so. */
  readonly contentVersion: string;
}

export interface ProfileSave {
  /** Fossils ever earned. Monotonic; unlocks never subtract from it. */
  readonly fossilsEarned: number;
  /** Fossils spent on unlocks. The balance is earned - spent, derived, never stored. */
  readonly fossilsSpent: number;
  /** Unlocked dinosaur kinds as content kind ids, ascending, no duplicates. */
  readonly unlockedKinds: readonly string[];
  /** Best *finished* run per valley id. A valley with no finished run is absent. */
  readonly best: { readonly [valleyId: string]: BestRunSave };
  readonly runsStarted: number;
  readonly runsFinished: number;
}

export interface SettingsSave {
  /** 0..100, integers. Integers because tests compare them for equality. */
  readonly musicVolume: number;
  readonly sfxVolume: number;
  /** The speed a migration starts at. */
  readonly speed: 1 | 2 | 3;
  /** Draw range rings on the selected dinosaur. */
  readonly showRanges: boolean;
  /** Haptics on placement. Mobile only; the web shell ignores it. */
  readonly haptics: boolean;
}

export interface RunSave {
  /** Valley id from @mazeosaur/content. */
  readonly valleyId: string;
  /** The sim seed. Unsigned 32-bit integer; `Rng` takes exactly this. */
  readonly seed: number;
  /** content.version when the run *started*. Exact match required to resume. */
  readonly contentVersion: string;
  /** The build the run started under. Diagnostic only; a resume on a different build is allowed. */
  readonly startedBy: BuildStamp;
  /** Every accepted command, ascending by tick. This is also the replay. */
  readonly log: readonly LoggedCommand[];
  /** The tick reached when this was written. >= the last log entry's tick. */
  readonly tick: number;
  /** Game.hash() after replaying to `tick`. An integrity check, not a secret. */
  readonly hash: number;
  /**
   * Milliseconds of wall clock the run has taken, for the results screen.
   * The shell accumulates it; it is never an input to the sim, and the
   * sim never reads it. It is the only field here that touches a clock.
   */
  readonly playedMs: number;
}

export interface SaveDocument {
  /** Discriminator, so a stray JSON file is rejected rather than coerced. */
  readonly format: typeof SAVE_FORMAT;
  /** Save-format version. Integer, >= 1. Not the build version. */
  readonly version: number;
  /** The build that last wrote this document. Diagnostic; never an input. */
  readonly writtenBy: BuildStamp;
  readonly profile: ProfileSave;
  readonly settings: SettingsSave;
  /** The run in progress, or null when there is nothing to resume. */
  readonly run: RunSave | null;
}

export type LoadFailure = "not-a-save" | "from-the-future" | "corrupt";
export type RunDropReason = "content-version" | "replay-diverged";

export type LoadOutcome =
  | {
      readonly ok: true;
      readonly doc: SaveDocument;
      /** The version it arrived as, when migrations ran. */
      readonly migratedFrom: number | null;
      readonly runDropped: RunDropReason | null;
    }
  | { readonly ok: false; readonly reason: LoadFailure };

/** Raised by `replay` when the log, the hash, or the tick don't agree with each other. */
export class ReplayDivergedError extends Error {}

/**
 * Replays `run.log` from `run.seed` up to `run.tick` and checks the result
 * against `run.hash`. Throws `ReplayDivergedError` rather than returning a
 * half-trusted `Game`: the log holds only commands the sim already
 * accepted once, so any disagreement here means the content, the sim, or
 * the file changed underneath it.
 */
export function replay(content: Content, run: RunSave): Game {
  const game = new Game(content, run.seed);
  let i = 0;
  for (;;) {
    while (i < run.log.length && run.log[i]?.tick === game.state.tick) {
      const command = run.log[i] as LoggedCommand;
      const refusal = game.apply(command.command);
      if (refusal !== null) {
        throw new ReplayDivergedError(`command at tick ${game.state.tick} was refused on replay: ${refusal}`);
      }
      i++;
    }
    if (game.state.tick === run.tick) break;
    if (game.state.phase === "won" || game.state.phase === "lost") {
      throw new ReplayDivergedError(`the game ended at tick ${game.state.tick}, before the saved tick ${run.tick}`);
    }
    game.tick();
  }
  if (i !== run.log.length) {
    throw new ReplayDivergedError("the log has commands stamped after the saved tick");
  }
  if (game.hash() !== run.hash) {
    throw new ReplayDivergedError("the replayed hash does not match the saved hash");
  }
  return game;
}

export function freshSave(build: BuildStamp): SaveDocument {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    writtenBy: build,
    profile: {
      fossilsEarned: 0,
      fossilsSpent: 0,
      unlockedKinds: [],
      best: {},
      runsStarted: 0,
      runsFinished: 0,
    },
    settings: {
      musicVolume: 100,
      sfxVolume: 100,
      speed: 1,
      showRanges: true,
      haptics: true,
    },
    run: null,
  };
}

/**
 * Runs every migration whose `to` is above `from`, in ascending order.
 * Exported so the dispatch loop is unit-testable on its own, separately
 * from whatever `SAVE_MIGRATIONS` happens to contain.
 */
export function runMigrations(doc: Record<string, unknown>, migrations: readonly SaveMigration[], from: number): Record<string, unknown> {
  let working = doc;
  for (const migration of migrations) {
    if (migration.to > from) working = migration.up(working);
  }
  return working;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isBuildStamp(x: unknown): x is BuildStamp {
  if (!isRecord(x)) return false;
  return typeof x.commit === "string" && (x.platform === "web" || x.platform === "ios" || x.platform === "android" || x.platform === "node");
}

/**
 * `writtenBy` and `run.startedBy` are diagnostics, not correctness inputs
 * (section 1.2 of docs/01-v1-architecture.md), so a missing or malformed
 * one is repaired rather than treated as corruption.
 */
function repairedBuildStamp(x: unknown, platform: BuildStamp["platform"]): BuildStamp {
  return isBuildStamp(x) ? x : { commit: "unknown", platform };
}

function isBestRunSave(x: unknown): x is BestRunSave {
  if (!isRecord(x)) return false;
  return (
    isFiniteNumber(x.migrationsCleared) &&
    isFiniteNumber(x.eggsLeft) &&
    isFiniteNumber(x.fossils) &&
    isFiniteNumber(x.seed) &&
    typeof x.contentVersion === "string"
  );
}

function isProfileSave(x: unknown): x is ProfileSave {
  if (!isRecord(x)) return false;
  if (!isFiniteNumber(x.fossilsEarned) || !isFiniteNumber(x.fossilsSpent)) return false;
  if (!Array.isArray(x.unlockedKinds) || !x.unlockedKinds.every((k) => typeof k === "string")) return false;
  if (!isRecord(x.best)) return false;
  if (!Object.values(x.best).every(isBestRunSave)) return false;
  return isFiniteNumber(x.runsStarted) && isFiniteNumber(x.runsFinished);
}

function isSettingsSave(x: unknown): x is SettingsSave {
  if (!isRecord(x)) return false;
  return (
    isFiniteNumber(x.musicVolume) &&
    isFiniteNumber(x.sfxVolume) &&
    (x.speed === 1 || x.speed === 2 || x.speed === 3) &&
    typeof x.showRanges === "boolean" &&
    typeof x.haptics === "boolean"
  );
}

/**
 * Keyed by every member of the `Command` union, so a variant added to
 * `Command` without a line here is a `tsc` error rather than a silent drop
 * into `corrupt` (profile included) the next time that command shows up in
 * a saved log.
 */
const COMMAND_TYPES: Record<Command["type"], true> = {
  place: true,
  sell: true,
  grow: true,
  send: true,
};

function isLoggedCommand(x: unknown): x is LoggedCommand {
  if (!isRecord(x) || !isFiniteNumber(x.tick) || !isRecord(x.command)) return false;
  const c = x.command;
  if (typeof c.type !== "string" || !(c.type in COMMAND_TYPES)) return false;
  switch (c.type) {
    case "place":
      return typeof c.defId === "string" && isFiniteNumber(c.x) && isFiniteNumber(c.y);
    case "sell":
    case "grow":
      return isFiniteNumber(c.dinoId);
    case "send":
      return true;
    default:
      return false;
  }
}

function narrowRunSave(x: unknown, platform: BuildStamp["platform"]): RunSave | null {
  if (!isRecord(x)) return null;
  if (typeof x.valleyId !== "string") return null;
  if (!isFiniteNumber(x.seed)) return null;
  if (typeof x.contentVersion !== "string") return null;
  if (!Array.isArray(x.log) || !x.log.every(isLoggedCommand)) return null;
  if (!isFiniteNumber(x.tick)) return null;
  if (!isFiniteNumber(x.hash)) return null;
  if (!isFiniteNumber(x.playedMs)) return null;
  return {
    valleyId: x.valleyId,
    seed: x.seed,
    contentVersion: x.contentVersion,
    startedBy: repairedBuildStamp(x.startedBy, platform),
    log: x.log as LoggedCommand[],
    tick: x.tick,
    hash: x.hash,
    playedMs: x.playedMs,
  };
}

function narrowSaveDocument(x: Record<string, unknown>, platform: BuildStamp["platform"]): SaveDocument | null {
  if (!isProfileSave(x.profile) || !isSettingsSave(x.settings)) return null;
  let run: RunSave | null = null;
  if (x.run !== null && x.run !== undefined) {
    run = narrowRunSave(x.run, platform);
    if (run === null) return null;
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    writtenBy: repairedBuildStamp(x.writtenBy, platform),
    profile: x.profile,
    settings: x.settings,
    run,
  };
}

/**
 * Reads a raw JSON value into a `SaveDocument`, migrating and validating
 * it on the way. `platform` is the platform now running, used only to
 * repair a missing or malformed `writtenBy`/`startedBy` (section 1.4 of
 * docs/01-v1-architecture.md).
 */
export function loadSave(raw: unknown, content: Content, platform: BuildStamp["platform"]): LoadOutcome {
  if (!isRecord(raw)) return { ok: false, reason: "not-a-save" };
  if (raw.format !== SAVE_FORMAT) return { ok: false, reason: "not-a-save" };
  if (!isFiniteNumber(raw.version) || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, reason: "not-a-save" };
  }
  const version = raw.version;
  if (version > SAVE_VERSION) return { ok: false, reason: "from-the-future" };

  const migratedFrom = version < SAVE_VERSION ? version : null;
  const migrated = version < SAVE_VERSION ? runMigrations(raw, SAVE_MIGRATIONS, version) : raw;

  const narrowed = narrowSaveDocument(migrated, platform);
  if (narrowed === null) return { ok: false, reason: "corrupt" };

  let doc = narrowed;
  let runDropped: RunDropReason | null = null;
  if (doc.run !== null) {
    if (doc.run.contentVersion !== content.version) {
      doc = { ...doc, run: null };
      runDropped = "content-version";
    } else {
      try {
        replay(content, doc.run);
      } catch (e) {
        if (!(e instanceof ReplayDivergedError)) throw e;
        doc = { ...doc, run: null };
        runDropped = "replay-diverged";
      }
    }
  }

  return { ok: true, doc, migratedFrom, runDropped };
}
