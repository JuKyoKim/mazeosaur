// Colour only. The geometry lives in ./layout.ts, which is the one place
// the canvas, the cell and the HUD boxes are declared.

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
  attack: 0xfdfefe,
  button: 0x2e4a38,
  buttonActive: 0x3f7a55,
  buttonDanger: 0x7a3f3f,
  hpBack: 0x2c3e50,
  hpFront: 0x2ecc71,
  hpLow: 0xe74c3c,
  ghost: 0xffffff,
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
