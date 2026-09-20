import { describe, expect, it } from "vitest";
import { Rng } from "../src/index.js";

describe("Rng", () => {
  it("is reproducible from its seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds and stays in range", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("resumes from a saved state", () => {
    const a = new Rng(99);
    a.nextU32();
    const saved = a.getState();
    const next = a.nextU32();
    const b = new Rng(0);
    b.setState(saved);
    expect(b.nextU32()).toBe(next);
  });
});
