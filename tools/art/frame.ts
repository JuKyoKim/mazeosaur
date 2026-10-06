// A sample frame of the actual board.
//
// The board state is not mocked: this runs the real @mazeosaur/sim against
// the real @mazeosaur/content, paints a real maze with real `place`
// commands (so every wall in the picture is a wall the block check allows),
// sends a real migration and ticks it. Only the rasteriser differs from the
// shipping client — Phaser is not available in Node — and it draws at the
// same 720x1280 logical canvas with the same 36px cells.
//
// The one lie is the meat: the scene sets `state.meat` directly so a frame
// can show a mid-game maze without replaying twenty migrations. It is
// marked where it happens.

import { CELL, Game, type Dino, type Invader } from "@mazeosaur/sim";
import { content } from "@mazeosaur/content";
import { sheetLines } from "@mazeosaur/game/sheet";
import { clipFrames, type Clip } from "./animate.js";
import { ARCHETYPE_SILHOUETTE, type Archetype } from "./bestiary.js";
import { BOARD, KIND_HUE, KINDS, type Direction, type Kind } from "./directions.js";
import { CAP_H, GLYPH_W, glyph } from "./font.js";
import {
  BOARD_H,
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  DRAW_CELLS,
  GUTTER,
  HUD_Y,
  ROW1,
  ROW2,
  ROW3,
  SELECT_BORDER,
  SELECT_LIFT,
  TOAST,
  TYPE,
  fontScale,
  gridTop,
  kindButtonX,
} from "./layout.js";
import { Raster, ellipse, rect, subtract, taper, union, darken, lighten, mix, rgb, type Rgb, type Shape } from "./raster.js";
import { INVADER_BOX_CELLS, dinoSprite, inkBox, invaderSprite, renderParts, strikeSprite } from "./sprites.js";
import { STRIKE_FRAMES, STRIKE_NAME, STRIKE_SEQUENCE } from "./strikes.js";

// ------------------------------------------------------------------ helpers

function roundRect(x: number, y: number, w: number, h: number, r: number): Shape {
  const rr = Math.min(r, w / 2, h / 2);
  return union(
    rect(x + rr, y, w - 2 * rr, h),
    rect(x, y + rr, w, h - 2 * rr),
    ellipse(x + rr, y + rr, rr, rr),
    ellipse(x + w - rr, y + rr, rr, rr),
    ellipse(x + rr, y + h - rr, rr, rr),
    ellipse(x + w - rr, y + h - rr, rr, rr),
  );
}

/** `s` kept only where it lands inside `box`: `s` minus everything outside. */
function clip(s: Shape, box: Shape): Shape {
  return subtract(s, subtract(rect(-9e3, -9e3, 1.8e4, 1.8e4), box));
}

function ring(cx: number, cy: number, r: number, width: number): Shape {
  return {
    bbox: [cx - r - width, cy - r - width, cx + r + width, cy + r + width],
    contains(x, y) {
      const d = Math.hypot(x - cx, y - cy);
      return d <= r + width / 2 && d >= r - width / 2;
    },
    expand(k) {
      return ring(cx, cy, r, width + 2 * k);
    },
  };
}

type Align = "left" | "right" | "center";

/** Draw a string with the 5x7 font. `y` is the top of the cap height. */
function drawText(r: Raster, x: number, y: number, s: string, size: number, c: Rgb, align: Align = "left"): number {
  const k = fontScale(size);
  const advance = (GLYPH_W + 1) * k;
  const chars = [...s];
  const width = chars.length * advance - k;
  const x0 = align === "left" ? x : align === "right" ? x - width : x - Math.round(width / 2);
  chars.forEach((ch, i) => {
    const g = glyph(ch);
    if (!g) return;
    g.forEach((row, ry) => {
      row.forEach((on, rx) => {
        if (!on) return;
        r.fill(rect(x0 + i * advance + rx * k, y + ry * k, k, k), c, 1, 1);
      });
    });
  });
  return width;
}

/** Cap-height box for a size, so text can be centred in a button. */
function capHeight(size: number): number {
  return CAP_H * fontScale(size);
}

/** What `drawText` will come to, without drawing it. */
function textWidth(s: string, size: number): number {
  const k = fontScale(size);
  return [...s].length * (GLYPH_W + 1) * k - k;
}

/**
 * The largest size in the scale at which `s` fits `maxWidth`.
 *
 * The 5x7 font advances a fixed `GLYPH_W + 1` units per character, so at a
 * given nominal size it is around half again as wide as the proportional UI
 * font the client draws with — `153.8 dmg/s · range 2.6` is 264px in the
 * running client at `TYPE.body` and 411 here. A string that fits the real
 * HUD can therefore still overrun the mock's, and when it does the honest
 * move is to draw it smaller, not to cut it: the figure then shows the same
 * words the player sees. The sheet lines used to be truncated to 23
 * characters instead, which made the picture a picture of a sheet the game
 * never draws.
 *
 * Returns the smallest size in the scale when nothing fits; `wrapTo` is for
 * the lines that still do not.
 */
function fitSize(s: string, size: number, maxWidth: number): number {
  const steps = [34, 26, 22, 19];
  for (const step of steps) {
    if (step > size) continue;
    if (textWidth(s, step) <= maxWidth) return step;
  }
  return 19;
}

/** `s` broken on spaces into rows no wider than `maxWidth`. */
function wrapTo(s: string, size: number, maxWidth: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of s.split(" ")) {
    const next = row ? `${row} ${word}` : word;
    if (row && textWidth(next, size) > maxWidth) {
      rows.push(row);
      row = word;
    } else {
      row = next;
    }
  }
  if (row) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------- icons

