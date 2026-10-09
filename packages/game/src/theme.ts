// Colour and type styles. The geometry is not here: the canvas, the cell, the
// HUD boxes and the hit floor are `./layout.ts`, which is the one place they
// are declared and the file `tools/art` re-exports. A constant that lives in
// two files agrees only until somebody edits one of them.

import type { Kind } from "@mazeosaur/sim";

export const COLORS = {
  bg: 0x16211a,
  boardBg: 0x213127,
  gridLine: 0x2c4033,
  spawn: 0xd35400,
  checkpoint: 0xf1c40f,
  nest: 0xecf0f1,
  hud: 0x0f1712,
  hudPanel: 0x1c2a21,
  text: "#ecf0f1",
  textDim: "#95a5a6",
  meat: "#e67e22",
  eggs: "#f5f6fa",
  /**
   * `meat` and `eggs` as numbers, for the row-1 icons and the tray's cost
   * pip. Phaser wants a CSS string for text and a number for a shape, so a
   * colour used by both kinds of object needs both forms — the alternative
   * is parsing the string again on every draw. Same convention as
   * `refusalText` below, in the other direction.
   */
  meatFill: 0xe67e22,
  eggsFill: 0xf5f6fa,
  refusal: 0xe74c3c,
  /** `refusal` as a CSS string, for the text the card's cost flashes to. */
  refusalText: "#e74c3c",
  attack: 0xfdfefe,
  button: 0x2e4a38,
  /**
   * Send, the timer bar, Resume and the results screen's Again. §1 of
   * docs/01-art-hud-and-audio.md puts a 4.5:1 floor under HUD body text, and
   * M2's 0x3f7a55 held `text` at 4.44:1 — under it. This value is 5.57:1.
   * `packages/game/test/palette-agreement.test.ts` is what keeps it equal to
   * the art tool's copy, which is the copy `npm run art:check` measures.
   */
  buttonActive: 0x37694b,
  buttonDanger: 0x7a3f3f,
  hpBack: 0x2c3e50,
  hpFront: 0x2ecc71,
  hpLow: 0xe74c3c,
  /**
   * One selection convention, so the player learns it once. Every mark that
   * means "selected" or "your tap landed here" is this colour: the selected
   * dinosaur's range ring and its 3px cell outline, the valid cell's preview
   * range ring, the selected tray card's 3px border, and the tap ring. There
   * is deliberately no second near-white for marks on the board — §4 of
   * docs/01-art-hud-and-audio.md decides that and says why. It is `text` as a
   * number: the HUD's lightest token, 15.9:1 on `hud`.
   */
  selection: 0xecf0f1,
  /**
   * The board's dark ink: the refused preview's hatching, and the dark half
   * of `PIP_INK`. Hatching is laid over a cell whose colour it does not
   * control — any terrain, any kind's fill, the lane marks — so it needs one
   * value that contrasts with all of them rather than with one. Everything on
   * this board is mid-to-bright, so dark is that value.
   *
   * It is as dark as that argument can get. `#000000` would buy 11% — 3.22:1
   * to 3.58:1 on the tightest kind fill — and there is nothing after it,
   * which is why `PIP_INK` is a rule and not a darker literal.
   *
   * §4 of docs/01-art-hud-and-audio.md specifies the hatching's width and
   * spacing but not its colour; this is the gap, raised on ARB-168.
   */
  ink: 0x111111,
} as const;

/**
 * The six kind hues, and the palette `art:check` measures.
 *
 * These are §3 of docs/01-art-hud-and-audio.md's v1 table: the output of a
 * constrained search over all 60 pairs (six kinds, normal vision plus three
 * kinds of colour blindness) requiring every pair to separate either by hue
 * distance or by lightness. The client shipped M2's six until ARB-386 —
 * `e0a83a c0392b 95a5a6 8e44ad 27ae60 3498db`, the values the search was run
 * to replace — while `tools/art` drew every plate and every atlas frame from
 * the table below. Both palettes were therefore on screen at once: a strike
 * sprite out of the atlas in one hue, over a cell fill in the other.
 *
 * `test/palette-agreement.test.ts` pins these equal to `KIND_HUE` in
 * `tools/art/directions.ts`, which is what makes `art:check`'s 60-pair
 * measurement a measurement of the client.
 */
export const KIND_COLOR: Record<Kind, number> = {
  raptor: 0xf4a82a,
  tyrant: 0xbd2b1d,
  armored: 0xdbe4e6,
  horned: 0x8a44c4,
  longneck: 0x52a87e,
  flier: 0x3ab1ea,
};

