/**
 * The logical canvas and the HUD, as numbers. This file is the one home for
 * that geometry: `docs/01-art-hud-and-audio.md` section 4 and the sample
 * frames in `docs/art/` are generated from it by way of `tools/art/layout.ts`,
 * which re-exports it. The mock is the evidence for the spec, and evidence
 * that is allowed to disagree with the thing it attests to is not evidence —
 * so the constant lives here and the tool imports it, never the reverse.
 *
 * Lengths are logical pixels on the 720x1280 canvas. `pt()` converts to the
 * CSS points a 390pt phone shows, which is the number that decides whether a
 * control can be hit and whether type can be read.
 */

/** Logical canvas. Portrait; scaled to fit whatever screen mounts it. */
export const CANVAS_W = 720;
export const CANVAS_H = 1280;
/**
 * Pixels per grid cell. Fixed in v1 by `CELL_PX = CANVAS_W / GRID_W = 36`,
 * and a design constant rather than a number nobody parameterised: 36 is the
 * cell every sprite in the atlas is authored at, so a valley of a different
 * width would rescale every sprite and void the readability pass run at 36.
 */
export const CELL_PX = 36;
export const GRID_W = 20;

/**
 * The HUD height is a primitive, not a remainder. It is spent exactly on
 * three rows — 96 + 40 + 136 — which exist because of the 82px hit floor, and
 * it does not get to shrink because a valley is short. So the HUD anchors to
 * the bottom of the canvas and never to the bottom of the grid.
 */
export const HUD_H = 272;
export const HUD_Y = CANVAS_H - HUD_H; // 1008

/**
 * The board *area*: everything above the HUD. The grid is drawn inside it and
 * may be shorter than it. A 28-row valley fills it exactly, which is why
 * `BOARD_H` and the grid's own height have been able to share one name
 * without anything breaking yet.
 */
export const BOARD_H = HUD_Y;
export const GRID_H_MAX = Math.floor(BOARD_H / CELL_PX); // 28

/**
 * Vertical offset of a grid of `gridH` cells, centred in the board area.
 *
 * This is 0 for the 28-row valley that ships, but it is **not** a multiple of
 * `CELL_PX` in general — a 27-row valley gives 18. Anything converting a
 * pointer position back to a cell must subtract it before dividing, or it is
 * correct today and off by one row on the first valley that is not 28 rows,
 * which presents as a drag-interpolation bug.
 */
export function gridTop(gridH: number): number {
  return Math.round((BOARD_H - gridH * CELL_PX) / 2);
}

/**
 * Canvas y to grid row, or null for a point outside the grid. The inset is
 * subtracted before the divide, which is the whole point of this living here
 * rather than being written out at the one call site: an integer divide alone
 * is right for a 28-row valley and one row out for any other, and a cell that
 * is one row from the finger reads as a drag-interpolation bug.
 */
export function rowAt(y: number, gridH: number): number | null {
  const top = gridTop(gridH);
  if (y < top || y >= top + gridH * CELL_PX) return null;
  return Math.floor((y - top) / CELL_PX);
}

/** Canvas x to grid column, or null for a point outside the grid. */
export function colAt(x: number, gridW: number): number | null {
  if (x < 0 || x >= gridW * CELL_PX) return null;
  return Math.floor(x / CELL_PX);
}

/**
 * The reference phone: 390 x 844 CSS points, device pixel ratio 3 — an
 * iPhone 12 through 16 and the middle of the Android range. Phaser's FIT mode
 * scales the logical canvas uniformly, so the scale is set by whichever axis
 * binds first; at 720x1280 into 390x844 the width binds.
 */
export const REF_DEVICE = { w: 390, h: 844, dpr: 3 } as const;
export const SCALE = Math.min(REF_DEVICE.w / CANVAS_W, REF_DEVICE.h / CANVAS_H);

/** Logical pixels to CSS points on the reference phone. */
export function pt(logical: number): number {
  return Math.round(logical * SCALE * 10) / 10;
}

/**
 * The minimum hit target. 44 CSS points is the floor in both Apple's and
 * Google's guidance; dividing back through the scale is where 82 comes from.
 * It is the most load-bearing number in this file — the M2 HUD used 42px
 * buttons, which is 22.8pt, half the floor.
 */
export const MIN_HIT = Math.ceil(44 / SCALE); // 82

export const GUTTER = 16;
export const CONTENT_W = CANVAS_W - GUTTER * 2; // 688
/** Right edge every right-anchored HUD string measures back from. */
export const CONTENT_RIGHT = CANVAS_W - GUTTER; // 704

/**
 * The type scale. Nothing below `label`, because 19 logical px is already
 * only 10.3pt. Four sizes on purpose: the HUD says less rather than smaller.
 */
export const TYPE = {
  vital: 34, // meat and egg counts
  title: 26, // a dinosaur's name, a result headline
  body: 22, // the migration line, stat lines, button labels
  label: 19, // dim secondary labels only
} as const;

/**
 * Row 1, the vitals. A full-width draining bar along the seam between board
 * and HUD, then meat, eggs, the migration counter, Send and the speed
 * toggle. The bar is legible without being read, which is the point: during
 * a build phase the player is looking at the grid, not at the HUD. No digits.
 */
