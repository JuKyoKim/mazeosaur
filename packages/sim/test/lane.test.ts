import { describe, expect, it } from "vitest";
import { Grid, buildRefusal, laneIsOpen, type Lane } from "../src/index.js";

const lane: Lane = {
  spawn: { x: 0, y: 0 },
  checkpoints: [{ x: 4, y: 0 }],
  exit: { x: 4, y: 4 },
};

describe("lane build rules", () => {
  it("allows building on an open grid", () => {
    expect(buildRefusal(new Grid(5, 5), lane, { x: 2, y: 2 })).toBeNull();
  });

  it("refuses spawn, checkpoint and exit cells", () => {
    const g = new Grid(5, 5);
    expect(buildRefusal(g, lane, lane.spawn)).toBe("lane-cell");
    expect(buildRefusal(g, lane, { x: 4, y: 0 })).toBe("lane-cell");
    expect(buildRefusal(g, lane, lane.exit)).toBe("lane-cell");
    expect(buildRefusal(g, lane, { x: 9, y: 9 })).toBe("out-of-bounds");
  });

  it("refuses the tower that would seal the maze, and leaves the grid untouched", () => {
    const g = new Grid(5, 5);
    // wall column 2 except the bottom cell
    for (let y = 0; y < 4; y++) g.setBlocked(2, y, true);
    expect(laneIsOpen(g, lane)).toBe(true);
    expect(buildRefusal(g, lane, { x: 2, y: 4 })).toBe("would-block");
    expect(g.isBlocked(2, 4)).toBe(false);
    // any other free cell is still fine
    expect(buildRefusal(g, lane, { x: 1, y: 3 })).toBeNull();
  });

  it("treats every leg independently: sealing checkpoint->exit is a block even if spawn->checkpoint is open", () => {
    const g = new Grid(5, 5);
    // wall row 2 fully, cutting the bottom half off from the top
    for (let x = 0; x < 5; x++) g.setBlocked(x, 2, true);
    expect(laneIsOpen(g, lane)).toBe(false);
    // reopening one cell restores the lane
    g.setBlocked(0, 2, false);
    expect(laneIsOpen(g, lane)).toBe(true);
    expect(buildRefusal(g, lane, { x: 0, y: 2 })).toBe("would-block");
  });
});
