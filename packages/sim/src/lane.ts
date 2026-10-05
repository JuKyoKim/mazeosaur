import { Grid, type Point } from "./grid.js";
import { computeFlowField, distanceAt, DIRS8, UNREACHABLE, type FlowField } from "./flowfield.js";

/**
 * A lane is the route creeps must complete: spawn, then every checkpoint in
 * order, then the exit. Checkpoints are what make a maul maze long: the
 * player builds the whole plot, and creeps have to snake through it
 * several times.
 *
 * The spawn and the exit are reserved cells and nothing can ever be built on
 * them. **Checkpoints are buildable** — a checkpoint is a routing waypoint and
 * nothing else, so a dinosaur may stand on one and the leg that ends there
 * ends on its neighbours instead. See `legTargetCells`.
 */
export interface Lane {
  readonly spawn: Point;
  readonly checkpoints: readonly Point[];
  readonly exit: Point;
}

/**
 * Each leg's waypoint, in order: every checkpoint, then the exit. These are
 * the cells the board marks for the player; the cells that actually *end* a
 * leg are `legTargetCells`, which is not the same list once a dinosaur is
 * standing on a checkpoint.
 */
export function laneTargets(lane: Lane): readonly Point[] {
  return [...lane.checkpoints, lane.exit];
}

/** How many legs the lane has: one per checkpoint, plus the run to the exit. */
export function legCount(lane: Lane): number {
  return lane.checkpoints.length + 1;
}

/**
 * The cells that *end* leg `leg` — the cells at distance zero on its field, so
 * a creep standing on any of them is handed to the next leg.
 *
 * The spawn and the exit are single cells and stay so: invaders appear on the
 * spawn and arrive at the exit, so neither can hold a dinosaur without the
 * fiction breaking, and blocking either would make the lane closed by
 * definition. A checkpoint carries no such weight. So:
 *
 * - an **open** checkpoint is the one target, which is exactly the field the
 *   sim built before checkpoints were buildable. Nothing about the route
 *   changes until somebody actually builds on one.
 * - an **occupied** checkpoint hands the leg to its open eight-neighbours. The
 *   leg then ends one cell short of the waypoint and the rest of the route is
 *   untouched, which is the "mobs still follow that general pathing" the
 *   checkpoint exists for.
 *
 * The set cannot go empty without being caught: a build that would block a
 * checkpoint *and* all of its neighbours leaves this leg's field entirely
 * UNREACHABLE, which `laneIsOpen` reads as closed and `buildRefusal` reports
 * as "would-block" from the same exact test it uses for every other seal.
 *
 * The neighbour set is a superset of the cut around the checkpoint — every
 * path to the checkpoint arrives from one of its neighbours — so building on a
 * checkpoint can never strand an invader that could previously reach it.
 */
export function legTargetCells(grid: Grid, lane: Lane, leg: number): readonly Point[] {
  const checkpoint = lane.checkpoints[leg];
  if (!checkpoint) return [lane.exit];
  if (!grid.isBlocked(checkpoint.x, checkpoint.y)) return [checkpoint];
  const open: Point[] = [];
  for (const d of DIRS8) {
    const p = { x: checkpoint.x + d.x, y: checkpoint.y + d.y };
    if (!grid.isBlocked(p.x, p.y)) open.push(p);
  }
  return open;
}

/** One flow field per leg: leg i leads to legTargetCells(grid, lane, i). */
export function computeLaneFields(grid: Grid, lane: Lane): FlowField[] {
  const fields: FlowField[] = [];
  for (let leg = 0; leg < legCount(lane); leg++) {
    fields.push(computeFlowField(grid, legTargetCells(grid, lane, leg)));
  }
  return fields;
}

/**
 * True when every leg of the lane is walkable: spawn -> first checkpoint,
 * each checkpoint -> the next, last checkpoint -> exit.
 *
 * A leg is walkable when *every* cell a creep can be standing on as the leg
 * begins reaches that leg's targets — the spawn for leg 0, and the previous
 * leg's target cells after that. Every cell of that set and not just the one a
 * creep happens to arrive on, because which one it arrives on depends on where
 * it came from, and a build lands while creeps are spread across the board. So
 * this is also the condition that no invader standing anywhere in an occupied
 * checkpoint's neighbourhood can be walled into a pocket: a stronger
 * guarantee than the single-cell check it replaces, not a looser one.
 *
 * The start set is never empty: it begins as the spawn, and an empty target
 * set makes its own leg's field entirely UNREACHABLE, so that leg returns
 * false before its targets are ever read as the next leg's starts.
 */
export function laneIsOpen(grid: Grid, lane: Lane, fields: readonly FlowField[] = computeLaneFields(grid, lane)): boolean {
  let starts: readonly Point[] = [lane.spawn];
  for (let leg = 0; leg < legCount(lane); leg++) {
    const field = fields[leg];
    if (!field) return false;
    for (const start of starts) {
      if (distanceAt(field, grid, start) === UNREACHABLE) return false;
    }
    starts = field.targets;
  }
  return true;
}

export type BuildRefusal = "out-of-bounds" | "occupied" | "lane-cell" | "would-block";

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Why a tower cannot be placed at `at`, or null if it can. The important
 * case is "would-block": WC3 mauls never let you seal the maze, and the
 * check must be exact, not a heuristic, or the player will find the gap.
 *
 * "lane-cell" covers the spawn and the exit only. A checkpoint is buildable;
 * what stops the player walling one in completely is the same would-block
 * test, because the leg's target cells go with it (`legTargetCells`).
 */
export function buildRefusal(grid: Grid, lane: Lane, at: Point): BuildRefusal | null {
  if (!grid.inBounds(at.x, at.y)) return "out-of-bounds";
  if (grid.isBlocked(at.x, at.y)) return "occupied";
  if (samePoint(at, lane.spawn) || samePoint(at, lane.exit)) return "lane-cell";
  grid.setBlocked(at.x, at.y, true);
  try {
    return laneIsOpen(grid, lane) ? null : "would-block";
  } finally {
    grid.setBlocked(at.x, at.y, false);
  }
}
