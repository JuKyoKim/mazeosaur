import { CANVAS_H, CANVAS_W } from "./theme.js";

/**
 * The HUD, as numbers. Every box here comes from `docs/01-art-hud-and-audio.md`
 * section 4, which is generated from `tools/art/layout.ts` so that the spec
 * and the sample frames cannot disagree. This file is the client's copy of
 * that geometry: `tools/art` is a build tool outside the packages, so
 * `packages/game` cannot import it. If a number moves there it moves here.
 *
 * Lengths are logical pixels on the 720x1280 canvas. `pt()` converts to the
 * CSS points a 390pt phone shows, which is the number that decides whether a
 * control can be hit and whether type can be read.
 */

/** The reference phone: 390x844 CSS points. Phaser FIT scales uniformly. */
export const REF_DEVICE = { w: 390, h: 844 } as const;
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

/**
 * The HUD height is a primitive, not a remainder. It is spent exactly on
 * three rows — 96 + 40 + 136 — which exist because of the 82px floor, and it
 * does not get to shrink because a valley is short. So the HUD anchors to the
 * bottom of the canvas and never to the bottom of the grid; a 28-cell valley
 * puts the two edges in the same place, which is why nothing has broken yet.
 */
export const HUD_H = 272;
export const HUD_Y = CANVAS_H - HUD_H; // 1008

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
  sheetRange: { x: GUTTER + 4, y: HUD_Y + 224 },
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

/** Everything a reviewer should be able to check, as one table. */
export function layoutTable(): { what: string; logical: string; points: string }[] {
  const box = (b: { w: number; h: number }) => `${b.w}x${b.h}`;
  const both = (b: { w: number; h: number }) => `${pt(b.w)}x${pt(b.h)}`;
  return [
    { what: "logical canvas", logical: `${CANVAS_W}x${CANVAS_H}`, points: `${pt(CANVAS_W)}x${pt(CANVAS_H)}` },
    { what: "HUD", logical: `${CANVAS_W}x${HUD_H}`, points: `${pt(CANVAS_W)}x${pt(HUD_H)}` },
    { what: "hit-target floor", logical: `${MIN_HIT}`, points: `${pt(MIN_HIT)}` },
    { what: "Send", logical: box(ROW1.send), points: both(ROW1.send) },
    { what: "speed toggle", logical: box(ROW1.speed), points: both(ROW1.speed) },
    { what: "kind button", logical: box(ROW3.kindButton), points: both(ROW3.kindButton) },
    { what: "Grow", logical: box(ROW3.grow), points: both(ROW3.grow) },
    { what: "Sell", logical: box(ROW3.sell), points: both(ROW3.sell) },
    { what: "type: vital", logical: `${TYPE.vital}`, points: `${pt(TYPE.vital)}` },
    { what: "type: title", logical: `${TYPE.title}`, points: `${pt(TYPE.title)}` },
    { what: "type: body", logical: `${TYPE.body}`, points: `${pt(TYPE.body)}` },
    { what: "type: label (dim only)", logical: `${TYPE.label}`, points: `${pt(TYPE.label)}` },
  ];
}