/**
 * The growth pip's colour, per kind. Growth stage on the board is a count of
 * pips on the animal, so a pip is a graphical object carrying information and
 * owes WCAG 1.4.11's 3:1 against the fill it is drawn on.
 *
 * **A pip is not the hatching, and that is the whole rule.** `ink` has to be
 * one fixed value because hatching lands on a cell nobody chose — any
 * terrain, any lane mark. A pip lands on its own dinosaur's cell fill, a
 * closed set of six known at the call site, so it can take the better of two
 * values and still be one rule: **whichever of `ink` and `selection`
 * contrasts more with `KIND_COLOR[kind]`**. Four kinds are bright enough for
 * ink; `tyrant` and `horned` are the two dark hues and take the light value.
 *
 * What the rule buys, re-derived in `test/palette-agreement.test.ts`:
 *
 * | kind | fill | on ink | on selection | pip |
 * | --- | --- | --- | --- | --- |
 * | raptor | `f4a82a` | 9.42 | 1.75 | ink, 9.42:1 |
 * | tyrant | `bd2b1d` | 3.17 | 5.19 | selection, 5.19:1 |
 * | armored | `dbe4e6` | 14.61 | 1.13 | ink, 14.61:1 |
 * | horned | `8a44c4` | 3.33 | 4.94 | selection, 4.94:1 |
 * | longneck | `52a87e` | 6.53 | 2.52 | ink, 6.53:1 |
 * | flier | `3ab1ea` | 7.78 | 2.11 | ink, 7.78:1 |
 *
 * The floor is `horned` at 4.94:1, which clears AA body text and not just
 * 1.4.11 — and a hue revision cannot drop it far: the worst fill the
 * better-of rule can be handed is the mid grey where the two values meet, and
 * that is still 4.01:1. One fixed ink has no such floor. ARB-386 found the
 * pips shipping at **2.88:1** on `horned`, because `ink` was 3.22:1 there and
 * the draw composited it at alpha 0.85.
 *
 * Which is the second half of the rule: **the pips are drawn opaque.** An
 * alpha on a mark whose job is to be counted spends the contrast the count is
 * read with, and 0.85 was spending 11% of it to soften an edge.
 *
 * Using `selection` for two of the six is not a second selection mark. §4 of
 * docs/01-art-hud-and-audio.md is explicit that selection is carried by
 * weight and geometry — a 3px stroke, a range ring, a 5px lift — and a filled
 * 6px dot at the foot of a cell is none of those. The alternative was a
 * seventh near-white literal, which the same section forbids.
 */
export const PIP_INK: Record<Kind, number> = {
  raptor: COLORS.ink,
  tyrant: COLORS.selection,
  armored: COLORS.ink,
  horned: COLORS.selection,
  longneck: COLORS.ink,
  flier: COLORS.ink,
};

/**
 * How much of its kind's hue a tray card's background carries, over `hud`.
 *
 * Here and not in `layout.ts` because it is not geometry: it is the only
 * thing in the HUD whose *background* colour is a variable, and so the only
 * place where a kind hue decides whether a text pair passes. Every card's
 * label and cost is drawn on `hue × this + hud × (1 - this)` — six different
 * backgrounds, and the lightest kind sets the floor for all six. §3's ten
 * measured text pairs are all fixed panel colours and never covered these.
 *
 * 0.14 is where the dimmest state on the lightest card keeps a real margin:
 * `textDim` on `armored`'s card is 5.03:1, against 3.92:1 at the 0.22 the
 * client shipped and 2.84:1 at the 0.32 `tools/art` drew into §4's own
 * picture. Those were three values of one constant, which is why it is a
 * constant now — `test/palette-agreement.test.ts` pins it to the art tool's
 * copy the way the colours are pinned.
 *
 * The card does not lose its kind channel to this. §4 puts the hue at full
 * strength in the silhouette the card is mostly made of; the wash behind it
 * was never the thing that said raptor.
 */
export const CARD_TINT = 0.14;

export const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export function text(size: number, color: string = COLORS.text): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color };
}

/**
 * `COLORS` holds hues as numbers, which is what the renderer wants for a
 * shape; `Text` wants `#rrggbb`. This is the one conversion between the
 * two, and it lives here rather than beside a scene so that a spec checking
 * "§9's checkpoint yellow" asks the same question the scene answered.
 */
export function hexCss(hue: number): string {
  return `#${hue.toString(16).padStart(6, "0")}`;
}

/**
 * `text()` with a hard wrap at `width`.
 *
 * Every variable-length string in the HUD gets one, and the width is always
 * a `layout.ts` number. The strings are content — a genus, a count, a
 * modifier line — so their pixel widths are not knowable from the layout,
 * and a field with no wrap over-subscribes its row *silently*: Phaser draws
 * it over its neighbour rather than failing. A wrap turns that into a
 * visibly broken line, which is the failure mode that gets fixed.
 */
export function wrapped(
  size: number,
  width: number,
  color: string = COLORS.text,
): Phaser.Types.GameObjects.Text.TextStyle {
  return { ...text(size, color), wordWrap: { width } };
}
