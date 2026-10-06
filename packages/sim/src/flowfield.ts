import { Grid, type Point } from "./grid.js";

/**
 * Eight movement directions. Diagonals are allowed but never through a
 * corner: a diagonal step requires both orthogonal neighbours to be open.
 * That is the WC3 feel: two towers touching at a corner make a wall.
 */
export const DIRS8: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Cost units: 10 per orthogonal step, 14 per diagonal (~sqrt 2). Integers keep the sim deterministic. */
export const STEP_COST = 10;
export const DIAG_COST = 14;

export const UNREACHABLE = -1;

/**
 * A flow field is the integer distance from every cell to the nearest of its
 * targets. Creeps do not store a path; each tick they step to the neighbour
 * with the lowest distance. Rebuilding the field after a build/sell is all it
 * takes for every creep to re-path, which is exactly what mazing needs.
 *
 * Nearly every field has one target. A lane leg that ends on an occupied
 * checkpoint has several (`legTargetCells` in `lane.ts`) and the creep is done
 * with the leg on whichever of them it reaches first, so all of them have to
 * sit at distance zero in one field. That is a multi-source Dijkstra; nothing
 * else about the field changes, and a single target behaves exactly as before.
 */
export interface FlowField {
  /** the cells at distance 0; empty only when every target cell is blocked */
  readonly targets: readonly Point[];
  /** distance per cell index, UNREACHABLE where no target can be reached */
  readonly dist: Int32Array;
}

export function canStep(grid: Grid, from: Point, dir: Point): boolean {
  const nx = from.x + dir.x;
  const ny = from.y + dir.y;
  if (grid.isBlocked(nx, ny)) return false;
  if (dir.x !== 0 && dir.y !== 0) {
    // no corner cutting
    if (grid.isBlocked(from.x + dir.x, from.y)) return false;
    if (grid.isBlocked(from.x, from.y + dir.y)) return false;
  }
  return true;
}

/**
 * Dijkstra from the target(s) outward. With two edge weights a plain binary
 * heap is fine; grids in this game are a few hundred cells to ~2000 cells,
 * so this runs in well under a millisecond.
 *
 * A blocked target is dropped rather than rejected: it has no distance of its
 * own and creeps cannot stand on it. Drop every target and the field is
 * entirely UNREACHABLE, which is what `laneIsOpen` reads as a sealed leg.
 */
export function computeFlowField(grid: Grid, target: Point | readonly Point[]): FlowField {
  const targets = Array.isArray(target) ? (target as readonly Point[]) : [target as Point];
  const dist = new Int32Array(grid.width * grid.height).fill(UNREACHABLE);

  const heap = new MinHeap();
  for (const t of targets) {
    // isBlocked is true out of bounds too, so this is also the bounds check.
    if (grid.isBlocked(t.x, t.y)) continue;
    const i = grid.index(t.x, t.y);
    if (dist[i] === 0) continue; // a duplicate target
    dist[i] = 0;
    heap.push(0, t.x, t.y);
  }

  while (heap.size > 0) {
    const [d, x, y] = heap.pop();
    const here = grid.index(x, y);
    if (d > (dist[here] as number)) continue; // stale entry
    const from = { x, y };
    for (const dir of DIRS8) {
      // We traverse from the target outward, so a step here is the reverse
      // of the creep's step. Corner-cutting is symmetric, so canStep works.
      if (!canStep(grid, from, dir)) continue;
      const nx = x + dir.x;
      const ny = y + dir.y;
      const ni = grid.index(nx, ny);
      const nd = d + (dir.x !== 0 && dir.y !== 0 ? DIAG_COST : STEP_COST);
      const cur = dist[ni] as number;
      if (cur === UNREACHABLE || nd < cur) {
        dist[ni] = nd;
        heap.push(nd, nx, ny);
      }
    }
  }
  return { targets, dist };
}

export function distanceAt(field: FlowField, grid: Grid, p: Point): number {
  if (!grid.inBounds(p.x, p.y)) return UNREACHABLE;
  return field.dist[grid.index(p.x, p.y)] as number;
}

/**
 * The next cell a creep at `from` should move to, or null if it is already on
 * a target or no target is reachable. Ties break in DIRS8 order so every
 * client makes the same choice.
 */
export function nextStep(field: FlowField, grid: Grid, from: Point): Point | null {
  const here = distanceAt(field, grid, from);
  if (here <= 0) return null;
  let best: Point | null = null;
  let bestD = here;
  for (const dir of DIRS8) {
    if (!canStep(grid, from, dir)) continue;
    const n = { x: from.x + dir.x, y: from.y + dir.y };
    const d = distanceAt(field, grid, n);
    if (d !== UNREACHABLE && d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** Minimal binary heap keyed on distance; entries are (d, x, y). */
class MinHeap {
  private d: number[] = [];
  private x: number[] = [];
  private y: number[] = [];

  get size(): number {
    return this.d.length;
  }

  push(d: number, x: number, y: number): void {
    this.d.push(d);
    this.x.push(x);
    this.y.push(y);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.d[p] as number) <= (this.d[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number, number] {
    const out: [number, number, number] = [this.d[0] as number, this.x[0] as number, this.y[0] as number];
    const last = this.d.length - 1;
    this.swap(0, last);
    this.d.pop();
    this.x.pop();
    this.y.pop();
    let i = 0;
    const n = this.d.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && (this.d[l] as number) < (this.d[m] as number)) m = l;
      if (r < n && (this.d[r] as number) < (this.d[m] as number)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return out;
  }

  private swap(a: number, b: number): void {
    [this.d[a], this.d[b]] = [this.d[b] as number, this.d[a] as number];
    [this.x[a], this.x[b]] = [this.x[b] as number, this.x[a] as number];
    [this.y[a], this.y[b]] = [this.y[b] as number, this.y[a] as number];
  }
}