export const ROW1 = {
  y: HUD_Y,
  h: 96,
  timerBar: { x: 0, y: HUD_Y, w: CANVAS_W, h: 8 },
  // Meat is allowed four digits before it reaches the egg icon, which is the
  // most a player sees in fifty migrations.
  meatIcon: { x: GUTTER, y: HUD_Y + 30, w: 34, h: 34 },
  meatValue: { x: GUTTER + 44, y: HUD_Y + 30 },
  eggIcon: { x: 192, y: HUD_Y + 30, w: 30, h: 34 },
  eggValue: { x: 230, y: HUD_Y + 30 },
  migrationLabel: { x: 320, y: HUD_Y + 26 },
  migrationValue: { x: 320, y: HUD_Y + 50 },
  /** The counter column ends 12px short of Send, whatever the digits do. */
  migrationWrap: 444 - 12 - 320,
  send: { x: 444, y: HUD_Y + 11, w: 164, h: MIN_HIT },
  speed: { x: 622, y: HUD_Y + 11, w: MIN_HIT, h: MIN_HIT },
} as const;

/**
 * Row 2, the next migration. One line, and the only place the kind chart is
 * shown mid-run: a kind chip whose hue and silhouette say what is coming,
 * then the count and genus, then the archetype and kind dim and right
 * aligned. Information only, never tappable, so 40px may sit under the floor.
 */
export const ROW2 = {
  y: HUD_Y + 96,
  h: 40,
  chip: { x: GUTTER, y: HUD_Y + 102, w: 28, h: 28 },
  text: { x: GUTTER + 36, y: HUD_Y + 105 },
  /**
   * The row is two variable strings facing each other, so neither may be
   * positioned by its own measured width: the left one wraps inside the gap
   * it is allowed to fill and the right one is anchored to `CONTENT_RIGHT`.
   * 208px is `fast · regenerator` plus air, the longest pair the content can
   * produce.
   */
  metaW: 208,
  meta: { right: CONTENT_RIGHT, y: HUD_Y + 107 },
} as const;

/**
 * Row 3, the tray. One tray at a time: the six hatchlings while nothing is
 * selected, the dinosaur sheet while something is. Swapping rather than
 * stacking is what buys the hit targets — there is no room for both at 44pt
 * — and tapping a dinosaur and watching the shop become a sheet with a Grow
 * button on it is how the player learns that growing exists.
 */
export const ROW3 = {
  y: HUD_Y + 136,
  h: 136,
  /** Six kind buttons: (688 - 5*6) / 6 = 109.6, floored. */
  kindButton: { y: HUD_Y + 144, w: 109, h: 120, gap: 6 },
  /** Where the silhouette sits inside a kind button. */
  kindArt: { dy: 8, w: 52, h: 52 },
  kindName: { dy: 66 },
  kindCost: { dy: 92 },
  /**
   * The sheet's left column is 272px, which is 15 characters of `title`. The
   * two longest genus names in the content are Argentinosaurus and
   * Rhamphorhynchus, both exactly 15. The genus is the collectible, so it is
   * not allowed to truncate — the buttons moved right until it fit.
   */
  sheetName: { x: GUTTER + 4, y: HUD_Y + 146, w: 272 },
  sheetKind: { x: GUTTER + 4, y: HUD_Y + 174 },
  sheetStats: { x: GUTTER + 4, y: HUD_Y + 196 },
  /** Range, and whatever else the kind does that a stat line cannot say. */
  sheetExtras: { x: GUTTER + 4, y: HUD_Y + 224 },
  grow: { x: 300, y: HUD_Y + 163, w: 228, h: MIN_HIT },
  sell: { x: 540, y: HUD_Y + 163, w: 164, h: MIN_HIT },
} as const;

export function kindButtonX(i: number): number {
  return GUTTER + i * (ROW3.kindButton.w + ROW3.kindButton.gap);
}

/**
 * The toast. Refusals and events appear over the bottom of the board, near
 * where the thumb just was, instead of taking a HUD row: it costs no layout
 * height and puts the message where the eye already is. Anchored up from the
 * HUD rather than down from the top, so it follows the seam on any valley.
 */
export const TOAST = {
  x: GUTTER,
  y: HUD_Y - 76,
  w: CONTENT_W,
  h: 56,
  /** 1.6 seconds, then a 200ms fade. */
  holdMs: 1600,
  fadeMs: 200,
  /** The refusal bar down the left edge; an event shows no bar. */
  barW: 3,
  pad: 14,
} as const;

/**
 * The results screen, over a scrim with the board still visible behind it.
 * `again` sits in the HUD band at the same height as Send, so the thumb does
 * not have to move between the run that ended and the next one.
 */
export const RESULTS = {
  headline: { y: 360 },
  cleared: { y: 440 },
  eggsKept: { y: 520 },
  meatUnspent: { y: 520 },
  fossils: { y: 600 },
  /** Every dinosaur grown to adult, as its sprite, in a row. */
  pack: { x: GUTTER, y: 680, w: CONTENT_W, h: 180 },
  again: { x: Math.round((CANVAS_W - 328) / 2), y: HUD_Y + 11, w: 328, h: MIN_HIT },
} as const;
