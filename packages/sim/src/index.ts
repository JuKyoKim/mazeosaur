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
  computeLaneFields,
  laneIsOpen,
  buildRefusal,
} from "./lane.js";
