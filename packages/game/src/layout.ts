// The logical canvas and the v1 HUD layout, as numbers. This is the one
// place they are declared: the client draws from this file, the mock in
// `tools/art` re-exports it, and `docs/01-art-hud-and-audio.md` is generated
// from the mock. A number can therefore not be true in the spec and false on
// screen — change it here and the picture, the reviewer's table and the game
// all move together.
//
// Coordinate space is 720 x 1280 with 36px cells: the HUD is the bottom 272px
// and the board area is the 720 x 1008 above it. The grid is drawn inside the
// board area and may be shorter than it; the HUD never moves to meet it.
//
// Every length is a logical pixel. `pt()` converts to the CSS points a
// 390pt-wide phone actually shows, which is the number that decides whether a
// hit target is big enough and whether type is readable.
//
// Colour is not here; it is in `./theme.ts`. Nothing in this file imports
// anything, which is what lets `tools/art` read it from Node with no Phaser.

/** Logical canvas. Portrait; scaled to fit whatever screen mounts it. */
export const CANVAS_W = 720;
export const CANVAS_H = 1280;
/** Pixels per grid cell on the logical canvas: 20 cells * 36 = 720. */
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

/**
 * Vertical offset of a grid of `gridH` cells, centred in the board area.
 * Not a multiple of `CELL_PX` in general — 28 cells give 0 but 27 give 18 —
 * so a pointer-to-cell mapping must subtract this *before* dividing by
 * `CELL_PX`, never after. Use `rowAt()` and let it do that.
 */
export function gridTop(gridH: number): number {
  return Math.round((BOARD_H - gridH * CELL_PX) / 2);
}

/**
 * Canvas y to grid row, or null for a point outside the grid.
 *
 * The inset is subtracted before the divide, which is the whole reason this
 * lives here rather than being written out at its call site: an integer
 * divide alone is right for the 28-row valley that ships and one row out for
 * any other, and a cell one row away from the finger reads as a
 * drag-interpolation bug — the most expensive kind of wrong thing to look
 * for.
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
/** The right edge of the content column: nothing in the HUD passes it. */
export const CONTENT_RIGHT = GUTTER + CONTENT_W; // 704

/**
 * The dinosaur sheet's text column, and the wrap width every one of its
 * four lines is given. One number for all four slots on purpose: a sheet
 * line allowed to be wider than the column is a line that runs under the
 * Grow button, which is the defect this constant exists to prevent.
 *
 * It was 272, which was 15 characters of `TYPE.body` by hand — the longest
 * genus in the content, Argentinosaurus and Rhamphorhynchus, both 15 —
 * because the genus is the collectible and must not truncate. That premise
 * was right and the number was not, for two reasons. The genus is drawn at
 * `TYPE.title`, not `TYPE.body`; and the genus is not the widest line in
 * the column. Measured in the real client at the real type sizes, over all
 * 18 defs: name 242, kind 179, stats 264, extras 296. The widest is the
 * modifier line of a longneck adult, `hits ground · splash · slow 45%`.
 *
 * 304 is that 296 plus a little, and it is a measurement rather than an
 * estimate: `tests/client/dino-sheet.spec.ts` re-takes it on every run and
 * fails if a content edit pushes a line past it.
 *
 * Read those four px figures as an ordering, not as a budget. They are
 * whatever face one box resolved `system-ui` to; a second box resolved a
 * narrower one and measured the same four lines at 189 / 145 / 187 / 239 —
 * not a scale factor, a different font. The portable facts are the ordering
 * (the modifier line is the widest, and the genus is not), the assertion
 * the spec actually enforces (every line `<= SHEET_COL_W` in whatever font
 * the client resolves), and the character caps in
 * `packages/game/test/sheet.test.ts`, which fire in under a second when a
 * content edit lengthens a line.
 */
export const SHEET_COL_W = 304;

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

// ------------------------------------------------------------------ the rows

