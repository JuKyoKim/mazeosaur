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
  ghost: 0xffffff,
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
   * The board's dark ink: the growth pips, and the refused preview's
   * hatching. Both are marks laid over a cell whose colour the mark does
   * not control — a pip sits on any kind's fill, hatching on any terrain —
   * so both need a value that contrasts with all of them rather than with
   * one. Everything on this board is mid-to-bright, so dark is that value.
   *
   * §4 of docs/01-art-hud-and-audio.md specifies the hatching's width and
   * spacing but not its colour; this is the gap, raised on ARB-168.
   */
  ink: 0x111111,
} as const;

export const KIND_COLOR: Record<Kind, number> = {
  raptor: 0xe0a83a,
  tyrant: 0xc0392b,
  armored: 0x95a5a6,
  horned: 0x8e44ad,
  longneck: 0x27ae60,
  flier: 0x3498db,
};

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
