// The mock's view of the HUD layout.
//
// The geometry itself is not declared here. It lives in
// packages/game/src/layout.ts, which is what the shipping client draws
// from, and this file re-exports it so the sample frames and the generated
// table in docs/01-art-hud-and-audio.md are evidence about the real HUD
// rather than about a second set of numbers that happens to agree. A mock
// that is free to disagree with the thing it attests to is not evidence.
//
// What stays here is only what is the mock's own: the bitmap font's scale
// ladder, and the reviewer's table.

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
