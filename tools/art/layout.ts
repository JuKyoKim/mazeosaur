// The v1 HUD layout, as numbers. docs/01-art-hud-and-audio.md is generated
// against this file and the sample frames are drawn from it, so the spec and
// the picture cannot disagree. If a number here changes, both change.
//
// Coordinate space is the logical canvas from packages/game/src/theme.ts:
// 720 x 1280, 36px cells, the HUD the bottom 272px, and the board area the
// 720 x 1008 above it. The grid is drawn inside the board area and may be
// shorter than it; the HUD never moves to meet it.
//
// Every length is a logical pixel. `pt()` converts to the CSS points a
// 390pt-wide phone actually shows, which is the number that decides whether
// a hit target is big enough and whether type is readable.

export const CANVAS_W = 720;
export const CANVAS_H = 1280;
export const CELL_PX = 36;
/**
 * Fixed in v1, and a design constant rather than a number nobody
 * parameterised: `CELL_PX = CANVAS_W / GRID_W = 36` is the cell every sprite
 * in the atlas is authored at, so a valley of a different width would rescale
 * every sprite and void the readability pass run at 36.
 */
export const GRID_W = 20;
/**
 * How many cells tall a dinosaur is *drawn*, against the one cell it
 * *occupies*. Section 5.0 of `docs/01-art-hud-and-audio.md`: the footprint is
 * the sim's and is unchanged at one cell; the draw box is taller, which is
 * the mechanism by which a block direction reads as a solid standing on a
 * tile rather than as a 19.5pt square.
 *
 * The cap is set by the dense wall, not by the single-thickness one. Section
 * 5.0 originally specified 1.5 on the argument that every kind's tell lives
 * in its upper half, so losing the feet to the animal in front is survivable.
 * That argument holds for one row overlapping the next and does not survive
 * twenty adjacent cells: at 1.5 the widest adults also reach about 7px into
 * each *horizontal* neighbour, and a 5x4 block at the phone's true cell size
 * reads as one pile rather than as twenty dinosaurs. Rendered at 1.0, 1.15,
 * 1.25, 1.35 and 1.5 and chosen by looking: 1.25 is the largest value where
 * that block stays separable, and it still stands an adult a quarter of a
 * cell proud of its tile.
 */
export const DRAW_CELLS = 1.25;
/**
 * The HUD is the primitive, not the leftover. Its three rows cost
 * 96 + 40 + 136, and they cost that because of the 82px hit floor — so it
 * does not get to shrink because a map is short.
 */
export const HUD_H = 272;
/** The HUD anchors to the bottom of the canvas, never to the last grid row. */
export const HUD_Y = CANVAS_H - HUD_H; // 1008
/** The board *area*. The grid lives inside it and may be shorter than it. */
export const BOARD_H = HUD_Y;
export const GRID_H_MAX = Math.floor(BOARD_H / CELL_PX); // 28

/** Vertical offset of a grid of `gridH` cells, centred in the board area. */
export function gridTop(gridH: number): number {
  return Math.round((BOARD_H - gridH * CELL_PX) / 2);
}

/**
 * The reference phone: 390 x 844 CSS points, device pixel ratio 3 — an
 * iPhone 12/13/14/15/16 and the middle of the Android range. Phaser's FIT
 * mode scales the logical canvas uniformly to fit, so the scale is set by
 * whichever axis binds first. At 720x1280 into 390x844 the width binds.
 */
export const REF_DEVICE = { w: 390, h: 844, dpr: 3 } as const;
export const SCALE = Math.min(REF_DEVICE.w / CANVAS_W, REF_DEVICE.h / CANVAS_H);

/** Logical pixels to CSS points on the reference phone. */
export function pt(logical: number): number {
  return Math.round(logical * SCALE * 10) / 10;
}

/**
 * The minimum hit target. 44 CSS points is the floor in both Apple's and
 * Google's guidance; dividing back through the scale is where 82 comes
 * from, and it is the single most load-bearing number in this file. The
 * M2 HUD used 42px buttons, which is 22.8pt — half the floor.
 */
export const MIN_HIT = Math.ceil(44 / SCALE); // 82

