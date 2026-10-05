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
  refusal: 0xe74c3c,
  /** `refusal` as a CSS string, for the text the card's cost flashes to. */
  refusalText: "#e74c3c",
  attack: 0xfdfefe,
  button: 0x2e4a38,
  buttonActive: 0x3f7a55,
  buttonDanger: 0x7a3f3f,
  hpBack: 0x2c3e50,
  hpFront: 0x2ecc71,
  hpLow: 0xe74c3c,
  ghost: 0xffffff,
  /**
   * One selection convention, so the player learns it once: the ring on a
   * selected dinosaur, the border on a selected tray card and the tap ring
   * are all this colour. It is `text` as a number — the HUD's lightest
   * token, 15.9:1 on `hud` — per §4 of docs/01-art-hud-and-audio.md.
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