/** A chunk of meat: a blob with a bone end. The meat counter's second channel. */
function meatIcon(r: Raster, x: number, y: number, w: number, h: number): void {
  const c = BOARD.meat;
  r.fill(ellipse(x + w * 0.44, y + h * 0.55, w * 0.36, h * 0.33, -0.3), darken(c, 0.15));
  r.fill(ellipse(x + w * 0.4, y + h * 0.48, w * 0.3, h * 0.24, -0.3), c);
  r.fill(ellipse(x + w * 0.78, y + h * 0.26, w * 0.17, h * 0.17), rgb(0xf2e8d8));
  r.fill(ellipse(x + w * 0.9, y + h * 0.4, w * 0.15, h * 0.15), rgb(0xf2e8d8));
  r.fill(taper(x + w * 0.62, y + h * 0.42, x + w * 0.84, y + h * 0.3, w * 0.07), rgb(0xf2e8d8));
}

/** An egg, slightly ovoid, with a speckle. The egg counter's second channel. */
function eggIcon(r: Raster, x: number, y: number, w: number, h: number, cracked = false): void {
  const c = cracked ? mix(BOARD.eggs, BOARD.refusal, 0.5) : BOARD.eggs;
  r.fill(ellipse(x + w / 2, y + h * 0.56, w * 0.42, h * 0.44), darken(c, 0.22));
  r.fill(ellipse(x + w / 2, y + h * 0.52, w * 0.36, h * 0.4), c);
  r.fill(ellipse(x + w * 0.4, y + h * 0.36, w * 0.1, h * 0.09), lighten(c, 0.6));
}

/** The archetype chip on the next-migration strip: hue plus silhouette. */
function kindChip(r: Raster, x: number, y: number, w: number, h: number, kind: Kind, archetype: Archetype, d: Direction): void {
  r.fill(roundRect(x, y, w, h, 5), darken(rgb(KIND_HUE[kind]), 0.55));
  r.fill(roundRect(x + 1, y + 1, w - 2, h - 2, 4), mix(rgb(KIND_HUE[kind]), BOARD.hud, 0.55));
  const parts = ARCHETYPE_SILHOUETTE[archetype](d.proportions);
  const thumb = renderParts(parts, d, d.palette(KIND_HUE[kind]), Math.min(w, h) - 2);
  r.blit(thumb, x + 1, y + 1);
}

// -------------------------------------------------------------- sprite cache

class Sheet {
  private dinos = new Map<string, Raster>();
  private invaders = new Map<string, Raster>();

  /**
   * `phase` draws every dinosaur on one frame of one clip instead of at rest
   * — the whole board mid-breath, or mid-lunge. It is per-sheet rather than
   * per-call because a frame of the board is one instant: a plate where half
   * the maze is breathing and half is not would be a prettier picture and a
   * dishonest one.
   *
   * Invaders are unaffected. They move continuously, so their animation is a
   * walk cycle, which is a different piece of work (section 5.6).
   */
  constructor(
    readonly d: Direction,
    readonly phase?: { clip: Clip; index: number },
  ) {}

  dino(kind: Kind, stage: 1 | 2 | 3): Raster {
    const key = `${kind}${stage}`;
    let s = this.dinos.get(key);
    if (!s) {
      s = dinoSprite(kind, stage, this.d);
      if (this.phase) s = clipFrames(s, this.phase.clip, this.d.palette(KIND_HUE[kind]))[this.phase.index] ?? s;
      this.dinos.set(key, s);
    }
    return s;
  }

  invader(archetype: Archetype, kind: Kind): Raster {
    const key = `${archetype}:${kind}`;
    let s = this.invaders.get(key);
    if (!s) {
      s = invaderSprite(archetype, kind, this.d);
      this.invaders.set(key, s);
    }
    return s;
  }
}

/**
 * Draw a sprite centred on a point at a target box size. The sprite is
 * authored square; `box` is the on-board size in logical pixels, which is
 * how a hatchling and an adult differ on screen as well as in the art.
 */
function blitScaled(dst: Raster, src: Raster, cx: number, cy: number, box: number, alpha = 1): void {
  const s = box / src.w;
  const x0 = Math.round(cx - box / 2);
  const y0 = Math.round(cy - box / 2);
  for (let y = 0; y < Math.round(box); y++) {
    for (let x = 0; x < Math.round(box); x++) {
      // Box-average the source footprint of this destination pixel: the
      // honest downsample, and the reason the vector directions can be
      // authored at 48px and still look clean in a 36px cell.
      const sx0 = x / s;
      const sx1 = (x + 1) / s;
      const sy0 = y / s;
      const sy1 = (y + 1) / s;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); sx++) {
          if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
          const [pr, pg, pb, pa] = src.get(sx, sy);
          const wgt = pa / 255;
          rr += pr * wgt;
          gg += pg * wgt;
          bb += pb * wgt;
          aa += wgt;
          n++;
        }
      }
      if (!n || aa <= 0) continue;
      dst.blend(x0 + x, y0 + y, [rr / aa, gg / aa, bb / aa], (aa / n) * alpha);
    }
  }
}


/**
 * Draw a dinosaur into the cell it occupies, under section 5.0's anchor.
 *
 * The authored square is scaled so it spans `DRAW_CELLS` cells, the ink's
 * bottom edge is put on the cell's bottom edge, and the ink is centred
 * horizontally on the cell. The footprint the sim sees is untouched; only
 * the draw box is taller, and that is what makes a solid stand proud of its
 * tile instead of being cropped to it.
 *
 * The anchor is on the ink rather than on the square because the camera
 * centres its subject — see `inkBox`. The horizontal consequence is real and
 * measured: at 1.5 cells the widest adult (`flier-3`, 60px of ink in a 64px
 * square) draws 50px wide into a 36px cell, so it reaches about 7px into each
 * neighbour. That is the same overlap as the vertical one and reads the same
 * way; it is why the caller sorts within a row as well as between rows.
 */
function blitAnchored(dst: Raster, src: Raster, cellX0: number, cellY0: number, alpha = 1): void {
  const box = CELL_PX * DRAW_CELLS;
  const s = box / src.w;
  const ink = inkBox(src);
  // blitScaled takes the centre of the scaled square, so convert from the
  // edges we actually care about.
  const left = cellX0 + CELL_PX / 2 - (ink.x + ink.w / 2) * s;
  const top = cellY0 + CELL_PX - (ink.y + ink.h) * s;
  blitScaled(dst, src, left + box / 2, top + box / 2, box, alpha);
}