/**
 * Row 1, the vitals. A full-width build-timer bar across the very top of
 * the HUD, then meat, eggs, the migration counter, and the three clock
 * controls: Send, Pause and the speed toggle. The timer is a draining bar
 * rather than digits so it is legible without being read.
 *
 * The three controls are 82 wide each because that is the only width three
 * of them fit in at the hit floor, not because 82 looked right. Their band
 * is fixed at both ends — the migration readout's own widest value ends at
 * 428 and needs Send's origin to stay at 444, and the row's right edge is
 * `CONTENT_RIGHT` — so 260px carry 3 * `MIN_HIT` = 246 and two 7px gaps,
 * with nothing left over. Send gave up the 82 Pause needed because it was
 * the only control in the row with any to give: it was 164 wide against a
 * floor of 82, and everything else here is either at the floor already or
 * a text field whose own measured clearance is 8 or 16px (§4). What it
 * cost is Send's bonus label, which is now two lines (`Send` over `+25`)
 * exactly as Grow and Sell already are.
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
  send: { x: 444, y: HUD_Y + 11, w: MIN_HIT, h: MIN_HIT },
  pause: { x: 533, y: HUD_Y + 11, w: MIN_HIT, h: MIN_HIT },
  speed: { x: 622, y: HUD_Y + 11, w: MIN_HIT, h: MIN_HIT },
} as const;

/**
 * Where each variable-length row-1 field is wrapped: at the origin of
 * whatever sits to its right.
 *
 * Section 4 of `docs/01-art-hud-and-audio.md` measures the widest value of
 * each field and shows it clearing its neighbour — meat's `9999` ends at
 * 148 against the egg icon at 192. That measurement is the design, and
 * these are the enforcement: a wrap of `W` means no line of the field can
 * be wider than `W`, so its right edge cannot pass `x + W` whatever the
 * string turns out to be. Without them row 1 is five variable fields on
 * 720px that over-subscribe themselves *silently* — the HUD draws two
 * strings on top of each other rather than failing — and the failure
 * arrives on a content edit nobody connects to the HUD.
 *
 * Wrapping rather than clipping or shrinking is deliberate: a wrapped
 * count is ugly and visible, which is what sends somebody back here.
 */
export const ROW1_WRAP = {
  meat: ROW1.eggIcon.x - ROW1.meatValue.x, // 132
  eggs: ROW1.migrationLabel.x - ROW1.eggValue.x, // 90
  migration: ROW1.send.x - ROW1.migrationValue.x, // 124
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
  /**
   * The archetype and kind, dim and right-aligned to the content edge, as
   * section 4 specifies. Anchored to the right rather than placed after
   * the line to its left, because both strings are variable: `text` is a
   * count and a genus and this is `regenerator · longneck` at its widest.
   * Two variable fields facing each other need two fixed edges and a wrap
   * each, which is what `w` and `ROW2.textWrap` are.
   *
   * `y` is 2px below `text`'s so the two baselines line up: this is
   * `TYPE.label` against `TYPE.body` and the sizes differ by 3.
   */
  meta: { right: CONTENT_RIGHT, y: HUD_Y + 107, w: 232 },
} as const;

/**
 * The migration line's own wrap: everything between its origin and the
 * meta block's left edge, less a 12px gutter. Same reason as
 * `ROW1_WRAP` — the strings are content, so the bound has to be geometry.
 */