export const GUTTER = 16;
export const CONTENT_W = CANVAS_W - GUTTER * 2; // 688

/**
 * The type scale. Nothing below `label`, because 19 logical px is already
 * only 10.3pt. The scale is short on purpose: four sizes, and the HUD says
 * less rather than smaller.
 */
export const TYPE = {
  vital: 34, // meat and egg counts
  title: 26, // a dinosaur's name, a result headline
  body: 22, // the migration preview, stat lines, button labels
  label: 19, // dim secondary labels only
} as const;

/**
 * The bitmap font in tools/art is 5x7 and only scales by whole numbers, so
 * the four type sizes are mapped onto four distinct scales by hand rather
 * than by a ratio that would round two of them together. The shipping HUD
 * uses the platform UI font at the px sizes in TYPE; this is the mock's
 * approximation of them.
 */
export function fontScale(size: number): number {
  return size >= 30 ? 5 : size >= 24 ? 4 : size >= 21 ? 3 : 2;
}

// ------------------------------------------------------------------ the rows

/**
 * Row 1, the vitals. A full-width build-timer bar across the very top of
 * the HUD, then meat, eggs, the migration counter, Send and the speed
 * toggle. The timer is a draining bar rather than digits so it is legible
 * without being read.
 */
export const ROW1 = {
  y: HUD_Y,
  h: 96,
  timerBar: { x: 0, y: HUD_Y, w: CANVAS_W, h: 8 },
  // Meat is allowed four digits before it reaches the egg icon, which is
  // the most a player sees in fifty migrations.
  meatIcon: { x: GUTTER, y: HUD_Y + 30, w: 34, h: 34 },
  meatValue: { x: GUTTER + 44, y: HUD_Y + 30 },
  eggIcon: { x: 192, y: HUD_Y + 30, w: 30, h: 34 },
  eggValue: { x: 230, y: HUD_Y + 30 },
  migrationLabel: { x: 320, y: HUD_Y + 26 },
  migrationValue: { x: 320, y: HUD_Y + 50 },
  send: { x: 444, y: HUD_Y + 11, w: 164, h: 82 },
  speed: { x: 622, y: HUD_Y + 11, w: 82, h: 82 },
} as const;

/**
 * Row 2, the next migration. One line, and the only place the kind chart is
 * ever shown mid-run: a kind chip whose hue and silhouette say what is
 * coming, then the archetype name and count. Information only, never
 * tappable, so 40px is allowed to be under the hit floor.
 */
export const ROW2 = {
  y: HUD_Y + 96,
  h: 40,
  chip: { x: GUTTER, y: HUD_Y + 102, w: 28, h: 28 },
  text: { x: GUTTER + 36, y: HUD_Y + 105 },
} as const;

/**
 * Row 3, the tray. One tray at a time: the six hatchlings while nothing is
 * selected, the dinosaur sheet while something is. Swapping rather than
 * stacking is what buys the hit targets — and tapping a dinosaur visibly
 * replacing the shop is how the player learns that growing exists without
 * being told.
 */
export const ROW3 = {
  y: HUD_Y + 136,
  h: 136,
  /** Six kind buttons: (688 - 5*6) / 6 = 109.6, floored. */
  kindButton: { y: HUD_Y + 144, w: 109, h: 120, gap: 6 },
  /**
   * The sheet's left column is 272px wide, which is 15 characters of body
   * type. That is not a coincidence: the longest dinosaur names in the
   * content are Argentinosaurus and Rhamphorhynchus, both 15. The genus is
   * the collectible, so it is not allowed to be truncated — the buttons
   * moved right until it fit.
   */
  sheetName: { x: GUTTER + 4, y: HUD_Y + 146, w: 272 },
  sheetKind: { x: GUTTER + 4, y: HUD_Y + 174 },
  sheetStats: { x: GUTTER + 4, y: HUD_Y + 196 },
  sheetExtras: { x: GUTTER + 4, y: HUD_Y + 224 },
  grow: { x: 300, y: HUD_Y + 163, w: 228, h: 82 },
  sell: { x: 540, y: HUD_Y + 163, w: 164, h: 82 },
} as const;