/**
 * A pale halo in the shape of a sprite, drawn under it. This is the
 * ownership channel doing its second job: the player's dinosaurs sit in
 * filled wall blocks and are deliberately one value step back, and
 * everything alive and moving — invaders — is rimmed so it separates from
 * a wall of the same hue. Migration 49 is a `raptor` migration crossing a
 * maze that is half amber raptor walls, which is the worst case the
 * content can produce, and it is the case this exists for.
 */
function haloBlit(dst: Raster, src: Raster, cx: number, cy: number, box: number, c: Rgb, grow = 2): void {
  const n = Math.round(box);
  const x0 = Math.round(cx - box / 2);
  const y0 = Math.round(cy - box / 2);
  const s = src.w / box;
  const opaque = (dx: number, dy: number) => {
    const sx = Math.floor(dx * s);
    const sy = Math.floor(dy * s);
    return sx >= 0 && sy >= 0 && sx < src.w && sy < src.h && src.get(sx, sy)[3] > 110;
  };
  for (let y = -grow; y < n + grow; y++) {
    for (let x = -grow; x < n + grow; x++) {
      if (opaque(x, y)) continue;
      let near = false;
      for (let ky = -grow; ky <= grow && !near; ky++) {
        for (let kx = -grow; kx <= grow; kx++) {
          if (kx * kx + ky * ky > grow * grow + 1) continue;
          if (opaque(x + kx, y + ky)) {
            near = true;
            break;
          }
        }
      }
      if (near) dst.blend(x0 + x, y0 + y, c, 0.85);
    }
  }
}

// -------------------------------------------------------------- scene set-up

export interface SceneOptions {
  /** Which migration to show, 1-based, as the player would count it. */
  migration: number;
  /** Ticks to run after sending, which decides how far along the maze they are. */
  ticks: number;
  meat: number;
  eggs: number;
  /** Shown selected, so the frame includes the dinosaur sheet instead of the shop. */
  selectSheet: boolean;
  /** Which animation frame every dinosaur is drawn on; at rest if absent. */
  phase?: { clip: Clip; index: number };
}

/**
 * The maze. A comb of horizontal walls with alternating gaps, which is what
 * a competent player actually builds on this valley: it forces the lane to
 * switch back on itself between every checkpoint. Placements are attempted
 * and refusals ignored, so the block check — not this function — decides
 * what ends up on the board.
 */
function paintMaze(g: Game): void {
  // Half the wall is raptors because the raptor hatchling is the cheapest
  // cell on the board and that is what a maze is actually built out of; the
  // rest is spread so every kind appears often enough to be compared.
  const order: Kind[] = ["raptor", "tyrant", "raptor", "horned", "raptor", "armored", "raptor", "longneck", "raptor", "flier"];
  const place = (x: number, y: number, kind: Kind) => g.apply({ type: "place", defId: `${kind}-1`, x, y });

  // A boustrophedon comb: a wall every third row, 18 cells long, with the
  // gap alternating ends. The lane has to run the full width of the valley
  // between every pair of walls, which is the whole point of mazing.
  let n = 0;
  for (let y = 2; y <= 25; y += 3) {
    const gapOnRight = ((y - 2) / 3) % 2 === 0;
    for (let i = 0; i < 18; i++) {
      const x = gapOnRight ? i : 19 - i;
      place(x, y, order[n++ % order.length] as Kind);
    }
  }
  // Teeth hanging off three of the walls, so the corridor is not a uniform
  // two cells wide and the picture does not look like graph paper.
  for (const [y, xs] of [
    [3, [2, 6, 10, 14]],
    [12, [5, 9, 13, 17]],
    [21, [3, 7, 11, 15]],
  ] as [number, number[]][]) {
    for (const x of xs) place(x, y, order[n++ % order.length] as Kind);
  }
  // The damage: grown dinosaurs in the corridor itself, at the turns, which
  // is where a real player spends meat rather than on more wall.
  const anchors: [number, number, Kind, 2 | 3][] = [
    [2, 1, "horned", 2],
    [17, 4, "tyrant", 3],
    [1, 7, "armored", 2],
    [16, 7, "flier", 2],
    [2, 10, "longneck", 3],
    [11, 10, "tyrant", 2],
    [17, 13, "horned", 3],
    [4, 16, "armored", 3],
    [13, 16, "flier", 3],
    [2, 19, "tyrant", 2],
    [16, 19, "longneck", 2],
    [6, 22, "horned", 2],
    [17, 22, "armored", 2],
    [10, 26, "flier", 3],
  ];
  for (const [x, y, kind, stage] of anchors) {
    place(x, y, kind);
    const d = g.dinoAt(x, y);
    if (!d) continue;
    for (let s = 1; s < stage; s++) g.apply({ type: "grow", dinoId: d.id });
  }
}

export interface Scene {
  game: Game;
  sheet: Sheet;
  selected: Dino | null;
  opts: SceneOptions;
  /** The cell the sim refuses as sealing the maze, found once and reused. */
  refusedAt?: { x: number; y: number };
}

export function buildScene(d: Direction, opts: SceneOptions): Scene {
  const g = new Game(content, 20260402);
  // The lie, declared: a frame has to show a mid-game board without
  // replaying twenty migrations, so the meat is set rather than earned.
  // Every placement below still goes through the real command path.
  g.state.meat = 100000;
  paintMaze(g);
  g.state.meat = opts.meat;
  g.state.eggs = opts.eggs;
  g.state.migration = opts.migration - 1;
  g.drainEvents();
  g.apply({ type: "send" });
  for (let i = 0; i < opts.ticks; i++) g.tick();
  g.drainEvents();

  const sheet = new Sheet(d, opts.phase);
  const selected = opts.selectSheet ? (g.state.dinos.find((x) => g.dinoDef(x).stage === 3) ?? null) : null;
  return { game: g, sheet, selected, opts };
}

