import Phaser from "phaser";
import { CELL, Game, TICKS_PER_SECOND, type DinoDef, type GameEvent, type Refusal } from "@mazeosaur/sim";
import { content, hatchlings } from "@mazeosaur/content";
import type { ResumableRun } from "./platform.js";
import type { RunSummary } from "./ResultsScene.js";
import { COLORS, KIND_COLOR, text } from "./theme.js";
import {
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  CONTENT_RIGHT,
  HUD_H,
  HUD_Y,
  ROW1,
  ROW2,
  ROW3,
  TOAST,
  TYPE,
  colAt,
  gridTop,
  kindButtonX,
  rowAt,
} from "./layout.js";
import { makeButton, type Button } from "./ui.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;
/** The two vitals' hues as numbers, so an icon and its count cannot drift. */
const MEAT_RGB = Phaser.Display.Color.HexStringToColor(COLORS.meat).color;
const EGGS_RGB = Phaser.Display.Color.HexStringToColor(COLORS.eggs).color;
/**
 * The grid's own pixel height, and where it starts. `BOARD_H` (from layout)
 * is the board *area* — everything above the HUD — and is fixed, because the
 * HUD anchors to the bottom of the canvas and does not shrink for a short
 * valley. These two are content-derived: the grid lives inside the area and
 * may be shorter than it, centred, with `GRID_TOP` of margin above.
 *
 * `GRID_TOP` is 0 for the 28-row valley that ships, so every pixel below
 * lands where it landed before this split. It is not a multiple of `CELL_PX`
 * in general, though — a 27-row valley gives 18 — which is why `cellAt`
 * subtracts it before dividing rather than relying on the integer divide.
 */
const GRID_PX_H = content.valley.height * CELL_PX;
const GRID_TOP = gridTop(content.valley.height);
/** Cell row to canvas y. The only place the grid's inset is applied. */
const gy = (row: number): number => row * CELL_PX + GRID_TOP;
/** How long the last kill or leak stays on screen before the results come up. */
const END_DELAY_MS = 1100;

/**
 * Nothing in the HUD is positioned by the measured width of a variable
 * string: a changing string is either left-anchored with a wrap width equal
 * to the gap it is allowed to fill, or right-anchored to a fixed edge. The
 * gaps themselves live in layout.ts, so moving a button moves them together.
 */
/** A one-line HUD label: wraps inside its column instead of overflowing it. */
function line(size: number, wrap: number, color?: string): Phaser.Types.GameObjects.Text.TextStyle {
  return { ...text(size, color), wordWrap: { width: wrap }, maxLines: 1 };
}

interface Effect {
  kind: "attack" | "kill" | "flash" | "leak";
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color: number;
  ttl: number;
  life: number;
}

/** What starts a run: a fresh seed, or a saved run to replay into place. */
export interface BoardData {
  seed: number;
  resume?: ResumableRun | null;
}

/** Cells on the line from `a` (exclusive) to `b` (inclusive), Bresenham. */
function cellsAlong(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    out.push({ x, y });
  }
  return out;
}

const REFUSAL_TEXT: Record<Refusal, string> = {
  "out-of-bounds": "Off the valley",
  occupied: "Something is already there",
  "lane-cell": "Can't build on the trail",
  "would-block": "That would seal the maze",
  "unknown-dino": "Unknown dinosaur",
  "no-meat": "Not enough meat",
  "invader-in-the-way": "An invader is in the way",
  rock: "Rock",
  "not-yours": "No dinosaur there",
  "fully-grown": "Fully grown",
  "wrong-phase": "Not now",
};

/**
 * The run itself: board, HUD, input. It never decides a rule; it asks the
 * Game and draws the answer, including whether the run is over — the sim
 * raises "won" and "lost" and the scene only reacts by leaving.
 */
export class BoardScene extends Phaser.Scene {
  private game_!: Game;
  private seed = 1;
  private resume: ResumableRun | null = null;
  private ending = false;
  private acc = 0;
  private speed = 1;
  private prevPos = new Map<number, { x: number; y: number }>();
  private effects: Effect[] = [];

  private staticGfx!: Phaser.GameObjects.Graphics;
  private towerGfx!: Phaser.GameObjects.Graphics;
  private dynGfx!: Phaser.GameObjects.Graphics;
  private towersDirty = true;

  private selectedDef: DinoDef | null = null;
  private selectedDino: number | null = null;
  private painting = false;
  private lastPaint: { x: number; y: number } | null = null;
  private hoverCell: { x: number; y: number } | null = null;

