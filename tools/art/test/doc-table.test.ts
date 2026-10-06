// The guard chain in ARB-292: everything else compares the renderer, `ROW1`
// and `ROW3` against each other, and nothing compared either of those to the
// numbers `docs/01-art-hud-and-audio.md` §4 actually prints. ARB-186 shipped
// a Sell button at 120x52 against a spec that said 164x82 for exactly that
// reason -- the drift was one level down (renderer vs. doc) and this is the
// same seam one level up (constants vs. doc).

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeSpec, describeProblem, docSpec, geometryDrift, readDoc } from "../doc-table.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("docs/01 §4 against layout.ts", () => {
  it("agrees on every row §4 lists", () => {
    const problems = geometryDrift(readDoc(ROOT));
    expect(problems.map(describeProblem).join("\n")).toBe("");
  });

  it("is checked at all, which is the part that was missing", () => {
    // A parser that silently matched nothing would pass on any drift. Row 1
    // has 9 rows (migration label/value counts once), the sheet tray has 6,
    // and Sell -- the row that actually drifted in ARB-186 -- must be among
    // them or this guard is not reaching the row it exists for.
    const spec = docSpec(readDoc(ROOT));
    expect(spec.size).toBe(15);
    expect(spec.has("sell")).toBe(true);
    expect(spec.get("sell")).toEqual(["540, 1171, 164 x 82"]);
    // Every row the doc lists has a matching entry in codeSpec -- otherwise
    // geometryDrift would report "(no entry in codeSpec -- add one)" rather
    // than a real comparison, which this pins against going unnoticed.
    const code = codeSpec();
    for (const row of spec.keys()) expect(code.has(row), `codeSpec is missing "${row}"`).toBe(true);
  });
});