// ------------------------------------------------------------------- drawing

function drawBoard(r: Raster, scene: Scene): void {
  const { game: g, sheet } = scene;
  const v = content.valley;

  // The board area is the whole band above the HUD; the grid is drawn inside
  // it at GRID_TOP, which is 0 for the 28-tall valley that ships.
  const gridPxH = v.height * CELL_PX;
  r.fill(rect(0, 0, CANVAS_W, BOARD_H), BOARD.boardBg, 1, 1);
  for (let x = 0; x <= v.width; x++) r.fill(rect(x * CELL_PX, GRID_TOP, 1, gridPxH), BOARD.gridLine, 1, 1);
  for (let y = 0; y <= v.height; y++) r.fill(rect(0, GRID_TOP + y * CELL_PX, CANVAS_W, 1), BOARD.gridLine, 1, 1);

  const mark = (p: { x: number; y: number }, c: Rgb, label: string) => {
    const b = cellTopLeft(p.x, p.y);
    r.fill(roundRect(b.x + 2, b.y + 2, CELL_PX - 4, CELL_PX - 4, 4), c);
    drawText(r, b.x + CELL_PX / 2, b.y + 12, label, 22, rgb(0x16211a), "center");
  };
  mark(v.lane.spawn, BOARD.spawn, "S");
  v.lane.checkpoints.forEach((c, i) => mark(c, BOARD.checkpoint, String(i + 1)));
  mark(v.lane.exit, BOARD.nest, "N");

  // Dinosaurs, drawn back to front so a tall longneck overlaps the row
  // behind. Increasing x inside a row for the same reason: at 1.5 cells the
  // widest adults overlap their neighbours sideways too, and an overlap
  // drawn in placement order would change the picture when the player
  // rebuilt the same wall.
  const dinos = [...g.state.dinos].sort((a, b) => a.y - b.y || a.x - b.x);
  // Every block first, then every animal. A sprite now overhangs the cell
  // behind it, so a block painted later would erase the feet of the one in
  // front — the tiles are the floor and have to be finished before anything
  // stands on them.
  for (const dn of dinos) {
    const def = g.dinoDef(dn);
    const { x: x0, y: y0 } = cellTopLeft(dn.x, dn.y);
    const hue = rgb(KIND_HUE[def.kind]);
    // The block. Towers are the walls, so a dinosaur's cell is drawn as a
    // filled block in a dark tint of its kind, with a lit top edge and a
    // shadowed bottom. This is the single most important thing on the
    // board: it is what makes a maze look like a maze rather than like
    // scattered animals, and it is the ownership channel — an invader
    // never has a cell, so "mine" and "theirs" is a shape difference that
    // survives a 20pt cell and a colour-blind eye.
    r.fill(rect(x0 + 1, y0 + 1, CELL_PX - 1, CELL_PX - 1), darken(hue, 0.72), 1, 1);
    r.fill(rect(x0 + 1, y0 + 1, CELL_PX - 1, 2), darken(hue, 0.5), 1, 1);
    r.fill(rect(x0 + 1, y0 + CELL_PX - 3, CELL_PX - 1, 2), darken(hue, 0.84), 1, 1);
    // Growth stage as pips along the bottom of the block: a count of
    // shapes, so the stage is readable without colour and without digits.
    // On the block rather than on the animal, because the animal is the
    // thing that moves off its tile.
    for (let i = 0; i < def.stage; i++) {
      r.fill(ellipse(x0 + 7 + i * 7, y0 + CELL_PX - 5, 2.1, 2.1), rgb(0xf6f3ea), 0.95);
    }
  }
  for (const dn of dinos) {
    const def = g.dinoDef(dn);
    const { x: x0, y: y0 } = cellTopLeft(dn.x, dn.y);
    blitAnchored(r, sheet.dino(def.kind, def.stage), x0, y0, 0.93);
  }

  // invaders
  for (const inv of g.state.invaders) {
    const def = g.invaderDef(inv);
    const cx = (inv.px * CELL_PX) / CELL;
    const cy = GRID_TOP + (inv.py * CELL_PX) / CELL;
    const box = CELL_PX * INVADER_BOX_CELLS(def.archetype);
    if (inv.flying) {
      // a ground shadow, so height reads without a legend
      r.fill(ellipse(cx, cy + 13, box * 0.3, box * 0.11), rgb(0x0b120d), 0.45);
    } else {
      r.fill(ellipse(cx, cy + box * 0.34, box * 0.3, box * 0.09), rgb(0x0b120d), 0.3);
    }
    const sprite = sheet.invader(def.archetype, def.kind);
    const sy = cy - (inv.flying ? 5 : 0);
    haloBlit(r, sprite, cx, sy, box, rgb(0xf4f1e6), def.archetype === "boss" ? 3 : 2);
    blitScaled(r, sprite, cx, sy, box);

    if (inv.slowUntil > g.state.tick) r.fill(ring(cx, cy, box * 0.44, 2.5), BOARD.slow, 0.95);
    if (inv.stunUntil > g.state.tick) r.fill(ring(cx, cy, box * 0.54, 2.5), BOARD.stun, 0.95);
    if (inv.shield > 0) r.fill(ring(cx, cy, box * 0.48, 3), BOARD.shield, 0.9);

    const bw = Math.round(box * 0.78);
    const frac = Math.max(0, inv.hp / inv.maxHp);
    const by = cy - box * 0.44 - 7;
    r.fill(rect(cx - bw / 2, by, bw, 4), BOARD.hpBack, 1, 1);
    r.fill(rect(cx - bw / 2, by, Math.round(bw * frac), 4), frac < 0.3 ? BOARD.hpLow : BOARD.hpFront, 1, 1);
  }
}

/**
 * Cell to pixel, for the valley that ships. Every board coordinate goes
 * through one of these two so the grid's vertical offset cannot be applied
 * in some places and forgotten in others.
 */
