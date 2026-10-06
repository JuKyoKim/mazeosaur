// The two row-1 strings §4 of `docs/01-art-hud-and-audio.md` costs a width
// for. Pure: no Phaser, no DOM, so the client, the frame generator in
// `tools/art` and the tests all draw the same characters rather than three
// copies that agree until somebody edits one of them. `sheet.ts` is here for
// the same reason and says so at length.
//
// Why these two and not the meat and egg counts: those are numbers whose
// length is the player's doing, bounded by the wrap in `ROW1_WRAP` and
// nothing else. These two are *authored* — a label somebody can retype and a
// format somebody can reflow — and §4 sets Send's origin from the first one.
// `packages/game/test/layout.test.ts` holds both to the character count they
// were measured at, which is the only one of the three legs under §4's row-1
// width table that needs neither a font nor a browser.

/**
 * The migration readout's upper line, and the widest value in row 1's
 * middle band: 9 characters, 108px at `TYPE.label`, ending at 428 against
 * Send's origin at 444.
 *
 * It is drawn unwrapped — it is a constant, so there is nothing to wrap —
 * which makes it the one field in row 1 with no visible failure underneath
 * it. A tenth character lands it on Send silently. That is what the cap in
 * `layout.test.ts` is for.
 */
export const MIGRATION_LABEL = "MIGRATION";

/**
 * The readout's lower line: which migration of how many, one-based, and
 * held at the last one so the final migration reads `50 / 50` rather than
 * `51 / 50`.
 *
 * Spaces around the slash are deliberate. At `TYPE.body` the spaced form is
 * 77px against the 124px band — there is room — and `50 / 50` is two counts
 * with a divider between them where `50/50` reads as one token.
 */
export function migrationCounter(migration: number, total: number): string {
  return `${Math.min(migration + 1, total)} / ${total}`;
}