  /** Row 1. The timer is a bar, so it is sized rather than written. */
  private hudGfx!: Phaser.GameObjects.Graphics;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private meatText!: Phaser.GameObjects.Text;
  private eggsText!: Phaser.GameObjects.Text;
  private migrationValue!: Phaser.GameObjects.Text;
  private sendButton!: Button;
  private speedButton!: Button;

  /** Row 2: the next migration, information only and never tappable. */
  private previewChip!: Phaser.GameObjects.Rectangle;
  private previewText!: Phaser.GameObjects.Text;
  private previewMeta!: Phaser.GameObjects.Text;
  private previewKey = "";

  /** Row 3: one tray at a time — the shop, or the selected dinosaur's sheet. */
  private shopButtons: { def: DinoDef; button: Button; cost: Phaser.GameObjects.Text }[] = [];
  private sheetPanel!: Phaser.GameObjects.Rectangle;
  private sheetName!: Phaser.GameObjects.Text;
  private sheetKind!: Phaser.GameObjects.Text;
  private sheetStats!: Phaser.GameObjects.Text;
  private sheetExtras!: Phaser.GameObjects.Text;
  private growButton!: Button;
  private sellButton!: Button;
  private sheetKey = "";

  /** The toast, over the bottom of the board rather than in a HUD row. */
  private toastPanel!: Phaser.GameObjects.Rectangle;
  private toastBar!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private toastUntil = 0;

  constructor() {
    super("board");
  }

  init(data: Partial<BoardData>): void {
    // The title and results screens always supply a seed; the fallback
    // only keeps a bare scene.start("board") from the console runnable.
    this.seed = data.resume?.seed ?? data.seed ?? 1;
    this.resume = data.resume ?? null;
  }

  create(): void {
    // Starting this scene again re-runs create() on the same instance:
    // every field that refers to a display object or to the previous run
    // must reset here, or the HUD keeps touching destroyed objects.
    this.game_ = new Game(content, this.seed);
    this.ending = false;
    this.acc = 0;
    this.speed = 1;
    this.prevPos.clear();
    this.effects = [];
    this.towersDirty = true;
    this.selectedDef = null;
    this.selectedDino = null;
    this.painting = false;
    this.lastPaint = null;
    this.hoverCell = null;
    this.shopButtons = [];
    this.toastUntil = 0;
    this.previewKey = "";
    this.sheetKey = "";
    this.cameras.main.setBackgroundColor(COLORS.bg);

    if (this.resume) this.replay(this.resume);

    this.staticGfx = this.add.graphics();
    this.towerGfx = this.add.graphics();
    this.dynGfx = this.add.graphics();
    this.drawStatic();
    this.buildHud();
    this.wireInput();
    this.refreshHud();
  }

  /**
   * Put a saved run back on the board. The sim is deterministic, so
   * ticking to each logged tick and re-applying the command rebuilds the
   * exact state the player left. Storing that log is the shell's job.
   */
  private replay(run: ResumableRun): void {
    for (const { tick, command } of run.log) {
      while (this.game_.state.tick < tick) this.game_.tick();
      this.game_.apply(command);
    }
    this.game_.drainEvents();
  }

  // ---------------------------------------------------------------- loop

  override update(_time: number, delta: number): void {
    const g = this.game_;
    if (g.state.phase === "build" || g.state.phase === "migration") {
      this.acc += delta * this.speed;
      let ticks = 0;
      while (this.acc >= TICK_MS && ticks < 20) {
        this.snapshotPositions();
        g.tick();
        this.handleEvents(g.drainEvents());
        this.acc -= TICK_MS;
        ticks++;
      }
    }
    const alpha = Math.min(1, this.acc / TICK_MS);
    for (const e of this.effects) e.life -= delta;
    this.effects = this.effects.filter((e) => e.life > 0);

    if (this.towersDirty) this.drawTowers();
    this.drawDynamic(alpha);
    this.refreshHud();
  }

  private snapshotPositions(): void {
    this.prevPos.clear();
    for (const inv of this.game_.state.invaders) this.prevPos.set(inv.id, { x: inv.px, y: inv.py });
  }