const GRID_TOP = gridTop(content.valley.height);
const cellTopLeft = (x: number, y: number) => ({ x: x * CELL_PX, y: GRID_TOP + y * CELL_PX });
const cellCentre = (x: number, y: number) => ({ x: x * CELL_PX + CELL_PX / 2, y: GRID_TOP + y * CELL_PX + CELL_PX / 2 });

/**
 * §4's refused cell, drawn where the client draws it and with the client's
 * numbers: `refusal` at 0.45 in the cell inset 3px at radius 6, and over it
 * 3px stripes of `ink` at alpha 1 on lines of slope -1 stepped 8 across that
 * square. `BoardScene.hatchCell` is the thing this mirrors.
 *
 * **The stripes are `ink`, not `refusal`, and the frame is the place that
 * matters most.** One hue at two alphas is not a second channel: the bright
 * spawn, checkpoint and nest markers lift the fill to the stripe's own
 * luminance and erase the hatching, and those four cells always refuse. §4
 * carries the measurement. A frame that kept the red-on-red version would
 * be evidence for a specification nobody shipped — and the frames are what
 * a reviewer reads to decide whether the spec works.
 *
 * **The alpha is not the frame's to choose either.** tools/art/layout.ts
 * re-exports the client's 36px cell precisely so this plate and the scene
 * cannot disagree, so a softer stripe here would be the same kind of lie in
 * a quieter register. There is no border stroke: the client draws none, and
 * a third red mark is exactly what makes a red-on-red cell look fine.
 */
function drawRefusedCell(r: Raster, x0: number, y0: number): void {
  const size = CELL_PX - 6;
  const square = rect(x0 + 3, y0 + 3, size, size);
  r.fill(roundRect(x0 + 3, y0 + 3, size, size, 6), BOARD.refusal, 0.45);
  // x + y = k, k stepped by 8, each end clamped into the square — the same
  // walk `hatchCell` does. 3px of stroke is a radius of 1.5 either side, and
  // the stripes clip to the square the client hands the routine.
  for (let k = 8; k < size * 2; k += 8) {
    const a = Math.max(0, k - size);
    r.fill(clip(taper(x0 + 3 + a, y0 + 3 + k - a, x0 + 3 + k - a, y0 + 3 + a, 1.5), square), BOARD.ink, 1);
  }
}

/** The refused cell on a live board frame, by cell coordinate. */
function drawBlocked(r: Raster, x: number, y: number): void {
  const p = cellTopLeft(x, y);
  drawRefusedCell(r, p.x, p.y);
}

/**
 * Only what is actually happening. Every tracer below comes from a dinosaur
 * that really has an invader in range this tick, and the refused cell is a
 * cell the sim really refuses — `placeRefusal` is asked, not assumed. The
 * five effects in isolation live on their own plate (effectsPlate), where
 * labelling them is honest; faking all five onto one live board would not
 * be.
 */
function drawLiveEffects(r: Raster, scene: Scene): void {
  const g = scene.game;
  // A cap, because a still frame of twenty simultaneous tracers is a
  // picture of lines, not a picture of a board.
  let tracers = 0;
  for (const dn of g.state.dinos) {
    if (tracers >= 6) break;
    const def = g.dinoDef(dn);
    const a = cellCentre(dn.x, dn.y);
    for (const inv of g.state.invaders) {
      if (def.targets === "ground" && inv.flying) continue;
      const dx = inv.px - (dn.x * CELL + CELL / 2);
      const dy = inv.py - (dn.y * CELL + CELL / 2);
      if (Math.hypot(dx, dy) > def.range) continue;
      const to = { x: (inv.px * CELL_PX) / CELL, y: GRID_TOP + (inv.py * CELL_PX) / CELL };
      r.fill(taper(a.x, a.y, to.x, to.y, 1.8, 0.6), lighten(rgb(KIND_HUE[def.kind]), 0.55), 0.75);
      tracers++;
      break;
    }
  }
  // The slow field of every adult longneck that has something in range:
  // the only persistent area effect in the game, and the only one that
  // needs to be visible between ticks.
  for (const dn of g.state.dinos) {
    const def = g.dinoDef(dn);
    if (!def.slow || def.stage < 3) continue;
    const c = cellCentre(dn.x, dn.y);
    const rad = (def.range * CELL_PX) / CELL;
    const near = g.state.invaders.some((inv) => Math.hypot(inv.px - (dn.x * CELL + CELL / 2), inv.py - (dn.y * CELL + CELL / 2)) < def.range * 1.6);
    if (!near) continue;
    r.fill(ring(c.x, c.y, rad, 2), BOARD.slow, 0.55);
    r.fill(ring(c.x, c.y, rad - 7, 1), BOARD.slow, 0.22);
  }
  // A real refusal: the first empty corridor cell whose placement the sim
  // says would seal the maze.
  const v = content.valley;
  for (let y = 1; y < v.height - 1 && !scene.refusedAt; y++) {
    for (let x = 0; x < v.width; x++) {
      if (g.placeRefusal("raptor-1", x, y) === "would-block") {
        scene.refusedAt = { x, y };
        break;
      }
    }
  }
  if (scene.refusedAt) drawBlocked(r, scene.refusedAt.x, scene.refusedAt.y);
}

/**
 * The five effects, each in its own labelled tile at board scale. This is
 * the plate the client implements against; the board frames show the two
 * of them (tracer, refusal) that a single still can honestly contain.
 */