export const ROW2_TEXT_WRAP = ROW2.meta.right - ROW2.meta.w - 12 - ROW2.text.x; // 412

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
   * What is inside a kind card: the silhouette, the kind name, the cost.
   * All three are offsets from `kindButton.y`, because the card lifts when
   * it is selected and a lifted card has to carry its contents with it.
   *
   * 56 and 60 are section 4's selection table — the silhouette is the
   * third of the three selection channels, and 60/56 is the 1.08 it
   * specifies. The three `dy` values spend the card's 120px top to bottom:
   * 10 + 56 of art, the name at 70, the cost at 94, and 94 + `TYPE.label`
   * is 113, which leaves 7px of bottom margin.
   */
  kindArt: { w: 56, h: 56, dy: 10, selectedW: 60 },
  kindName: { dy: 70 },
  /** The cost, as a meat pip and a number centred on the card together. */
  kindCost: { dy: 94, pipR: 5, pipGap: 10 },
  /**
   * The sheet's four lines, all in the same `SHEET_COL_W` column — see
   * that constant for where the number comes from. Four slots and not one
   * string: the genus, the family and stage, the comparable numbers, the
   * modifiers. `sheet.ts` builds them.
   */
  sheetName: { x: GUTTER + 4, y: HUD_Y + 146, w: SHEET_COL_W },
  sheetKind: { x: GUTTER + 4, y: HUD_Y + 174, w: SHEET_COL_W },
  sheetStats: { x: GUTTER + 4, y: HUD_Y + 196, w: SHEET_COL_W },
  sheetExtras: { x: GUTTER + 4, y: HUD_Y + 224, w: SHEET_COL_W },
  /**
   * Grow begins where the sheet column ends plus a 12px gutter: 20 + 304 +
   * 12. It gave up 36px of its own width to it and still clears the hit
   * floor three times over, which is the right trade — a button that is
   * 104pt instead of 123pt is the same button, and a modifier line that
   * runs under it is unreadable.
   */
  grow: { x: 336, y: HUD_Y + 163, w: 192, h: 82 },
  sell: { x: 540, y: HUD_Y + 163, w: 164, h: 82 },
} as const;

/*
 * Row 3's buttons deliberately have no `ROW1_WRAP` twin. A wrap is what
 * bounds row 1, where the over-long thing is a field with spaces in it; the
 * over-long thing on Grow is a single genus, and Phaser's `wordWrap` breaks
 * on spaces only. Measured in a client: `Micropachycephalosaurus` on its
 * own line draws 247px in the 192px `ROW3.grow` with a 180px wrap set and
 * 247px with none. The wrap would read as a bound it is not.
 *
 * What bounds these two is `sheet.ts`'s `growLabel` — one fact per line, so
 * the genus is measured alone rather than after `Grow → ` — and
 * `tests/client/hud-hit-targets.spec.ts`, which re-measures the label in a
 * running client at every genus the content can grow into. A genus longer
 * than today's longest fails there with the px, which is the conversation
 * to have (shorten the display name) rather than something the renderer
 * can quietly absorb.
 */

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
export const TOAST = {
  x: GUTTER,
  y: HUD_Y - 76,
  w: CONTENT_W,
  h: 56,
  /**
   * The bar down the left edge that a refusal gets and an event does not,
   * per section 4. 3px is `SELECT_BORDER` — the same weight as every other
   * mark this HUD makes, so the toast is not a fourth line width.
   */
  barW: 3,
  /** The text inset, clear of the bar. */
  pad: 16,
} as const;

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

/**
 * The pause menu, centred in the board area with the board still visible
 * behind its scrim. Three entries — back to the run, start it over, stop
 * playing it — each `MIN_HIT` tall with 14px between them, which is more
 * separation than any two controls in the HUD get and is deliberate: the
 * third entry throws the run away, so this is the one menu in the client
 * where a mis-tap is unrecoverable.
 *
 * `RESULTS.again`'s width and x, not its own 328: the pause menu and the
 * results screen are the same shape of thing in the same place, and a
 * player who ends a run from here lands on that screen with the button
 * under the same thumb. One number, so they cannot drift apart.
 */
export const PAUSE_MENU = {
  title: { y: 328 },
  sub: { y: 388 },
  x: RESULTS.again.x,
  w: RESULTS.again.w,
  h: MIN_HIT,
  resume: { y: 432 },
  restart: { y: 432 + MIN_HIT + 14 },
  end: { y: 432 + (MIN_HIT + 14) * 2 },
} as const;