  private handleEvents(events: GameEvent[]): void {
    const g = this.game_;
    for (const e of events) {
      switch (e.type) {
        case "attack": {
          const d = g.state.dinos.find((x) => x.id === e.dinoId);
          const inv = g.state.invaders.find((x) => x.id === e.invaderId);
          if (!d) break;
          const from = this.cellCenter(d.x, d.y);
          const to = inv ? this.worldFromMilli(inv.px, inv.py) : from;
          this.effects.push({ kind: "attack", x: from.x, y: from.y, x2: to.x, y2: to.y, color: KIND_COLOR[g.dinoDef(d).kind], ttl: 120, life: 120 });
          break;
        }
        case "killed": {
          const p = this.worldFromMilli(e.at.x, e.at.y);
          this.effects.push({ kind: "kill", x: p.x, y: p.y, color: 0xf39c12, ttl: 300, life: 300 });
          break;
        }
        case "leaked": {
          const n = this.cellCenter(content.valley.lane.exit.x, content.valley.lane.exit.y);
          this.effects.push({ kind: "leak", x: n.x, y: n.y, color: COLORS.refusal, ttl: 500, life: 500 });
          this.status(`An invader reached the nest: -${e.eggs} egg${e.eggs > 1 ? "s" : ""}`);
          break;
        }
        case "migration-started":
          this.status(e.bonus > 0 ? `Sent early: +${e.bonus} meat` : "The migration begins");
          break;
        case "migration-cleared":
          this.status(`Migration cleared: +${e.bonus} meat`);
          break;
        case "won":
          this.finish(true);
          break;
        case "lost":
          this.finish(false);
          break;
        case "placed":
        case "sold":
        case "grown":
          this.towersDirty = true;
          break;
      }
    }
  }

  // ------------------------------------------------------------- drawing

  private cellCenter(x: number, y: number): { x: number; y: number } {
    return { x: x * CELL_PX + CELL_PX / 2, y: gy(y) + CELL_PX / 2 };
  }

  private worldFromMilli(px: number, py: number): { x: number; y: number } {
    return { x: (px * CELL_PX) / CELL, y: (py * CELL_PX) / CELL + GRID_TOP };
  }

  private drawStatic(): void {
    const gfx = this.staticGfx;
    const v = content.valley;
    gfx.clear();
    gfx.fillStyle(COLORS.boardBg, 1);
    gfx.fillRect(0, GRID_TOP, CANVAS_W, GRID_PX_H);
    gfx.lineStyle(1, COLORS.gridLine, 1);
    for (let x = 0; x <= v.width; x++) gfx.lineBetween(x * CELL_PX, GRID_TOP, x * CELL_PX, GRID_TOP + GRID_PX_H);
    for (let y = 0; y <= v.height; y++) gfx.lineBetween(0, gy(y), CANVAS_W, gy(y));

    const mark = (p: { x: number; y: number }, color: number, label: string) => {
      gfx.fillStyle(color, 1);
      gfx.fillRect(p.x * CELL_PX + 2, gy(p.y) + 2, CELL_PX - 4, CELL_PX - 4);
      this.add.text(p.x * CELL_PX + CELL_PX / 2, gy(p.y) + CELL_PX / 2, label, text(16, "#111")).setOrigin(0.5);
    };
    mark(v.lane.spawn, COLORS.spawn, "S");
    v.lane.checkpoints.forEach((c, i) => mark(c, COLORS.checkpoint, String(i + 1)));
    mark(v.lane.exit, COLORS.nest, "N");
    for (const r of v.rock) {
      gfx.fillStyle(0x4a4a4a, 1);
      gfx.fillRect(r.x * CELL_PX, gy(r.y), CELL_PX, CELL_PX);
    }
  }

  private drawTowers(): void {
    const gfx = this.towerGfx;
    gfx.clear();
    for (const d of this.game_.state.dinos) {
      const def = this.game_.dinoDef(d);
      const x = d.x * CELL_PX;
      const y = gy(d.y);
      gfx.fillStyle(KIND_COLOR[def.kind], 1);
      gfx.fillRoundedRect(x + 3, y + 3, CELL_PX - 6, CELL_PX - 6, 6);
      // growth stage as pips
      gfx.fillStyle(0x111111, 0.85);
      for (let i = 0; i < def.stage; i++) gfx.fillCircle(x + 9 + i * 9, y + CELL_PX - 8, 3);
    }
    this.towersDirty = false;
  }