export function effectsPlate(d: Direction): Raster {
  const tile = CELL_PX * 3;
  const names = ["hit", "kill", "leak", "blocked", "slow"] as const;
  const title = `${d.name} — effects at board scale`;
  const r = new Raster(Math.max(names.length * (tile + 12) + 12, 24 + title.length * 18), tile + 86);
  r.clear(BOARD.hud, 1);
  drawText(r, 12, 14, title, TYPE.body, BOARD.text);
  const sheet = new Sheet(d);

  names.forEach((name, i) => {
    const x0 = 12 + i * (tile + 12);
    const y0 = 44;
    r.fill(rect(x0, y0, tile, tile), BOARD.boardBg, 1, 1);
    for (let k = 0; k <= 3; k++) {
      r.fill(rect(x0 + k * CELL_PX, y0, 1, tile), BOARD.gridLine, 1, 1);
      r.fill(rect(x0, y0 + k * CELL_PX, tile, 1), BOARD.gridLine, 1, 1);
    }
    const c = { x: x0 + tile / 2, y: y0 + tile / 2 };
    switch (name) {
      case "hit":
        // the tracer landing, and the one-frame white flash on the invader
        blitScaled(r, sheet.invader("normal", "longneck"), c.x + 14, c.y, CELL_PX);
        r.fill(taper(x0 + 8, y0 + tile - 10, c.x + 10, c.y + 2, 2.4, 0.8), lighten(rgb(KIND_HUE.raptor), 0.55), 0.95);
        r.fill(ellipse(c.x + 14, c.y, 9, 9), rgb(0xffffff), 0.5);
        break;
      case "kill":
        // an expanding ring and the meat it pays, rising
        r.fill(ring(c.x, c.y, 13, 3), rgb(0xf39c12), 0.95);
        r.fill(ring(c.x, c.y, 24, 1.6), rgb(0xf39c12), 0.45);
        meatIcon(r, c.x - 12, c.y - 38, 18, 18);
        drawText(r, c.x + 10, c.y - 36, "+9", TYPE.label, BOARD.meat);
        break;
      case "leak":
        // the nest takes it: a red wash on the cell, a hard ring, a cracked egg
        r.fill(rect(x0 + CELL_PX + 1, y0 + CELL_PX + 1, CELL_PX - 1, CELL_PX - 1), BOARD.refusal, 0.3, 1);
        r.fill(roundRect(c.x - 16, c.y - 16, 32, 32, 4), BOARD.nest, 0.92);
        drawText(r, c.x, c.y - 7, "N", TYPE.body, rgb(0x16211a), "center");
        r.fill(ring(c.x, c.y, 25, 4), BOARD.refusal, 0.95);
        r.fill(ring(c.x, c.y, 40, 2), BOARD.refusal, 0.4);
        eggIcon(r, c.x - 10, c.y - 46, 20, 24, true);
        break;
      case "blocked":
        // What is on screen during a refusal, and nothing else: the 250ms
        // `refusal` cell flash caught mid-fade — `t * 0.6` at t = 0.5 in
        // BoardScene's `flash` case — under §4's refused-cell preview, which
        // stays up for as long as the finger's cell stays hovered. No ring:
        // the ring on a refusal is the tap ring, it is `selection` and it
        // expands to 54px, so it belongs to no one cell.
        r.fill(rect(x0 + CELL_PX, y0 + CELL_PX, CELL_PX, CELL_PX), BOARD.refusal, 0.3, 1);
        drawRefusedCell(r, x0 + CELL_PX, y0 + CELL_PX);
        break;
      case "slow": {
        blitScaled(r, sheet.dino("longneck", 3), c.x, c.y, CELL_PX + 4);
        r.fill(ring(c.x, c.y, 46, 2), BOARD.slow, 0.6);
        r.fill(ring(c.x, c.y, 39, 1), BOARD.slow, 0.25);
        blitScaled(r, sheet.invader("normal", "tyrant"), c.x + 32, c.y - 26, CELL_PX);
        r.fill(ring(c.x + 32, c.y - 26, 16, 2.5), BOARD.slow, 0.95);
        break;
      }
    }
    drawText(r, x0 + tile / 2, y0 + tile + 12, name, TYPE.label, BOARD.textDim, "center");
  });
  return r;
}

/**
 * The six attack strikes, three steps each, on the cell a dinosaur stands
 * in and at the size the client draws them. This is the plate the client
 * implements `case "attack"` against, so every number in it is the client's
 * own rule read off the atlas `meta` — `(cell * drawCells) / authored` for
 * the scale, the cell centre for the strike's origin, the cell's bottom edge
 * for the dinosaur's feet — and not a layout invented for the picture.
 *
 * The adult is drawn under every strike because a strike alone cannot be
 * judged: the question the plate answers is whether the shape still reads
 * when it is on top of the animal that threw it.
 */
export function strikesPlate(d: Direction): Raster {
  const scale = (CELL_PX * DRAW_CELLS) / d.spritePx;
  const tile = Math.round(d.spritePx * STRIKE_FRAMES * scale);
  // The gutter holds the longest kind name over the longest strike name, at
  // the label scale the 5x7 font rounds those to; measured rather than
  // guessed, because a gutter a few pixels short silently clips a word and
  // the plate still looks finished.
  const widest = (xs: string[]): number => Math.max(...xs.map((x) => x.length)) * (GLYPH_W + 1) * fontScale(TYPE.label);
  const label = 16 + widest([...KINDS, ...Object.values(STRIKE_NAME)]);
  const title = `${d.name} — attack strikes at board scale, ${STRIKE_SEQUENCE.length} steps`;
  const r = new Raster(
    Math.max(label + STRIKE_SEQUENCE.length * (tile + 8) + 8, 24 + title.length * (GLYPH_W + 1) * fontScale(TYPE.body)),
    44 + KINDS.length * (tile + 8) + 8,
  );
  r.clear(BOARD.hud, 1);
  drawText(r, 12, 14, title, TYPE.body, BOARD.text);
  const sheet = new Sheet(d);

  KINDS.forEach((kind, row) => {
    const y0 = 44 + row * (tile + 8);
    drawText(r, 10, y0 + tile / 2 - 4, `${kind}`, TYPE.label, rgb(KIND_HUE[kind]));
    drawText(r, 10, y0 + tile / 2 + 8, STRIKE_NAME[kind], TYPE.label, BOARD.textDim);
    STRIKE_SEQUENCE.forEach((step, col) => {
      const x0 = label + col * (tile + 8);
      r.fill(rect(x0, y0, tile, tile), BOARD.boardBg, 1, 1);
      // The cell the dinosaur is standing in, so the reach reads against it.
      const c = { x: x0 + tile / 2, y: y0 + tile / 2 };
      const half = CELL_PX / 2;
      r.fill(rect(c.x - half, c.y - half, CELL_PX, 1), BOARD.gridLine, 1, 1);
      r.fill(rect(c.x - half, c.y + half, CELL_PX, 1), BOARD.gridLine, 1, 1);
      r.fill(rect(c.x - half, c.y - half, 1, CELL_PX), BOARD.gridLine, 1, 1);
      r.fill(rect(c.x + half, c.y - half, 1, CELL_PX), BOARD.gridLine, 1, 1);
      // setOrigin(0.5, 1) at the cell's bottom edge: 5.0's anchor.
      const dino = sheet.dino(kind, 3);
      const box = dino.w * scale;
      blitScaled(r, dino, c.x, c.y + half - box / 2, box);
      // setOrigin(0.5, 0.5) on the cell centre: the strike's anchor.
      blitScaled(r, strikeSprite(kind, step, d), c.x, c.y, tile);
      if (row === 0) drawText(r, c.x, y0 - 10, `step ${step}`, TYPE.label, BOARD.textDim, "center");
    });
  });
  return r;
}

