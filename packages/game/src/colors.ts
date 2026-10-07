// The palette. Deliberately Phaser-free and split out of `./theme.ts`, which
// is not: `text()` and `wrapped()` there are typed with
// `Phaser.Types.GameObjects.Text.TextStyle`, so anything importing `theme.ts`
// drags the Phaser namespace into its typecheck. `tools/art` must be able to
// read these values — its `BOARD` palette claims to take them "from theme.ts
// where they exist", and `tools/art/test/palette.test.ts` is what makes that
// claim checkable — and `tools` has no Phaser types and should not need any.
// Same reason `./row1.ts` and `./sheet.ts` were split out.
//
// `theme.ts` re-exports both of these, so every existing import still works
// and there is still one declaration.

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
   * `text` on this is 5.57:1, over the 4.5 floor §1 of
   * docs/01-art-hud-and-audio.md sets for HUD text. It is drawn under Send,
   * Grow, the build timer bar and Again, and Send is the one control a player
   * reads under time pressure, so it is not the place to sit on the line.
   * M2's `3f7a55` measured 4.44:1 — under — and `tools/art` was darkened
   * without this copy following, which is what `palette.test.ts` now catches.
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
