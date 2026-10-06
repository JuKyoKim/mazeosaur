import { describe, expect, it } from "vitest";
import { Grid, computeFlowField, distanceAt, nextStep, UNREACHABLE, STEP_COST, DIAG_COST } from "../src/index.js";

describe("flow field", () => {
  it("measures straight and diagonal distance on an open grid", () => {
    const g = new Grid(5, 5);
    const f = computeFlowField(g, { x: 0, y: 0 });
    expect(distanceAt(f, g, { x: 0, y: 0 })).toBe(0);
    expect(distanceAt(f, g, { x: 3, y: 0 })).toBe(3 * STEP_COST);
    expect(distanceAt(f, g, { x: 2, y: 2 })).toBe(2 * DIAG_COST);
    // 4 across, 1 down: one diagonal + three straight
    expect(distanceAt(f, g, { x: 4, y: 1 })).toBe(DIAG_COST + 3 * STEP_COST);
  });

  it("routes around a wall and marks sealed cells unreachable [@baseline]", () => {
    const g = new Grid(5, 3);
    // wall down column 2, leaving a gap at the bottom
    g.setBlocked(2, 0, true);
    g.setBlocked(2, 1, true);
    const f = computeFlowField(g, { x: 0, y: 0 });
    expect(distanceAt(f, g, { x: 4, y: 0 })).toBeGreaterThan(4 * STEP_COST);
    expect(distanceAt(f, g, { x: 4, y: 0 })).not.toBe(UNREACHABLE);

    g.setBlocked(2, 2, true); // seal it
    const sealed = computeFlowField(g, { x: 0, y: 0 });
    expect(distanceAt(sealed, g, { x: 4, y: 0 })).toBe(UNREACHABLE);
    expect(distanceAt(sealed, g, { x: 1, y: 1 })).not.toBe(UNREACHABLE);
  });

  it("takes several targets at once, measuring every cell to the nearest one", () => {
    const g = new Grid(5, 5);
    const both = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ];
    const f = computeFlowField(g, both);
    expect(distanceAt(f, g, { x: 0, y: 0 })).toBe(0);
    expect(distanceAt(f, g, { x: 4, y: 0 })).toBe(0);
    expect(distanceAt(f, g, { x: 1, y: 0 })).toBe(STEP_COST);
    expect(distanceAt(f, g, { x: 3, y: 0 })).toBe(STEP_COST);
    expect(distanceAt(f, g, { x: 2, y: 0 })).toBe(2 * STEP_COST);

    // a blocked target is dropped, not rejected: the rest still measure
    g.setBlocked(0, 0, true);
    const one = computeFlowField(g, both);
    expect(distanceAt(one, g, { x: 1, y: 0 })).toBe(3 * STEP_COST);

    // drop them all and nothing is reachable, which is how a sealed leg reads
    g.setBlocked(4, 0, true);
    const none = computeFlowField(g, both);
    expect(distanceAt(none, g, { x: 2, y: 2 })).toBe(UNREACHABLE);
  });

  it("does not cut corners between two diagonally touching towers", () => {
    const g = new Grid(3, 3);
    // towers at (1,0) and (0,1): the diagonal from (0,0) to (1,1) is a wall
    g.setBlocked(1, 0, true);
    g.setBlocked(0, 1, true);
    const f = computeFlowField(g, { x: 2, y: 2 });
    expect(distanceAt(f, g, { x: 0, y: 0 })).toBe(UNREACHABLE);
  });

  it("nextStep walks a creep to the target along non-increasing distances [@baseline]", () => {
    const g = new Grid(8, 8);
    for (let y = 0; y < 7; y++) g.setBlocked(3, y, true); // wall with a gap at the bottom
    const target = { x: 7, y: 0 };
    const f = computeFlowField(g, target);
    let p = { x: 0, y: 0 };
    let steps = 0;
    let last = distanceAt(f, g, p);
    while (true) {
      const n = nextStep(f, g, p);
      if (n === null) break;
      const d = distanceAt(f, g, n);
      expect(d).toBeLessThan(last);
      last = d;
      p = n;
      if (++steps > 64) throw new Error("did not converge");
    }
    expect(p).toEqual(target);
  });
});