function drawToast(r: Raster, msg: string): void {
  r.fill(roundRect(TOAST.x, TOAST.y, TOAST.w, TOAST.h, 10), rgb(0x0b120d), 0.86);
  r.fill(roundRect(TOAST.x, TOAST.y, 5, TOAST.h, 2.5), BOARD.refusal, 1);
  drawText(r, TOAST.x + 20, TOAST.y + (TOAST.h - capHeight(TYPE.body)) / 2, msg, TYPE.body, BOARD.text);
}

function drawButton(r: Raster, b: { x: number; y: number; w: number; h: number }, fill: Rgb, label: string, size: number, c: Rgb, sub?: string): void {
  r.fill(roundRect(b.x, b.y, b.w, b.h, 10), darken(fill, 0.45));
  r.fill(roundRect(b.x, b.y, b.w, b.h - 3, 10), fill);
  const cx = b.x + b.w / 2;
  // A label is laid out against the button it is in, not against a size
  // picked once: `FULLY GROWN` is 195 units wide at `TYPE.body` in the 5x7
  // font and Grow is 192 across. See `fitSize`.
  const pad = 12;
  const fit = (s: string, want: number) => fitSize(s, want, b.w - pad);
  if (sub) {
    drawText(r, cx, b.y + b.h / 2 - capHeight(size) - 6, label, fit(label, size), c, "center");
    drawText(r, cx, b.y + b.h / 2 + 6, sub, fit(sub, TYPE.label), mix(c, fill, 0.35), "center");
  } else {
    drawText(r, cx, b.y + (b.h - capHeight(size)) / 2, label, fit(label, size), c, "center");
  }
}

