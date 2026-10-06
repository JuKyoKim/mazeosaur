// The guard chain in ARB-292: everything else compares the renderer, `ROW1`
// and `ROW3` against each other, and nothing compared either of those to the
// numbers `docs/01-art-hud-and-audio.md` §4 actually prints. ARB-186 shipped
// a Sell button at 120x52 against a spec that said 164x82 for exactly that
// reason -- the drift was one level down (renderer vs. doc) and this is the
// same seam one level up (constants vs. doc).

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeSpec, describeProblem, docSpec, geometryDrift, readDoc, widthDrift, widthSpec } from "../doc-table.js";
import { ROW1 } from "../layout.js";

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

describe("docs/01 §4's row-1 width table", () => {
  it("ends each field where its own width puts it, beside the neighbour layout.ts puts there", () => {
    const problems = widthDrift(readDoc(ROOT));
    expect(problems.map(describeProblem).join("\n")).toBe("");
  });

  it("is checked at all, which is the part that was missing", () => {
    // ARB-307 read the migration row as saying the readout clears Send by
    // 1px rather than 16 — measured off a board plate, which is drawn in a
    // fixed-pitch mock font and not the one the HUD uses. The table was
    // right; nothing in the repo could say so. Three fields, and the
    // migration row — the one every downstream number in the band depends
    // on — must be among them or this guard is not reaching it.
    const spec = widthSpec(readDoc(ROOT));
    expect(spec.size).toBe(3);
    expect(spec.get("migration")).toEqual({ width: 108, endsAt: 428, nextOrigin: ROW1.send.x });
    // The clearance §4's prose argues from, stated once here so a table edit
    // that quietly spends it has to come past this line.
    const migration = spec.get("migration")!;
    expect(ROW1.send.x - migration.endsAt).toBe(16);
  });
});
