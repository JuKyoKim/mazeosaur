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
} as const;

/**
 * The selected tray card's two geometry numbers. Both are derived in §4 of
 * `docs/01-art-hud-and-audio.md` and both live in `tools/art/layout.ts`,
 * which is the source of truth the frame generator and `art:verify` read.
 * They are restated here because `packages/game` cannot depend on `tools/`;
 * if they change there, they change here.
 *
 * The lift is 5 and the border 3 because the card sits 8px inside its row
 * and 5 + 3 is 8, so the border stops exactly on the row line rather than
 * crossing into the migration line above it.
 */
export const SELECT_LIFT = 5;
export const SELECT_BORDER = 3;

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
