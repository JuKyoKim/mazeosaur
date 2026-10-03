import type { Kind } from "@mazeosaur/sim";

/** Logical canvas. Portrait; scaled to fit whatever screen mounts it. */
export const CANVAS_W = 720;
export const CANVAS_H = 1280;
/** Pixels per grid cell on the logical canvas: 20 cells * 36 = 720. */
export const CELL_PX = 36;

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
  // #ecf0f1 on the old #3f7a55 measured 4.44:1, just under WCAG AA body
  // text. Send is the one control a player reads under time pressure, so it
  // is not the place to be borderline; this is 5.57:1.
  buttonActive: 0x37694b,
  buttonDanger: 0x7a3f3f,
  hpBack: 0x2c3e50,
  hpFront: 0x2ecc71,
  hpLow: 0xe74c3c,
  ghost: 0xffffff,
} as const;

/**
 * Six kinds need six colours that are still six colours in a 19.5pt cell and
 * to the ~8% of men who cannot separate red from green. These were measured,
 * not picked by eye: `art:check` simulates all six under protanopia,
 * deuteranopia and tritanopia and grades all 60 pairs, and a pair passes only
 * if hue distance clears 120 or lightness contrast clears 1.5 so that
 * lightness alone can carry it. longneck and flier are adjacent in hue (151
 * and 199) and that is allowed: they are the only tall silhouette and the
 * only wide one, so for those two colour is the second channel, not the first.
 */
export const KIND_COLOR: Record<Kind, number> = {
  raptor: 0xf4a82a,
  tyrant: 0xbd2b1d,
  armored: 0xdbe4e6,
  horned: 0x8a44c4,
  longneck: 0x52a87e,
  flier: 0x3ab1ea,
};

export const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export function text(size: number, color: string = COLORS.text): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color };
}
