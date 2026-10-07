// WCAG 1.4.11: a graphical object whose colour carries information needs 3:1
// against what it sits on. `art:check`'s existing contrast block is ten
// *text* pairs at 4.5, and there was no 3:1 block anywhere — which is the
// structural reason ARB-377 existed. The build timer bar, the one readout in
// the HUD with no label on it, sat at 2.94:1 and then 2.34:1 after ARB-364
// darkened `buttonActive`, and nothing in the repo could say so.
//
// Lives here rather than inline in `build.ts` for the same reason
// `doc-table.ts` does: `npm run check` runs lint, typecheck and vitest, not
// `art:check`, so a guard only the CLI ran would gate nothing. `build.ts`
// prints these and `test/graphical-pairs.test.ts` fails on them.

import { BOARD, KIND_HUE, KINDS } from "./directions.js";
import { contrastRatio, rgb, type Rgb } from "./raster.js";

/** WCAG 1.4.11's floor for a graphical object that carries information. */
export const GRAPHICAL_FLOOR = 3;

export interface Pair {
  readonly what: string;
  readonly fg: Rgb;
  readonly bg: Rgb;
}

/**
 * Pairs that must clear 3:1. Every one of these is a shape whose colour is
 * the information — a quantity, a lane marker, a selection — rather than a
 * slab behind a label that the label identifies.
 */
export const GATED: readonly Pair[] = [
  // The bar ARB-377 fixed, and its only two boundaries. The track is 1.09:1
  // on `boardBg` and so delineates nothing; the fill against the board above
  // the seam is therefore the edge that has to carry the bar's top.
  { what: "timer bar fill / track", fg: BOARD.meat, bg: BOARD.hudPanel },
  { what: "timer bar fill / board", fg: BOARD.meat, bg: BOARD.boardBg },
  // Invader health: the front's length is the reading, so the front against
  // its own back is the pair that has to separate.
  { what: "hp full / hp back", fg: BOARD.hpFront, bg: BOARD.hpBack },
  // Row 1's two icons are shapes with counts beside them, not labelled fields.
  { what: "meat icon / HUD", fg: BOARD.meat, bg: BOARD.hud },
  { what: "egg icon / HUD", fg: BOARD.eggs, bg: BOARD.hud },
  // Lane marks. Where an invader enters, turns and leaves is carried by cell
  // colour alone, so each has to separate from the board it is drawn on.
  { what: "spawn / board", fg: BOARD.spawn, bg: BOARD.boardBg },
  { what: "checkpoint / board", fg: BOARD.checkpoint, bg: BOARD.boardBg },
  { what: "nest / board", fg: BOARD.nest, bg: BOARD.boardBg },
  { what: "selection / board", fg: BOARD.nest, bg: BOARD.boardBg },
  // Growth stage is pips on the animal, so the pip has to clear the fill it
  // is laid on for all six kinds. See `tightestPip()` for which one is
  // closest to the floor, and for why the client's own number is lower.
  ...KINDS.map((k) => ({ what: `pip / ${k}`, fg: BOARD.ink, bg: rgb(KIND_HUE[k]) })),
];

/**
 * Pairs deliberately under 3:1, each with the reason in the code rather than
 * in a review thread — so an exemption is a decision somebody made and can be
 * argued with, the same discipline the `ART_ONLY` keys use.
 *
 * A stale exemption is a failure too: if one of these now clears the floor,
 * `staleExemptions()` says so and somebody has to move it up. An exemption
 * nobody revisits is how a list like this stops meaning anything.
 */
export const EXEMPT: readonly (Pair & { readonly why: string })[] = [
  {
    what: "grid line / board",
    fg: BOARD.gridLine,
    bg: BOARD.boardBg,
    why: "texture, not an indicator: where a tap will land is the placement preview and the selection ring at 11.94:1. At 3:1 the board becomes graph paper and fights every sprite on it.",
  },
  {
    what: "hp back / board",
    fg: BOARD.hpBack,
    bg: BOARD.boardBg,
    why: "the front's length is the reading, not the back's edge. It does cost something, and ARB-378 holds the fix.",
  },
  {
    what: "hp low / hp back",
    fg: BOARD.hpLow,
    bg: BOARD.hpBack,
    why: "2.87:1, marginal and a real failure. Deferred to ARB-378 because the fix is geometry as well as palette.",
  },
  {
    what: "hp full / hp low",
    fg: BOARD.hpFront,
    bg: BOARD.hpLow,
    why: "bar length is threat's first channel and hue its second (§3's second-channel table), so green-against-red is not carrying this alone.",
  },
  {
    what: "Send active / Send idle",
    fg: BOARD.buttonActive,
    bg: BOARD.button,
    why: "a change over time on one control, not two things side by side. Ruled on ARB-364.",
  },
  {
    what: "button / HUD",
    fg: BOARD.button,
    bg: BOARD.hud,
    why: "a filled slab under a visible 8.50:1 label is identified by its label, which is what 1.4.11's exemption is for.",
  },
];

export interface Result {
  readonly what: string;
  readonly ratio: number;
  readonly ok: boolean;
}

/** Every gated pair, measured. `ok` is `ratio >= 3`. */
export function gatedResults(): Result[] {
  return GATED.map((p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    return { what: p.what, ratio, ok: ratio >= GRAPHICAL_FLOOR };
  });
}

/** The gated pairs that are under the floor. Empty is the passing state. */
export function graphicalFailures(): Result[] {
  return gatedResults().filter((r) => !r.ok);
}

/**
 * Exemptions that now clear the floor. A pair listed as "deliberately under"
 * which is no longer under is either a palette change nobody re-checked or a
 * reason that has expired, and both want a human to look.
 */
export function staleExemptions(): Result[] {
  return EXEMPT.map((p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    return { what: p.what, ratio, ok: ratio >= GRAPHICAL_FLOOR };
  }).filter((r) => r.ok);
}

/**
 * The tightest growth-pip pair, which is the one worth naming when this list
 * changes: it is the pair closest to the floor and so the first to fall
 * through a palette edit.
 *
 * **It is measured on `KIND_HUE`, which is the art tool's palette.** The
 * client draws pips over `KIND_COLOR` in `packages/game/src/theme.ts`, and
 * those six values are *not* the same six — `palette-agreement.test.ts` pins
 * the board and HUD colours but not the kind hues. Against the client's set
 * the tightest is `horned` at 3.22:1 rather than `tyrant` at 3.17:1, and the
 * client additionally draws the pip at **alpha 0.85**, which composites to
 * 2.88:1 on `horned` — under the floor. That is a real defect and it is
 * ARB-386's, not this file's: gating a number here that no renderer produces
 * would be worse than gating the one the art tool actually draws.
 */
export function tightestPip(): Result {
  const pips = gatedResults().filter((r) => r.what.startsWith("pip / "));
  return pips.reduce((a, b) => (b.ratio < a.ratio ? b : a));
}
