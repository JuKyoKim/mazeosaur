// The layout the spec and the sample frames are drawn from — which is the
// same layout the game ships, because this file re-exports it rather than
// restating it.
//
// `packages/game/src/layout.ts` is the single home for the logical-canvas
// geometry and the HUD boxes. The two things below are genuinely the mock's
// and not the game's: `fontScale()` exists because this generator draws with
// a 5x7 bitmap font, and `layoutTable()` is the reviewer's table.
//
// Direction of the dependency: `tools/` imports `packages/`, never the
// reverse. Nothing that ships gains a dependency from this file existing.

export * from "@mazeosaur/game/layout";

import {
  BOARD_H,
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  GRID_H_MAX,
  GRID_W,
  HUD_H,
  MIN_HIT,
  RESULTS,
  ROW1,
  ROW3,
  TYPE,
  pt,
} from "@mazeosaur/game/layout";

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
