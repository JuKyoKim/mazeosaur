// The gate ARB-377 was missing. `art:check`'s contrast block graded ten text
// pairs at 4.5 and no graphical pair at any ratio, so the build timer bar
// could sit at 2.94:1 — and then 2.34:1 after ARB-364 darkened `buttonActive`
// — with every check in the repo green.
//
// In vitest rather than only in `art:check` because `npm run check` does not
// run `art:check`; the same argument `doc-table.test.ts` makes for itself.

import { describe, expect, it } from "vitest";
import { contrastRatio } from "../raster.js";
import { BOARD, KINDS } from "../directions.js";
import { EXEMPT, GATED, GRAPHICAL_FLOOR, gatedResults, graphicalFailures, staleExemptions, tightestPip, tightestSelection } from "../graphical-pairs.js";

describe("graphical pairs (WCAG 1.4.11, 3:1)", () => {
  it("every gated pair clears the floor", () => {
    const failures = graphicalFailures().map((r) => `${r.what} ${r.ratio.toFixed(2)}:1`);
    expect(failures.join("\n")).toBe("");
  });

  // A list that matched nothing would pass this file on any palette. Six of
  // the gated pairs are the growth pips, so the count moves only when a kind
  // is added or a pair is written down — not when a colour changes.
  it("is measuring the pairs it claims to, not an empty list", () => {
    expect(GATED).toHaveLength(9 + KINDS.length);
    expect(gatedResults().every((r) => r.ratio > 1)).toBe(true);
    expect(GATED.map((p) => p.what)).toContain("timer bar fill / track");
  });

  // The regression itself, named rather than implied: `buttonActive` on the
  // track is what shipped, and it is under the floor at both the value before
  // ARB-364 and the one after. If someone puts it back, this is the line that
  // explains why not.
  it("the fill the bar used to have is why this gate exists", () => {
    expect(contrastRatio(BOARD.buttonActive, BOARD.hudPanel)).toBeLessThan(GRAPHICAL_FLOOR);
    expect(contrastRatio(BOARD.meat, BOARD.hudPanel)).toBeGreaterThanOrEqual(GRAPHICAL_FLOOR);
  });

  it("no exemption has quietly started passing", () => {
    const stale = staleExemptions().map((r) => `${r.what} is ${r.ratio.toFixed(2)}:1 and no longer needs its exemption`);
    expect(stale.join("\n")).toBe("");
  });

  // Every exemption carries its reason in the code. An exemption with an
  // empty reason is a pair somebody skipped rather than decided.
  it("every exemption says why", () => {
    for (const e of EXEMPT) expect(e.why.length, e.what).toBeGreaterThan(40);
  });

  // `GATED` has had a length assertion since this file was written and
  // `EXEMPT` had none, so a dropped exemption row passed every test here —
  // which is how §3's seventh row went missing from the code while the doc
  // on `main` claimed "ARB-377 carries both tables into `art:check`". The
  // count is the part no per-row assertion can check, because the failure is
  // a row that is not there to be iterated over.
  it("carries all seven of §3's exemption rows, not six", () => {
    expect(EXEMPT).toHaveLength(7);
    expect(EXEMPT.map((p) => p.what)).toContain("selection / tightest kind fill");
  });

  // The exemption's bound, so it cannot rot into a row that exempts a pair
  // already clearing the floor. `tightestSelection()` is the minimum across
  // the six kinds: if a hue edit lifts even that one over 3:1, every kind is
  // over and the mark does not need exempting any more.
  it("the selection mark still needs its exemption", () => {
    const t = tightestSelection();
    expect(t.ratio).toBeLessThan(GRAPHICAL_FLOOR);
    expect(t.what).toBe("selection / armored");
  });

  // The pair closest to the floor, so a palette edit that eats the margin
  // fails here with the kind named rather than somewhere downstream.
  it("names the tightest growth pip", () => {
    const t = tightestPip();
    expect(t.ratio).toBeGreaterThanOrEqual(GRAPHICAL_FLOOR);
    expect(t.ratio).toBeLessThan(3.5);
  });
});
