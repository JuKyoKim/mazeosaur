import { Grid, type Point } from "./grid.js";
import { computeFlowField, distanceAt, UNREACHABLE, type FlowField } from "./flowfield.js";

/**
 * A lane is the route creeps must complete: spawn, then every checkpoint in
 * order, then the exit. Checkpoints are what make a maul maze long: the
 * player builds the whole plot, and creeps have to snake through it
 * several times. None of these cells can ever hold a tower.
 */
export interface Lane {
  readonly spawn: Point;
  readonly checkpoints: readonly Point[];
  readonly exit: Point;
}

export function laneTargets(lane: Lane): readonly Point[] {
  return [...lane.checkpoints, lane.exit];
}

/** One flow field per leg: leg i leads to laneTargets(lane)[i]. */
export function computeLaneFields(grid: Grid, lane: Lane): FlowField[] {
  return laneTargets(lane).map((t) => computeFlowField(grid, t));
}

/**
 * True when every leg of the lane is walkable: spawn -> first checkpoint,
 * each checkpoint -> the next, last checkpoint -> exit.
 */
export function laneIsOpen(grid: Grid, lane: Lane, fields: readonly FlowField[] = computeLaneFields(grid, lane)): boolean {
  const legs = [lane.spawn, ...lane.checkpoints];
  for (let i = 0; i < legs.length; i++) {
    const field = fields[i];
    if (!field) return false;
    if (distanceAt(field, grid, legs[i] as Point) === UNREACHABLE) return false;
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
 */
export function buildRefusal(grid: Grid, lane: Lane, at: Point): BuildRefusal | null {
  if (!grid.inBounds(at.x, at.y)) return "out-of-bounds";
  if (grid.isBlocked(at.x, at.y)) return "occupied";
  if (samePoint(at, lane.spawn) || samePoint(at, lane.exit) || lane.checkpoints.some((c) => samePoint(c, at))) {
    return "lane-cell";
  }
  grid.setBlocked(at.x, at.y, true);
  try {
    return laneIsOpen(grid, lane) ? null : "would-block";
  } finally {
    grid.setBlocked(at.x, at.y, false);
  }
}
