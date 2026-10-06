import { describe, expect, it } from "vitest";
import {
  Grid,
  buildRefusal,
  computeLaneFields,
  distanceAt,
  laneIsOpen,
  legTargetCells,
  nextStep,
  type Lane,
  type Point,
} from "../src/index.js";

const lane: Lane = {
  spawn: { x: 0, y: 0 },
  checkpoints: [{ x: 4, y: 0 }],
  exit: { x: 4, y: 4 },
};

/** The checkpoint's three in-bounds neighbours on this 5x5 lane. */
const AROUND_CHECKPOINT: Point[] = [
  { x: 3, y: 0 },
  { x: 4, y: 1 },
  { x: 3, y: 1 },
];

describe("lane build rules", () => {
  it("allows building on an open grid", () => {
    expect(buildRefusal(new Grid(5, 5), lane, { x: 2, y: 2 })).toBeNull();
  });

  it("refuses the spawn and the exit, and nothing else by position", () => {
    const g = new Grid(5, 5);
    expect(buildRefusal(g, lane, lane.spawn)).toBe("lane-cell");
    expect(buildRefusal(g, lane, lane.exit)).toBe("lane-cell");
    expect(buildRefusal(g, lane, { x: 9, y: 9 })).toBe("out-of-bounds");
    // the checkpoint is a routing waypoint, not a reserved cell
    expect(buildRefusal(g, lane, { x: 4, y: 0 })).toBeNull();
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

describe("a buildable checkpoint", () => {
  it("hands the leg to its open neighbours only once it is occupied", () => {
    const g = new Grid(5, 5);
    expect(legTargetCells(g, lane, 0)).toEqual([{ x: 4, y: 0 }]);
    g.setBlocked(4, 0, true);
    expect(legTargetCells(g, lane, 0)).toEqual(AROUND_CHECKPOINT);
    // the last leg's target is the exit either way
    expect(legTargetCells(g, lane, 1)).toEqual([lane.exit]);
  });

  it("still routes an invader through both legs with a dinosaur on the checkpoint [@baseline]", () => {
    const g = new Grid(5, 5);
    g.setBlocked(4, 0, true); // the dinosaur standing on the waypoint
    expect(laneIsOpen(g, lane)).toBe(true);

    const fields = computeLaneFields(g, lane);
    const visited: Point[] = [];
    const legEnds: Point[] = [];
    let p: Point = lane.spawn;
    for (const field of fields) {
      for (let steps = 0; ; steps++) {
        if (steps > 64) throw new Error("did not converge");
        const n = nextStep(field, g, p);
        if (n === null) break;
        p = n;
        visited.push(p);
      }
      // distance 0 is what hands the invader to the next leg
      expect(distanceAt(field, g, p)).toBe(0);
      legEnds.push(p);
    }
    expect(p).toEqual(lane.exit);
    // it walked the first leg to a cell beside the waypoint, never over it
    expect(AROUND_CHECKPOINT).toContainEqual(legEnds[0]);
    expect(visited).not.toContainEqual({ x: 4, y: 0 });
  });

  it("refuses the dinosaur that would wall an occupied checkpoint in completely", () => {
    const g = new Grid(5, 5);
    g.setBlocked(4, 0, true);
    // two of the three neighbours can still be built on
    expect(buildRefusal(g, lane, { x: 3, y: 0 })).toBeNull();
    g.setBlocked(3, 0, true);
    expect(buildRefusal(g, lane, { x: 4, y: 1 })).toBeNull();
    g.setBlocked(4, 1, true);
    // the third leaves the leg with no target at all
    expect(legTargetCells(g, lane, 0)).toEqual([{ x: 3, y: 1 }]);
    expect(buildRefusal(g, lane, { x: 3, y: 1 })).toBe("would-block");
    expect(g.isBlocked(3, 1)).toBe(false);
  });

  it("refuses the dinosaur that would strand a cell of the checkpoint's neighbourhood", () => {
    const g = new Grid(5, 5);
    g.setBlocked(4, 0, true); // the dinosaur on the waypoint
    g.setBlocked(2, 0, true);
    g.setBlocked(2, 1, true);
    expect(laneIsOpen(g, lane)).toBe(true);
    // (3,0) ends leg 0, and with (3,1) blocked its only way out would be the
    // diagonal to (4,1) through the checkpoint's corner, which is not a step.
    // An invader that finished leg 0 there would never finish leg 1.
    expect(buildRefusal(g, lane, { x: 3, y: 1 })).toBe("would-block");
    // the other neighbour is still free: blocking it strands nothing
    expect(buildRefusal(g, lane, { x: 4, y: 1 })).toBeNull();
  });
});