  private drawDynamic(alpha: number): void {
    const gfx = this.dynGfx;
    const g = this.game_;
    gfx.clear();

    // selection / hover
    if (this.selectedDino !== null) {
      const d = g.state.dinos.find((x) => x.id === this.selectedDino);
      if (d) {
        const def = g.dinoDef(d);
        const c = this.cellCenter(d.x, d.y);
        gfx.lineStyle(2, 0xffffff, 0.5);
        gfx.strokeCircle(c.x, c.y, (def.range * CELL_PX) / CELL);
        gfx.lineStyle(3, 0xffffff, 0.9);
        gfx.strokeRect(d.x * CELL_PX + 1, gy(d.y) + 1, CELL_PX - 2, CELL_PX - 2);
      } else {
        this.selectedDino = null;
      }
    } else if (this.hoverCell && this.selectedDef && !this.painting) {
      const r = g.placeRefusal(this.selectedDef.id, this.hoverCell.x, this.hoverCell.y);
      const c = this.cellCenter(this.hoverCell.x, this.hoverCell.y);
      gfx.fillStyle(r ? COLORS.refusal : KIND_COLOR[this.selectedDef.kind], 0.45);
      gfx.fillRoundedRect(this.hoverCell.x * CELL_PX + 3, gy(this.hoverCell.y) + 3, CELL_PX - 6, CELL_PX - 6, 6);
      if (!r) {
        gfx.lineStyle(1, 0xffffff, 0.35);
        gfx.strokeCircle(c.x, c.y, (this.selectedDef.range * CELL_PX) / CELL);
      }
    }

    // invaders
    for (const inv of g.state.invaders) {
      const prev = this.prevPos.get(inv.id);
      const px = prev ? prev.x + (inv.px - prev.x) * alpha : inv.px;
      const py = prev ? prev.y + (inv.py - prev.y) * alpha : inv.py;
      const p = this.worldFromMilli(px, py);
      const def = g.invaderDef(inv);
      const r = def.archetype === "boss" ? 15 : inv.flying ? 9 : def.archetype === "swarm" ? 8 : 11;
      gfx.fillStyle(KIND_COLOR[def.kind], 1);
      if (inv.flying) {
        gfx.fillTriangle(p.x, p.y - r, p.x - r, p.y + r * 0.7, p.x + r, p.y + r * 0.7);
      } else {
        gfx.fillCircle(p.x, p.y, r);
      }
      if (inv.slowUntil > g.state.tick) {
        gfx.lineStyle(2, 0x74b9ff, 1);
        gfx.strokeCircle(p.x, p.y, r + 2);
      }
      if (inv.stunUntil > g.state.tick) {
        gfx.lineStyle(2, 0xf1c40f, 1);
        gfx.strokeCircle(p.x, p.y, r + 5);
      }
      if (inv.shield > 0) {
        gfx.lineStyle(3, 0xecf0f1, 0.9);
        gfx.strokeCircle(p.x, p.y, r + 3);
      }
      const w = r * 2 + 4;
      const frac = Math.max(0, inv.hp / inv.maxHp);
      gfx.fillStyle(COLORS.hpBack, 1);
      gfx.fillRect(p.x - w / 2, p.y - r - 8, w, 4);
      gfx.fillStyle(frac < 0.3 ? COLORS.hpLow : COLORS.hpFront, 1);
      gfx.fillRect(p.x - w / 2, p.y - r - 8, w * frac, 4);
    }

    // effects
    for (const e of this.effects) {
      const t = e.life / e.ttl;
      switch (e.kind) {
        case "attack":
          gfx.lineStyle(2, e.color, t);
          gfx.lineBetween(e.x, e.y, e.x2 as number, e.y2 as number);
          break;
        case "kill":
          gfx.lineStyle(2, e.color, t);
          gfx.strokeCircle(e.x, e.y, 6 + (1 - t) * 18);
          break;
        case "flash":
          gfx.fillStyle(e.color, t * 0.6);
          gfx.fillRect(e.x - CELL_PX / 2, e.y - CELL_PX / 2, CELL_PX, CELL_PX);
          break;
        case "leak":
          gfx.lineStyle(4, e.color, t);
          gfx.strokeCircle(e.x, e.y, 10 + (1 - t) * 40);
          break;
      }
    }
  }

