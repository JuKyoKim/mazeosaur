// What the dinosaur sheet says, as four strings. Pure: no Phaser, no DOM,
// so the client, the frame generator in `tools/art` and the tests all build
// the same four lines from the same code rather than from three copies that
// agree until somebody edits one of them.
//
// The *shape* is the design decision and it is load-bearing, so it is
// written down here rather than inferred from the call site.
//
// 1. `name` is the genus alone. It is the collectible and the one string
//    that must never truncate — Argentinosaurus and Rhamphorhynchus are
//    both 15 characters, which is why the genus gets a line to itself
//    rather than sharing one. The column it is given is `SHEET_COL_W`,
//    which is sized off the modifier line and not off the genus; that
//    constant says why.
// 2. `kind` is the family and the growth stage: the six facts the player
//    learns in one run, and which third of the line they are looking at.
// 3. `stats` is the two numbers you compare one dinosaur to another with:
//    sustained damage and reach.
// 4. `extras` is everything qualitative — what it can shoot at, and the
//    modifiers.
//
// What is deliberately *not* here is per-hit damage and the cooldown. The
// client used to print `36 dmg every 1.50s (24.0/s)`, and at 15px that one
// string is 558px wide in a 272px column: it ran under the Grow and Sell
// buttons for every adult with two modifiers. Damage per second is the
// figure the decision in front of the player actually turns on — grow this
// one, or build another — and per-hit burst only matters against an
// invader HP readout the v1 HUD does not have. The type scale in
// `layout.ts` is short on purpose: the HUD says less rather than smaller,
// and this is that call.
//
// Every line of every one of the 18 content defs fits inside
// `SHEET_COL_W`; `tests/client/dino-sheet.spec.ts` measures all four of
// them in the running client and fails if a content edit pushes one over.

import { CELL, TICKS_PER_SECOND, type DinoDef } from "@mazeosaur/sim";

/** Stage 1, 2, 3. Index 0 is unused: `DinoDef.stage` is one-based. */
const STAGE = ["", "hatchling", "juvenile", "adult"] as const;

export interface SheetLines {
  /** The genus, alone. */
  readonly name: string;
  /** Family and growth stage, e.g. `longneck adult`. */
  readonly kind: string;
  /** The comparable numbers, e.g. `24.0 dmg/s · range 3.0`. */
  readonly stats: string;
  /** Targeting and modifiers, e.g. `hits ground · splash · slow 45%`. */
  readonly extras: string;
}

/**
 * The four lines of the sheet for one dinosaur.
 *
 * `hits ground` keeps its verb. `ground` on its own reads as a fact about
 * where the dinosaur stands rather than about what it can shoot, and the
 * difference is a leaked flier migration.
 */
export function sheetLines(def: DinoDef): SheetLines {
  const dps = ((def.damage * TICKS_PER_SECOND) / def.cooldown).toFixed(1);
  const range = (def.range / CELL).toFixed(1);
  const extras = [
    `hits ${def.targets}`,
    def.splash ? "splash" : "",
    def.slow ? `slow ${def.slow.percent}%` : "",
    def.stun ? `stun ${(def.stun.ticks / TICKS_PER_SECOND).toFixed(1)}s` : "",
    def.targetCount && def.targetCount > 1 ? `${def.targetCount} targets` : "",
  ].filter(Boolean);
  return {
    name: def.name,
    kind: `${def.kind} ${STAGE[def.stage] ?? ""}`.trim(),
    stats: `${dps} dmg/s · range ${range}`,
    extras: extras.join(" · "),
  };
}

/**
 * The Grow button's label: the verb, the genus it becomes, and the price.
 *
 * Three lines and not one, for the same reason the sheet above is four. The
 * one-line form `Grow → Deinonychus` measures 202px at `TYPE.label` in a
 * 192px button, and 236px at `Argentinosaurus` — which, centred on
 * `ROW3.grow`, starts 10px inside the sheet column and ends 10px inside
 * Sell. Stacked, the widest line over all twelve grow targets is the genus
 * at 157px, which leaves 35px inside `ROW3.grow.w`. Both figures are this
 * machine's `system-ui` fallback and are quoted to say which shape fits,
 * not as constants: `ROW3_WRAP.grow` is the enforceable bound and
 * `tests/client/hud-hit-targets.spec.ts` re-takes the measurement in a real
 * client on every run.
 *
 * The arrow ends line 1 rather than beginning line 2 because it costs the
 * line that is already shortest instead of the one that is already longest.
 * `→ Argentinosaurus` is 179px, which fits today and leaves 13px — one
 * character — for a content edit to spend.
 *
 * `undefined` is stage 3: there is nothing to grow into and the button says
 * so rather than disappearing, because a control that vanishes reads as a
 * dropped tap.
 */
export function growLabel(next: DinoDef | undefined): string {
  return next ? `Grow →\n${next.name}\n${next.cost} meat` : "Fully grown";
}