function drawHud(r: Raster, scene: Scene, d: Direction): void {
  const { game: g, sheet } = scene;
  const s = g.state;
  r.fill(rect(0, HUD_Y, CANVAS_W, CANVAS_H - HUD_Y), BOARD.hud, 1, 1);

  // the build timer, as a bar across the top of the HUD
  const frac = s.phase === "build" ? s.buildTimer / content.rules.buildPhaseTicks : 0;
  r.fill(rect(ROW1.timerBar.x, ROW1.timerBar.y, ROW1.timerBar.w, ROW1.timerBar.h), darken(BOARD.buttonActive, 0.6), 1, 1);
  if (frac > 0) r.fill(rect(0, ROW1.timerBar.y, Math.round(CANVAS_W * frac), ROW1.timerBar.h), BOARD.buttonActive, 1, 1);
  if (s.phase === "migration") {
    // in a migration the same bar shows how much of it is left to arrive
    const left = s.invaders.length + s.spawnQueue.length;
    const total = Math.max(1, (g.currentMigration()?.groups ?? []).reduce((a, x) => a + x.count, 0));
    r.fill(rect(0, ROW1.timerBar.y, Math.round(CANVAS_W * (left / total)), ROW1.timerBar.h), BOARD.refusal, 0.8, 1);
  }

  meatIcon(r, ROW1.meatIcon.x, ROW1.meatIcon.y, ROW1.meatIcon.w, ROW1.meatIcon.h);
  drawText(r, ROW1.meatValue.x, ROW1.meatValue.y + 6, String(s.meat), TYPE.vital, BOARD.meat);
  eggIcon(r, ROW1.eggIcon.x, ROW1.eggIcon.y, ROW1.eggIcon.w, ROW1.eggIcon.h);
  drawText(r, ROW1.eggValue.x, ROW1.eggValue.y + 6, String(s.eggs), TYPE.vital, BOARD.eggs);
  drawText(r, ROW1.migrationLabel.x, ROW1.migrationLabel.y, "MIGRATION", TYPE.label, BOARD.textDim);
  drawText(r, ROW1.migrationValue.x, ROW1.migrationValue.y, `${Math.min(s.migration + 1, content.migrations.length)} / ${content.migrations.length}`, TYPE.body, BOARD.text);

  if (s.phase === "build") {
    const bonus = g.earlySendBonus();
    drawButton(r, ROW1.send, BOARD.buttonActive, "SEND", TYPE.body, BOARD.text, bonus > 0 ? `+${bonus} meat` : undefined);
  } else {
    drawButton(r, ROW1.send, BOARD.button, "SEND", TYPE.body, BOARD.textDim);
  }
  drawButton(r, ROW1.speed, BOARD.button, "1×", TYPE.body, BOARD.text);

  // row 2: the next migration
  const m = g.currentMigration();
  const grp = m?.groups[0];
  const inv = grp ? content.invaders[grp.invader] : undefined;
  if (m && grp && inv) {
    kindChip(r, ROW2.chip.x, ROW2.chip.y, ROW2.chip.w, ROW2.chip.h, inv.kind, inv.archetype, d);
    const lead = s.phase === "migration" ? "NOW" : "NEXT";
    const w = drawText(r, ROW2.text.x, ROW2.text.y + 4, lead, TYPE.label, BOARD.textDim);
    drawText(r, ROW2.text.x + w + 14, ROW2.text.y, `${grp.count}× ${inv.name}`, TYPE.body, BOARD.text);
    drawText(r, CANVAS_W - GUTTER, ROW2.text.y + 4, `${inv.archetype} · ${inv.kind}`, TYPE.label, BOARD.textDim, "right");
  }

  // row 3: the tray — the shop, or the sheet for the selected dinosaur
  if (!scene.selected) {
    KINDS.forEach((kind, i) => {
      const def = content.dinos[`${kind}-1`];
      if (!def) return;
      // Selected, per section 4: a lift, a border and a larger silhouette —
      // three channels and none of them hue, so the state survives a thumb
      // over the card and an eye that cannot separate the kind colours. The
      // interior is untouched on purpose, so every contrast pair section 3
      // measured still holds. The lift is 5 because that is what keeps the
      // 3px border inside row 3: 1152 - 5 - 3 is ROW3.y exactly.
      const sel = i === 0;
      const b = {
        x: kindButtonX(i),
        y: ROW3.kindButton.y - (sel ? SELECT_LIFT : 0),
        w: ROW3.kindButton.w,
        h: ROW3.kindButton.h,
      };
      const affordable = s.meat >= def.cost;
      if (sel) r.fill(roundRect(b.x, b.y, b.w, b.h, 10).expand(SELECT_BORDER), rgb(0xf6f3ea), 0.95);
      r.fill(roundRect(b.x, b.y, b.w, b.h, 10), mix(rgb(KIND_HUE[kind]), BOARD.hud, 0.68));
      blitScaled(r, sheet.dino(kind, 1), b.x + b.w / 2, b.y + 34, sel ? 60 : 56, affordable ? 1 : 0.45);
      // The button is labelled with the *kind*, not the genus. The kind
      // chart is the six facts the player has to learn; the genus is on the
      // sheet, where there is room to read it. "Velociraptor" does not fit
      // in 109px and shortening it to "Velocir" teaches nothing.
      drawText(r, b.x + b.w / 2, b.y + 66, kind, TYPE.label, affordable ? BOARD.text : BOARD.textDim, "center");
      meatIcon(r, b.x + b.w / 2 - 30, b.y + 88, 20, 20);
      drawText(r, b.x + b.w / 2 - 4, b.y + 93, String(def.cost), TYPE.body, affordable ? BOARD.meat : BOARD.textDim);
    });
  } else {
    const dn = scene.selected;
    const def = g.dinoDef(dn);
    r.fill(roundRect(GUTTER - 8, ROW3.y + 4, CONTENT_WIDE, ROW3.h - 12, 10), BOARD.hudPanel);
    // A thumbnail of the thing being talked about, so the sheet is anchored
    // to the dinosaur the player just tapped rather than to a name.
    blitScaled(r, sheet.dino(def.kind, def.stage), CANVAS_W - 44, ROW3.y + 34, 46);
    // The same four lines the client shows, from the same builder, each
    // inside `SHEET_COL_W` — see `fitSize` for why the mock may have to
    // draw one of them a size smaller than the client does.
    const lines = sheetLines(def);
    const col = ROW3.sheetName.w;
    const line = (slot: { x: number; y: number }, s: string, size: number, c: Rgb) =>
      drawText(r, slot.x, slot.y, s, fitSize(s, size, col), c);
    line(ROW3.sheetName, lines.name, TYPE.body, BOARD.text);
    line(ROW3.sheetKind, lines.kind, TYPE.label, BOARD.textDim);
    line(ROW3.sheetStats, lines.stats, TYPE.body, BOARD.text);
    // The modifier line is the one that does not fit at any size in the
    // mock's font, so it wraps. The client draws it on one row.
    wrapTo(lines.extras, TYPE.label, col).forEach((row, i) => {
      drawText(r, ROW3.sheetExtras.x, ROW3.sheetExtras.y + i * (capHeight(TYPE.label) + 6), row, TYPE.label, BOARD.textDim);
    });
    const next = def.growsTo ? content.dinos[def.growsTo] : undefined;
    drawButton(r, ROW3.grow, next ? BOARD.buttonActive : BOARD.button, next ? "GROW" : "FULLY GROWN", TYPE.body, BOARD.text, next ? `${next.name} · ${next.cost}` : undefined);
    drawButton(r, ROW3.sell, BOARD.buttonDanger, "SELL", TYPE.body, BOARD.text, `+${g.sellValue(dn)} meat`);
  }
}

const CONTENT_WIDE = CANVAS_W - (GUTTER - 8) * 2;

export interface FrameOptions extends Partial<SceneOptions> {
  toast?: string;
  effects?: boolean;
}

/** One sample frame of the board at the logical canvas size, 720x1280. */
export function renderBoardFrame(d: Direction, o: FrameOptions = {}): Raster {
  const opts: SceneOptions = {
    migration: o.migration ?? 21,
    ticks: o.ticks ?? 430,
    meat: o.meat ?? 184,
    eggs: o.eggs ?? 14,
    selectSheet: o.selectSheet ?? false,
    ...(o.phase ? { phase: o.phase } : {}),
  };
  const scene = buildScene(d, opts);
  const r = new Raster(CANVAS_W, CANVAS_H);
  r.clear(BOARD.bg, 1);
  drawBoard(r, scene);
  if (o.effects !== false) drawLiveEffects(r, scene);
  if (o.toast) drawToast(r, o.toast);
  drawHud(r, scene, d);
  return r;
}

export { Sheet, blitScaled, drawText, capHeight, roundRect, ring, meatIcon, eggIcon, drawButton };
