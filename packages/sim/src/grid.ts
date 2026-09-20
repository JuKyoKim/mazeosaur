export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The build/path grid. A cell is either open or blocked (by a tower or by
 * terrain). Creeps path across cells; towers occupy cells. Kept as a flat
 * Uint8Array so flow-field recomputation is cheap enough to run on every
 * build and sell.
 */
export class Grid {
  private readonly cells: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    if (width <= 0 || height <= 0) throw new Error("grid must be non-empty");
    this.cells = new Uint8Array(width * height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isBlocked(x: number, y: number): boolean {
    return !this.inBounds(x, y) || this.cells[this.index(x, y)] === 1;
  }

  setBlocked(x: number, y: number, blocked: boolean): void {
    if (!this.inBounds(x, y)) throw new Error(`(${x},${y}) out of bounds`);
    this.cells[this.index(x, y)] = blocked ? 1 : 0;
  }

  clone(): Grid {
    const g = new Grid(this.width, this.height);
    g.cells.set(this.cells);
    return g;
  }
}