  // ----------------------------------------------------------------- HUD

  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, size = 20): Button {
    return makeButton(this, x, y, w, h, label, onClick, { size });
  }

  private buildHud(): void {
    this.add.rectangle(0, HUD_Y, CANVAS_W, HUD_H, COLORS.hud).setOrigin(0, 0);
    this.hudGfx = this.add.graphics();

    this.buildRow1();
    this.buildRow2();
    this.buildRow3();
    this.buildToast();

    this.showSheet(false);
    if (hatchlings[0]) this.selectDef(hatchlings[0]);
  }

  /**
   * Row 1: the build timer as a draining bar along the seam, then meat,
   * eggs, which migration, Send and the speed toggle. The timer shows no
   * digits on purpose — during a build phase the player is looking at the
   * grid, and a full-width bar is legible without being read. Send and the
   * speed toggle are both 82px, which is the 44pt hit floor.
   */
  private buildRow1(): void {
    const bar = ROW1.timerBar;
    this.add.rectangle(bar.x, bar.y, bar.w, bar.h, COLORS.hudPanel).setOrigin(0, 0);
    this.timerBar = this.add.rectangle(bar.x, bar.y, bar.w, bar.h, COLORS.buttonActive).setOrigin(0, 0);

    // Meat and eggs are an icon plus a count, not a labelled field: 214 and
    // 14 are read as shapes. The icons are flat placeholders until the
    // atlas lands; the sprite drops into the same box.
    this.hudGfx.fillStyle(MEAT_RGB, 1);
    this.hudGfx.fillRoundedRect(ROW1.meatIcon.x, ROW1.meatIcon.y, ROW1.meatIcon.w, ROW1.meatIcon.h, 8);
    this.hudGfx.fillStyle(EGGS_RGB, 1);
    this.hudGfx.fillEllipse(
      ROW1.eggIcon.x + ROW1.eggIcon.w / 2,
      ROW1.eggIcon.y + ROW1.eggIcon.h / 2,
      ROW1.eggIcon.w,
      ROW1.eggIcon.h,
    );
    // Each count wraps inside the gap to the next element, so four digits
    // of meat still cannot reach the egg icon.
    this.meatText = this.add.text(ROW1.meatValue.x, ROW1.meatValue.y, "", line(TYPE.vital, 124, COLORS.meat));
    this.eggsText = this.add.text(ROW1.eggValue.x, ROW1.eggValue.y, "", line(TYPE.vital, 78, COLORS.eggs));

    this.add.text(ROW1.migrationLabel.x, ROW1.migrationLabel.y, "MIGRATION", text(TYPE.label, COLORS.textDim));
    this.migrationValue = this.add.text(
      ROW1.migrationValue.x,
      ROW1.migrationValue.y,
      "",
      line(TYPE.body, ROW1.migrationWrap),
    );

    this.sendButton = this.button(ROW1.send.x, ROW1.send.y, ROW1.send.w, ROW1.send.h, "Send", () => this.send(), TYPE.body);
    this.speedButton = this.button(ROW1.speed.x, ROW1.speed.y, ROW1.speed.w, ROW1.speed.h, "1x", () => this.cycleSpeed(), TYPE.body);
  }

  /**
   * Row 2: the one line that says what is coming. A kind chip carries the
   * hue, then the count and genus, then the archetype and kind dim and
   * right-aligned. Information only — nothing here takes a pointer, which
   * is why 40px is allowed to sit under the hit floor.
   */
  private buildRow2(): void {
    this.previewChip = this.add
      .rectangle(ROW2.chip.x, ROW2.chip.y, ROW2.chip.w, ROW2.chip.h, COLORS.hudPanel)
      .setOrigin(0, 0);
    // Two variable strings facing each other: the left wraps inside the gap
    // it may fill, the right is anchored to the content edge.
    const leftWrap = CONTENT_RIGHT - ROW2.metaW - 12 - ROW2.text.x;
    this.previewText = this.add.text(ROW2.text.x, ROW2.text.y, "", line(TYPE.body, leftWrap));
    this.previewMeta = this.add
      .text(ROW2.meta.right, ROW2.meta.y, "", line(TYPE.label, ROW2.metaW, COLORS.textDim))
      .setOrigin(1, 0);
  }

  /**
   * Row 3: one tray at a time. Six hatchling buttons while nothing is
   * selected, the dinosaur sheet while something is. Swapping rather than
   * stacking is what buys the hit targets — the palette is 128px and the
   * sheet 107px, and stacked they are 235px into a 136px row — and the
   * player discovers growing by watching the shop become a sheet.
   */
  private buildRow3(): void {
    const kb = ROW3.kindButton;
    hatchlings.forEach((def, i) => {
      const x = kindButtonX(i);
      const cx = x + kb.w / 2;
      const hue = KIND_COLOR[def.kind];
      const b = this.button(x, kb.y, kb.w, kb.h, "", () => this.selectDef(def), TYPE.label);
      b.bg.setFillStyle(hue, 0.22);

      // The silhouette. A flat shape in the kind's hue stands in for the
      // sprite and occupies the box the sprite will occupy.
      const art = this.add.graphics();
      art.fillStyle(hue, 1);
      art.fillRoundedRect(cx - ROW3.kindArt.w / 2, kb.y + ROW3.kindArt.dy, ROW3.kindArt.w, ROW3.kindArt.h, 10);
      b.add(art);

      b.label.setText(def.kind).setPosition(cx, kb.y + ROW3.kindName.dy).setOrigin(0.5, 0);

      // The cost, as a meat pip and a number. Both are constant per button,
      // so centring them on fixed geometry is safe; only the colour moves.
      const pip = this.add.graphics();
      pip.fillStyle(MEAT_RGB, 1);
      pip.fillCircle(cx - 16, kb.y + ROW3.kindCost.dy + 9, 5);
      b.add(pip);
      const cost = b.add(
        this.add.text(cx + 10, kb.y + ROW3.kindCost.dy, `${def.cost}`, text(TYPE.label, COLORS.meat)).setOrigin(0.5, 0),
      );

      this.shopButtons.push({ def, button: b, cost });
    });

    this.sheetPanel = this.add.rectangle(8, ROW3.y, CANVAS_W - 16, ROW3.h - 8, COLORS.hudPanel).setOrigin(0, 0);
    // The genus is the collectible, so its column is 272px — 15 characters
    // of title type, which is exactly Argentinosaurus and Rhamphorhynchus.
    const w = ROW3.sheetName.w;
    this.sheetName = this.add.text(ROW3.sheetName.x, ROW3.sheetName.y, "", line(TYPE.title, w));
    this.sheetKind = this.add.text(ROW3.sheetKind.x, ROW3.sheetKind.y, "", line(TYPE.label, w, COLORS.textDim));
    this.sheetStats = this.add.text(ROW3.sheetStats.x, ROW3.sheetStats.y, "", line(TYPE.body, w));
    this.sheetExtras = this.add.text(ROW3.sheetExtras.x, ROW3.sheetExtras.y, "", line(TYPE.label, w, COLORS.textDim));
    this.growButton = this.button(ROW3.grow.x, ROW3.grow.y, ROW3.grow.w, ROW3.grow.h, "Grow", () => this.grow(), TYPE.label);
    this.sellButton = this.button(ROW3.sell.x, ROW3.sell.y, ROW3.sell.w, ROW3.sell.h, "Sell", () => this.sell(), TYPE.label);
    this.sellButton.bg.setFillStyle(COLORS.buttonDanger);
  }

  /**
   * The toast sits over the bottom of the board, not in a HUD row: it costs
   * no layout height and it puts the message where the eye and the thumb
   * already are. A refusal gets a bar down the left edge; an event does not.
   */
  private buildToast(): void {
    this.toastPanel = this.add.rectangle(TOAST.x, TOAST.y, TOAST.w, TOAST.h, COLORS.hud).setOrigin(0, 0).setAlpha(0.78);
    this.toastBar = this.add.rectangle(TOAST.x, TOAST.y, TOAST.barW, TOAST.h, COLORS.refusal).setOrigin(0, 0);
    this.toastText = this.add.text(
      TOAST.x + TOAST.pad,
      TOAST.y + (TOAST.h - TYPE.body) / 2 - 2,
      "",
      line(TYPE.body, TOAST.w - TOAST.pad * 2),
    );
    this.hideToast();
  }

  /** Swap the tray. The shop and the sheet are never both on screen. */
  private showSheet(v: boolean): void {
    this.sheetPanel.setVisible(v);
    this.sheetName.setVisible(v);
    this.sheetKind.setVisible(v);
    this.sheetStats.setVisible(v);
    this.sheetExtras.setVisible(v);
    this.growButton.setVisible(v);
    this.sellButton.setVisible(v);
    for (const { button } of this.shopButtons) button.setVisible(!v);
  }

  private hideToast(): void {
    this.toastPanel.setVisible(false);
    this.toastBar.setVisible(false);
    this.toastText.setVisible(false);
  }

  private refreshHud(): void {
    const g = this.game_;
    const s = g.state;
    this.meatText.setText(String(s.meat));
    this.eggsText.setText(String(s.eggs));
    const total = content.migrations.length;
    this.migrationValue.setText(`${Math.min(s.migration + 1, total)} / ${total}`);

    // The bar drains across the build phase and is the early-send
    // affordance at the same time: what is left of it *is* the bonus.
    if (s.phase === "build") {
      const frac = Math.max(0, Math.min(1, s.buildTimer / content.rules.buildPhaseTicks));
      this.timerBar.setVisible(true);
      this.timerBar.displayWidth = CANVAS_W * frac;
      const bonus = g.earlySendBonus();
      this.sendButton.label.setText(bonus > 0 ? `Send  +${bonus}` : "Send");
      this.sendButton.bg.setFillStyle(COLORS.buttonActive);
    } else {
      this.timerBar.setVisible(false);
      this.sendButton.label.setText("Send");
      this.sendButton.bg.setFillStyle(COLORS.button);
    }

    this.refreshPreview();
    this.refreshSheet();
    this.refreshToast();

    for (const { def, button, cost } of this.shopButtons) {
      const active = this.selectedDef?.id === def.id && this.selectedDino === null;
      button.bg.setStrokeStyle(active ? 3 : 0, 0xffffff);
      // The silhouette stays at full strength when the player cannot
      // afford the kind: it is still a label, just not yet a purchase.
      cost.setColor(s.meat >= def.cost ? COLORS.meat : COLORS.textDim);
    }
  }

  /**
   * Row 2 changes once a migration, so it is rebuilt on a key rather than
   * every frame. A migration with several groups is named by its largest,
   * with a count of the rest — the row is one line and stays one line.
   */
  private refreshPreview(): void {
    const s = this.game_.state;
    const key = `${s.migration}|${s.phase}`;
    if (key === this.previewKey) return;
    this.previewKey = key;

    const m = this.game_.currentMigration();
    let main = m?.groups[0];
    for (const gr of m?.groups ?? []) if (!main || gr.count > main.count) main = gr;
    const inv = main ? content.invaders[main.invader] : undefined;
    if (!m || !main || !inv) {
      this.previewChip.setVisible(false);
      this.previewText.setText("");
      this.previewMeta.setText("");
      return;
    }
    const rest = m.groups.length > 1 ? ` +${m.groups.length - 1}` : "";
    this.previewChip.setVisible(true);
    this.previewChip.setFillStyle(KIND_COLOR[inv.kind]);
    this.previewText.setText(`${s.phase === "migration" ? "NOW" : "NEXT"}  ${main.count}× ${inv.name}${rest}`);
    this.previewMeta.setText(`${inv.archetype} · ${inv.kind}`);
  }

  /**
   * The sheet. Four lines and two buttons: genus, kind and stage, what it
   * does per second, and how far it reaches and at what. Sell shows the
   * refund, which is 80% during a build phase and 60% during a migration,
   * so the number itself teaches that juggling costs something.
   */
  private refreshSheet(): void {
    const g = this.game_;
    const s = g.state;
    if (this.selectedDino === null) {
      this.sheetKey = "";
      return;
    }
    const d = s.dinos.find((x) => x.id === this.selectedDino);
    if (!d) return;
    const def = g.dinoDef(d);
    const key = `${d.id}|${def.id}|${s.meat}|${s.phase}`;
    if (key === this.sheetKey) return;
    this.sheetKey = key;

    const stage = ["", "hatchling", "juvenile", "adult"][def.stage];
    const dps = ((def.damage * TICKS_PER_SECOND) / def.cooldown).toFixed(1);
    const hits = def.targets === "both" ? "ground+air" : def.targets;
    this.sheetName.setText(def.name);
    this.sheetKind.setText(`${def.kind} ${stage}`);
    // Per-hit damage stays beside dps: a 200 bite that one-shots is not the
    // same thing as 77 dps of chip, and that difference is the reason to
    // grow a tyrant.
    this.sheetStats.setText(`${def.damage} dmg · ${dps} dps`);
    this.sheetExtras.setText(`range ${(def.range / CELL).toFixed(1)} cells · ${hits}`);

    const next = def.growsTo ? content.dinos[def.growsTo] : undefined;
    // The price of the thing the player cannot buy yet is still shown; only
    // its colour says they cannot buy it.
    this.growButton.label.setText(next ? `Grow → ${next.name}\n${next.cost} meat` : "FULLY GROWN").setAlign("center");
    this.growButton.label.setColor(next && s.meat >= next.cost ? COLORS.text : COLORS.textDim);
    this.sellButton.label.setText(`Sell\n+${g.sellValue(d)}`).setAlign("center");
  }

  /** Hold, then fade. One timestamp carries both. */
  private refreshToast(): void {
    const left = this.toastUntil - this.time.now;
    if (left <= 0) {
      if (this.toastPanel.visible) this.hideToast();
      return;
    }
    const k = Math.min(1, left / TOAST.fadeMs);
    this.toastPanel.setAlpha(0.78 * k);
    this.toastBar.setAlpha(k);
    this.toastText.setAlpha(k);
  }

  /** An event: what happened, with no refusal bar. */
  private status(msg: string): void {
    this.toast(msg, false);
  }

  private toast(msg: string, refusal: boolean): void {
    this.toastText.setText(msg);
    this.toastBar.setVisible(refusal);
    this.toastPanel.setVisible(true);
    this.toastText.setVisible(true);
    this.toastUntil = this.time.now + TOAST.holdMs + TOAST.fadeMs;
  }

  /**
   * The run is over. The sim already decided which way; the scene only
   * reads the final numbers, lets the last effect play, and leaves. The
   * clock event dies with the scene, so the handover cannot fire twice
   * or into a torn-down scene.
   */
  private finish(won: boolean): void {
    if (this.ending) return;
    this.ending = true;
    this.painting = false;
    this.lastPaint = null;
    this.hoverCell = null;
    const s = this.game_.state;
    const summary: RunSummary = {
      won,
      seed: this.seed,
      migrationsCleared: s.migration,
      totalMigrations: content.migrations.length,
      eggs: s.eggs,
      meat: s.meat,
    };
    this.status(won ? "The nest holds" : "The nest is lost");
    this.time.delayedCall(END_DELAY_MS, () => this.scene.start("results", summary));
  }

  // --------------------------------------------------------------- input

  private wireInput(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.ending) return;
      const cell = this.cellAt(p);
      if (!cell) return;
      const dino = this.game_.dinoAt(cell.x, cell.y);
      if (dino) {
        this.selectedDino = dino.id;
        this.showSheet(true);
        return;
      }
      if (this.selectedDino !== null) {
        this.selectedDino = null;
        this.showSheet(false);
        if (!this.selectedDef) return;
      }
      if (this.selectedDef) {
        this.painting = true;
        this.lastPaint = cell;
        this.tryPlace(cell.x, cell.y);
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.ending) return;
      const cell = this.cellAt(p);
      this.hoverCell = cell;
      if (!this.painting || !p.isDown || !cell || !this.selectedDef) return;
      if (this.lastPaint && this.lastPaint.x === cell.x && this.lastPaint.y === cell.y) return;
      // A fast finger skips cells between two move events; paint the line
      // between them so a wall never has accidental gaps.
      const from = this.lastPaint ?? cell;
      this.lastPaint = cell;
      for (const c of cellsAlong(from, cell)) this.tryPlace(c.x, c.y, true);
    });
    const stop = () => {
      this.painting = false;
      this.lastPaint = null;
    };
    this.input.on("pointerup", stop);
    this.input.on("pointerupoutside", stop);
    this.input.on("gameout", () => {
      stop();
      this.hoverCell = null;
    });
  }

  private cellAt(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    const v = content.valley;
    const x = colAt(p.x, v.width);
    const y = rowAt(p.y, v.height);
    return x === null || y === null ? null : { x, y };
  }

  private tryPlace(x: number, y: number, quiet = false): void {
    if (!this.selectedDef) return;
    const r = this.game_.apply({ type: "place", defId: this.selectedDef.id, x, y });
    if (r) {
      const c = this.cellCenter(x, y);
      this.effects.push({ kind: "flash", x: c.x, y: c.y, color: COLORS.refusal, ttl: 250, life: 250 });
      if (!quiet || r === "no-meat" || r === "would-block") this.toast(REFUSAL_TEXT[r], true);
    }
  }

  private selectDef(def: DinoDef): void {
    this.selectedDef = def;
    this.selectedDino = null;
    this.showSheet(false);
  }

  private send(): void {
    const r = this.game_.apply({ type: "send" });
    if (r) this.toast(REFUSAL_TEXT[r], true);
  }

  private cycleSpeed(): void {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.speedButton.label.setText(`${this.speed}x`);
  }

  private grow(): void {
    if (this.selectedDino === null) return;
    const r = this.game_.apply({ type: "grow", dinoId: this.selectedDino });
    if (r) this.toast(REFUSAL_TEXT[r], true);
  }

  private sell(): void {
    if (this.selectedDino === null) return;
    const r = this.game_.apply({ type: "sell", dinoId: this.selectedDino });
    if (r) this.toast(REFUSAL_TEXT[r], true);
    else {
      this.selectedDino = null;
      this.showSheet(false);
    }
  }

  /** For tests and debugging from the console. */
  get sim(): Game {
    return this.game_;
  }
}