export function kindButtonX(i: number): number {
  return GUTTER + i * (ROW3.kindButton.w + ROW3.kindButton.gap);
}

/**
 * The selected kind card, which is how the player knows what the next tap on
 * the board will place. Three channels and none of them hue: the card lifts,
 * takes a border, and draws its silhouette larger. Hue is already spent on
 * *which* kind the card is, so it cannot also carry *selected*.
 *
 * Both numbers are derived, not picked. The border is 3 to match the ring a
 * selected dinosaur takes on the board, so the two selections read as one
 * idea. The lift is 5 because the card sits 8px inside its row
 * (`ROW3.kindButton.y` is `ROW3.y + 8`) and 5 + 3 is 8 — any more and the
 * border crosses into row 2, which is the migration line.
 */
export const SELECT_LIFT = 5;
export const SELECT_BORDER = 3;

/**
 * The toast. Refusals and events appear over the board just above the HUD,
 * near where the thumb just was, instead of taking a HUD row. It costs no
 * layout height and puts the message where the eye already is. It hugs the
 * HUD rather than the last grid row, so a short map does not strand it.
 */
export const TOAST = { x: GUTTER, y: HUD_Y - 76, w: CONTENT_W, h: 56 } as const;

/**
 * The results screen, over a scrim with the board still visible behind it.
 * `again` sits in the HUD band at the same height as Send, so the thumb
 * does not have to move between the run that ended and the next one.
 */
export const RESULTS = {
  headline: { y: 360 },
  cleared: { y: 440 },
  eggsKept: { y: 520 },
  meatUnspent: { y: 520 },
  fossils: { y: 600 },
  /** Every dinosaur grown to adult, as its sprite, in a row. */
  pack: { x: GUTTER, y: 680, w: CONTENT_W, h: 180 },
  again: { x: Math.round((CANVAS_W - 328) / 2), y: HUD_Y + 11, w: 328, h: 82 },
} as const;

/** Everything a reviewer should be able to check, as one table. */
export function layoutTable(): { what: string; logical: string; points: string }[] {
  const box = (b: { w: number; h: number }) => `${b.w}x${b.h}`;
  const both = (b: { w: number; h: number }) => `${pt(b.w)}x${pt(b.h)}`;
  return [
    { what: "logical canvas", logical: `${CANVAS_W}x${CANVAS_H}`, points: `${pt(CANVAS_W)}x${pt(CANVAS_H)}` },
    { what: "build grid", logical: `${GRID_W}x<=${GRID_H_MAX} cells of ${CELL_PX}`, points: `cell ${pt(CELL_PX)}` },
    { what: "board area", logical: `${CANVAS_W}x${BOARD_H}`, points: `${pt(CANVAS_W)}x${pt(BOARD_H)}` },
    { what: "HUD", logical: `${CANVAS_W}x${HUD_H}`, points: `${pt(CANVAS_W)}x${pt(HUD_H)}` },
    { what: "hit-target floor", logical: `${MIN_HIT}`, points: `${pt(MIN_HIT)}` },
    { what: "Send", logical: box(ROW1.send), points: both(ROW1.send) },
    { what: "speed toggle", logical: box(ROW1.speed), points: both(ROW1.speed) },
    { what: "kind button", logical: box(ROW3.kindButton), points: both(ROW3.kindButton) },
    { what: "Grow", logical: box(ROW3.grow), points: both(ROW3.grow) },
    { what: "Sell", logical: box(ROW3.sell), points: both(ROW3.sell) },
    { what: "Again (results)", logical: box(RESULTS.again), points: both(RESULTS.again) },
    { what: "type: vital", logical: `${TYPE.vital}`, points: `${pt(TYPE.vital)}` },
    { what: "type: title", logical: `${TYPE.title}`, points: `${pt(TYPE.title)}` },
    { what: "type: body", logical: `${TYPE.body}`, points: `${pt(TYPE.body)}` },
    { what: "type: label (dim only)", logical: `${TYPE.label}`, points: `${pt(TYPE.label)}` },
  ];
}
