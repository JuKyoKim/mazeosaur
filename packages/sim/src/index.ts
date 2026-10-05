// @mazeosaur/sim -- the deterministic, headless heart of the game.
//
// Rules for this package (enforced by review, and later by lint):
//   1. No DOM, no Phaser, no timers, no I/O, no Math.random.
//   2. Everything that affects gameplay takes a tick, a seed or a command.
//   3. State is plain data so it can be hashed, saved, diffed and replayed.
export { Rng } from "./rng.js";
export { Grid, type Point } from "./grid.js";
export {
  DIRS8,
  STEP_COST,
  DIAG_COST,
  UNREACHABLE,
  type FlowField,
  canStep,
  computeFlowField,
  distanceAt,
  nextStep,
} from "./flowfield.js";
export {
  type Lane,
  type BuildRefusal,
  laneTargets,
  legCount,
  legTargetCells,
  computeLaneFields,
  laneIsOpen,
  buildRefusal,
} from "./lane.js";
export {
  CELL,
  TICKS_PER_SECOND,
  KIND_CYCLE,
  kindMultiplier,
  type Kind,
  type Stage,
  type Archetype,
  type Targets,
  type DinoDef,
  type InvaderDef,
  type MigrationGroup,
  type MigrationDef,
  type ValleyDef,
  type FossilWeights,
  type Rules,
  type Content,
} from "./content-types.js";
export {
  Game,
  type Phase,
  type Dino,
  type Invader,
  type GameState,
  type Command,
  type Refusal,
  type GameEvent,
  type LoggedCommand,
} from "./game.js";
export {
  SAVE_FORMAT,
  SAVE_VERSION,
  ReplayDivergedError,
  replay,
  freshSave,
  loadSave,
  runMigrations,
  type BuildStamp,
  type BestRunSave,
  type ProfileSave,
  type SettingsSave,
  type RunSave,
  type SaveDocument,
  type LoadFailure,
  type RunDropReason,
  type LoadOutcome,
} from "./save.js";
export { type SaveMigration, SAVE_MIGRATIONS } from "./save-migrations.js";
