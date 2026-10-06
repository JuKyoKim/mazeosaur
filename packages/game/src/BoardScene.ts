import Phaser from "phaser";
import {
  CELL,
  Game,
  TICKS_PER_SECOND,
  type BuildStamp,
  type DinoDef,
  type GameEvent,
  type Refusal,
  type RunSave,
  type SaveDocument,
} from "@mazeosaur/sim";
import { content, hatchlings } from "@mazeosaur/content";
import {
  BOARD_H,
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  HUD_H,
  HUD_Y,
  SELECT_BORDER,
  SELECT_LIFT,
  SHEET_COL_W,
  colAt,
  gridTop,
  rowAt,
} from "./layout.js";
import { sheetLines } from "./sheet.js";
import { COLORS, KIND_COLOR, text } from "./theme.js";
import { services } from "./platform.js";
import { runFinished, runStarted } from "./profile.js";
import { gameForRun } from "./resume.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;
/**
 * The grid's own height in pixels. Content-derived, and the only vertical
 * bound placement and the pointer care about — the HUD's position is not it,
 * and neither is the board area's height. Three facts that shared one name
 * until the HUD was specified, and that are all 1008 for the valley that
 * ships, which is why nothing had broken yet.
 */
const GRID_PX_H = content.valley.height * CELL_PX;
/**
 * Where the grid starts inside the board area, so a short valley sits in the
 * middle of it instead of against the top. Zero for the 28-tall valley that
 * ships and 18 for a 27-tall one — which is why it is *not* a whole number of
 * cells: add it to every cell-to-pixel conversion, and let `rowAt()` subtract
 * it before any pixel-to-cell divide.
 */
const GRID_TOP = gridTop(content.valley.height);

/**
 * The tap ring's reach, in logical pixels: 1.5 cells, per §4 of
 * `docs/01-art-hud-and-audio.md`. It is deliberately wider than the cell
 * tapped — a cell is 3.6mm and a thumb contact patch is 8-10mm, so a mark
 * the size of the thing being tapped is invisible under the finger that
 * made it.
 */
const TAP_RING_R = 54;
/** Long enough to be seen leaving, short enough not to trail the finger. */
const TAP_RING_MS = 120;

interface Effect {
  kind: "attack" | "kill" | "flash" | "leak" | "tap";
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color: number;
  ttl: number;
  life: number;
}

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const REFUSAL_TEXT: Record<Refusal, string> = {
  "out-of-bounds": "Off the valley",
  occupied: "Something is already there",
  "lane-cell": "Can't build on the spawn or the nest",
  "would-block": "That would seal the maze",
  "unknown-dino": "Unknown dinosaur",
  "no-meat": "Not enough meat",
  "invader-in-the-way": "An invader is in the way",
  rock: "Solid rock",
  "not-yours": "No dinosaur there",
  "fully-grown": "Fully grown",
  "wrong-phase": "Not now",
};

/**
 * The whole M1 client in one scene: board, HUD, input. It will split into
 * scenes once there is more than one screen. It never decides a rule; it
 * asks the Game and draws the answer.
 */
// Every field below is declared and never initialised here. create() runs
// again on the same instance for every run, so a value set at the
// declaration would be the first run's value forever; see the scene-graph
// contract in docs/01-v1-architecture.md. The linter enforces it.
export class BoardScene extends Phaser.Scene {
  private game_!: Game;
  private acc!: number;
  private speed!: number;
  private prevPos!: Map<number, { x: number; y: number }>;
  private effects!: Effect[];

  // Persistence. `doc` is the save as loaded, minus `run`, which is
  // rebuilt from `game_` on every autosave; see `flush()`.
  private doc!: SaveDocument;
  private runSeed!: number;
  private startedBy!: BuildStamp;
  private playedMsBase!: number;
  private sessionStartMs!: number;
  // `won`/`lost` is terminal: nothing re-ticks it, so the phase is still
  // `won` or `lost` for as long as the "Play again" overlay is up, and
  // `GameHandle.suspend()` calls `flush()` unconditionally in that window
  // (every `visibilitychange` -> hidden, every `pagehide`). Latches the
  // fossil award and `runsFinished` to once per run so a backgrounded
  // results screen cannot count the same run twice.
  private finishedAccounted!: boolean;

  private staticGfx!: Phaser.GameObjects.Graphics;
  private towerGfx!: Phaser.GameObjects.Graphics;
  private dynGfx!: Phaser.GameObjects.Graphics;
  private towersDirty!: boolean;

  private selectedDef!: DinoDef | null;
  private selectedDino!: number | null;
  /**
   * The cell the placement preview is drawn on: the last cell tapped, or
   * the one under a mouse on a desktop. A tap sets it so the preview is
   * reachable without a hover, which a touchscreen cannot produce.
   */
  private hoverCell!: { x: number; y: number } | null;
  /**
   * The `no-meat` card flash: which card, and until when. Held as state
   * rather than applied as a colour because `refreshHud` rewrites every
   * card's cost colour every frame.
   */
  private cardFlashDefId!: string | null;
  private cardFlashUntil!: number;

  private meatText!: Phaser.GameObjects.Text;
  private eggsText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private statusUntil!: number;
  private previewText!: Phaser.GameObjects.Text;
  /**
   * `restY` is the card's unselected y. The selected card lifts, so the
   * rest position has to be remembered rather than read back off the
   * rectangle — reading it would make the lift cumulative across frames.
   */
  private paletteButtons!: { def: DinoDef; button: Button; restY: number }[];
  private sendButton!: Button;
  private speedButton!: Button;
  /**
   * The sheet's four lines, one Text each. Four and not one string: see
   * `sheet.ts`. A single line is what ran under Grow and Sell for every
   * adult with two modifiers.
   */
  private panelName!: Phaser.GameObjects.Text;
  private panelKind!: Phaser.GameObjects.Text;
  private panelStats!: Phaser.GameObjects.Text;
  private panelExtras!: Phaser.GameObjects.Text;
  private growButton!: Button;
  private sellButton!: Button;
  private overlay!: Phaser.GameObjects.Container | null;

  // Set once in the constructor, not per-run: whether a later create() is
  // "Play again" rather than the scene's first create(). Per §5.3 that
  // transition keeps the same seed instead of drawing a fresh one.
  private hasStarted: boolean;

  constructor(
    private readonly initialDoc: SaveDocument,
    // `LoadOutcome.resumed`: the `Game` the mount-time load's own replay
    // already built, or null. Read and cleared by the first create() --
    // see the comment there -- so a later "Play again" restart can never
    // hand back a Game the previous run already played to its end.
    private resumed: Game | null,
    private readonly nextSeed: () => number,
    private readonly build: BuildStamp,
  ) {
    super("board");
    this.hasStarted = false;
  }

  create(): void {
    // scene.restart() re-runs create() on the same instance: every field
    // that refers to a display object or to the previous run must reset
    // here, or the HUD keeps touching destroyed objects.
    //
    // `initialDoc` is read only once, on the very first create() (the
    // mount-time load from disk). Every later create() -- a "Play again"
    // `scene.restart()` -- reads `doc` instead, which `flush()` has kept
    // current with every profile and run update since. Reading
    // `initialDoc` again on a restart would resurrect the run that just
    // ended (it is frozen at whatever the mount loaded) and discard every
    // profile change -- `runsStarted`, `runsFinished`, `best` -- that
    // happened since. `hasStarted` already exists to tell the two apart.
    //
    // This depends on `doc.run` already being `null` by the time a
    // restart is reachable: the overlay that offers "Play again" only
    // shows after `flush()` has written the won/lost run with `run:
    // null` (see `handleEvents`), and that is currently the only
    // `scene.restart()` in the package. Revisit when `results`/`title`
    // land (§5.1) and `scene.start("board")` becomes a second way in.
    const base = this.hasStarted ? this.doc : this.initialDoc;
    const run = base.run;
    this.doc = { ...base, run: null };
    // Consumed and cleared in this same block, exactly once: `resumed` is
    // only ever meaningful for the mount-time load's `create()`, and a
    // later "Play again" restart must not receive it a second time even
    // though by then `run` above is already null anyway (see the restart
    // note above). Clearing it here, rather than gating it on
    // `hasStarted`, makes that true by construction.
    const resumed = this.resumed;
    this.resumed = null;
    if (run) {
      // `resumed` is the Game the shell's loadSave already replayed to
      // validate this run's hash; reuse it instead of replaying the same
      // log a second time. A shell that gets this wrong and passes null
      // for a non-null run still works -- replay is the fallback. See
      // resume.ts for why that decision lives outside this file.
      this.game_ = gameForRun(content, run, resumed);
      this.runSeed = run.seed;
      this.startedBy = run.startedBy;
      this.playedMsBase = run.playedMs;
    } else {
      // §5.3: board draws a fresh seed on the title->board transition, but
      // every later "again" keeps playing the same seed.
      this.runSeed = this.hasStarted ? this.runSeed : this.nextSeed();
      this.game_ = new Game(content, this.runSeed);
      this.startedBy = this.build;
      this.playedMsBase = 0;
      // A fresh `Game` is one `runsStarted` -- including every "Play
      // again", which is its own fresh run at tick 0. A resumed run was
      // already counted when it first started, in the branch above.
      this.doc = { ...this.doc, profile: runStarted(this.doc.profile) };
    }
    this.hasStarted = true;
    // §1.2: a won/lost run must be accounted for exactly once, even
    // though `suspend()` keeps calling `flush()` while the terminal
    // phase sits under the "Play again" overlay. See `flush()`.
    this.finishedAccounted = false;
    this.sessionStartMs = this.time.now;
    this.acc = 0;
    this.speed = 1;
    this.prevPos = new Map();
    this.effects = [];
    this.towersDirty = true;
    this.selectedDef = null;
    this.selectedDino = null;
    this.hoverCell = null;
    this.cardFlashDefId = null;
    this.cardFlashUntil = 0;
    this.paletteButtons = [];
    this.overlay = null;
    this.statusUntil = 0;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.staticGfx = this.add.graphics();
    this.towerGfx = this.add.graphics();
    this.dynGfx = this.add.graphics();
    this.drawStatic();
    this.buildHud();
    this.wireInput();
    this.refreshHud();
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
          this.autosave();
          break;
        case "migration-cleared":
          this.status(`Migration cleared: +${e.bonus} meat`);
          this.autosave();
          break;
        case "won":
          this.showOverlay("The nest is safe", `All ${content.migrations.length} migrations turned back with ${g.state.eggs} eggs left.`);
          this.autosave();
          break;
        case "lost":
          this.showOverlay("The nest is lost", `Fell on migration ${g.state.migration + 1} of ${content.migrations.length}.`);
          this.autosave();
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

  /** Top edge of grid row `y` on the canvas. Every row position goes here. */
  private cellY(y: number): number {
    return GRID_TOP + y * CELL_PX;
  }

  private cellCenter(x: number, y: number): { x: number; y: number } {
    return { x: x * CELL_PX + CELL_PX / 2, y: this.cellY(y) + CELL_PX / 2 };
  }

  /**
   * Diagonal hatching across a square, which is the refused preview's
   * second channel (§4: "the hatching is not decoration"). Section 8 step 5
   * calls it "the blocked hatching" by name.
   *
   * **Every number here is §4's** — 3px stripes of `ink` at alpha 1, 8px
   * apart, over the fill at 0.45 — and §4 carries the measurements behind
   * them. Change them there, not here.
   *
   * The one thing worth keeping next to the code is why the width is what
   * moved. Contrast ratio does not distinguish these options at all: once a
   * tenth of the cell is solid ink and a tenth is solid fill, the 10th/90th
   * percentile is just measuring the two colours and reads the same for 2px,
   * 3px and a tighter spacing alike. What separates them is how much of the
   * cell is actually at those extremes rather than smeared between them by
   * antialiasing a diagonal, which is RMS luminance modulation: 3px lifts it
   * from 61% to 81%, where a tighter spacing gives 74% and raising the fill
   * to 0.60 gives only 64%.
   *
   * Clipped by arithmetic rather than by a mask or a render texture: each
   * stripe is a chord of the square clamped to its own edges, so this is
   * `lineBetween` calls into the graphics object already being filled and
   * allocates nothing. A mask here would cost a second draw and a texture
   * per preview cell, on the one draw path that runs every frame.
   */
  private hatchCell(gfx: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
    gfx.lineStyle(3, COLORS.ink, 1);
    // Lines of slope -1, i.e. x + y = k. Stepping k by 8 puts them 8/√2 =
    // 5.7px apart measured across the stripes, so 3px of ink leaves ~2.7px
    // of gap — still gaps, so it reads as hatching rather than as a fill.
    for (let k = 8; k < size * 2; k += 8) {
      // Where x + y = k meets the square: clamp both ends into [0, size].
      const ax = Math.max(0, k - size);
      const ay = k - ax;
      const by = Math.max(0, k - size);
      const bx = k - by;
      gfx.lineBetween(x + ax, y + ay, x + bx, y + by);
    }
  }

  private worldFromMilli(px: number, py: number): { x: number; y: number } {
    return { x: (px * CELL_PX) / CELL, y: GRID_TOP + (py * CELL_PX) / CELL };
  }

  private drawStatic(): void {
    const gfx = this.staticGfx;
    const v = content.valley;
    gfx.clear();
    gfx.fillStyle(COLORS.boardBg, 1);
    gfx.fillRect(0, 0, CANVAS_W, BOARD_H);
    gfx.lineStyle(1, COLORS.gridLine, 1);
    // The grid, not the board area: the lines stop where the cells do.
    for (let x = 0; x <= v.width; x++) gfx.lineBetween(x * CELL_PX, GRID_TOP, x * CELL_PX, GRID_TOP + GRID_PX_H);
    for (let y = 0; y <= v.height; y++) gfx.lineBetween(0, this.cellY(y), CANVAS_W, this.cellY(y));

    const mark = (p: { x: number; y: number }, color: number, label: string) => {
      const c = this.cellCenter(p.x, p.y);
      gfx.fillStyle(color, 1);
      gfx.fillRect(p.x * CELL_PX + 2, this.cellY(p.y) + 2, CELL_PX - 4, CELL_PX - 4);
      this.add.text(c.x, c.y, label, text(16, "#111")).setOrigin(0.5);
    };
    mark(v.lane.spawn, COLORS.spawn, "S");
    v.lane.checkpoints.forEach((c, i) => mark(c, COLORS.checkpoint, String(i + 1)));
    mark(v.lane.exit, COLORS.nest, "N");
    for (const r of v.rock) {
      gfx.fillStyle(0x4a4a4a, 1);
      gfx.fillRect(r.x * CELL_PX, this.cellY(r.y), CELL_PX, CELL_PX);
    }
  }

  private drawTowers(): void {
    const gfx = this.towerGfx;
    gfx.clear();
    for (const d of this.game_.state.dinos) {
      const def = this.game_.dinoDef(d);
      const x = d.x * CELL_PX;
      const y = this.cellY(d.y);
      gfx.fillStyle(KIND_COLOR[def.kind], 1);
      gfx.fillRoundedRect(x + 3, y + 3, CELL_PX - 6, CELL_PX - 6, 6);
      // growth stage as pips
      gfx.fillStyle(COLORS.ink, 0.85);
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
        gfx.strokeRect(d.x * CELL_PX + 1, this.cellY(d.y) + 1, CELL_PX - 2, CELL_PX - 2);
      } else {
        this.selectedDino = null;
      }
    } else if (this.hoverCell && this.selectedDef && !g.dinoAt(this.hoverCell.x, this.hoverCell.y)) {
      // The preview is the answer to "did my tap land?", so it must be
      // drawn for a refusal too — nothing drawn reads as a dropped tap
      // rather than as a cell that will not take a dinosaur.
      //
      // `placeRefusal` is a pure query, so the preview is truthful rather
      // than hopeful: the client knows before the commit whether the cell
      // would refuse. §4's table is the whole specification of what is
      // drawn, and the second channel on a refusal is the hatching, not a
      // hue change — a hue difference alone is not a signal a colour-blind
      // player can rely on.
      //
      // Suppressed over a cell that already holds a dinosaur: a tap there
      // opens that dinosaur's sheet and never refuses, so previewing a
      // refusal on your own finished wall is noise.
      const r = g.placeRefusal(this.selectedDef.id, this.hoverCell.x, this.hoverCell.y);
      const c = this.cellCenter(this.hoverCell.x, this.hoverCell.y);
      const x0 = this.hoverCell.x * CELL_PX;
      const y0 = this.cellY(this.hoverCell.y);
      if (r) {
        gfx.fillStyle(COLORS.refusal, 0.45);
        gfx.fillRoundedRect(x0 + 3, y0 + 3, CELL_PX - 6, CELL_PX - 6, 6);
        this.hatchCell(gfx, x0 + 3, y0 + 3, CELL_PX - 6);
      } else {
        gfx.fillStyle(KIND_COLOR[this.selectedDef.kind], 0.45);
        gfx.fillRoundedRect(x0 + 3, y0 + 3, CELL_PX - 6, CELL_PX - 6, 6);
        gfx.lineStyle(1, COLORS.selection, 0.35);
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
        case "tap":
          // The one thing the committed sprite cannot say: that the tap was
          // *registered*. Without it a refused tap and a dropped tap look
          // identical, and "nothing happened" is the worst feedback the game
          // can give. Expands from the cell centre to TAP_RING_R and fades.
          gfx.lineStyle(2, e.color, t * 0.6);
          gfx.strokeCircle(e.x, e.y, (1 - t) * TAP_RING_R);
          break;
      }
    }
  }

  // ----------------------------------------------------------------- HUD

  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, size = 20): Button {
    const bg = this.add.rectangle(x, y, w, h, COLORS.button).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const t = this.add.text(x + w / 2, y + h / 2, label, text(size)).setOrigin(0.5);
    bg.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick();
      p.event.preventDefault?.();
    });
    return { bg, label: t };
  }

  private buildHud(): void {
    const y0 = HUD_Y;
    this.add.rectangle(0, y0, CANVAS_W, HUD_H, COLORS.hud).setOrigin(0, 0);

    // row 1: numbers, then send and speed at the right
    this.meatText = this.add.text(16, y0 + 16, "", text(22, COLORS.meat));
    this.eggsText = this.add.text(150, y0 + 16, "", text(22, COLORS.eggs));
    this.waveText = this.add.text(272, y0 + 16, "", text(22));
    this.timerText = this.add.text(420, y0 + 16, "", text(22, COLORS.textDim));
    this.sendButton = this.button(496, y0 + 8, 144, 42, "Send", () => this.send(), 19);
    this.speedButton = this.button(648, y0 + 8, 56, 42, "1x", () => this.cycleSpeed(), 19);

    // row 2: one button per kind
    const py = y0 + 58;
    const bw = Math.floor((CANVAS_W - 32 - (hatchlings.length - 1) * 4) / hatchlings.length);
    hatchlings.forEach((def, i) => {
      const b = this.button(16 + i * (bw + 4), py, bw, 62, "", () => this.selectDef(def), 14);
      b.bg.setFillStyle(KIND_COLOR[def.kind], 0.25);
      b.label.setText(`${def.name}\n${def.cost} meat`).setAlign("center");
      this.paletteButtons.push({ def, button: b, restY: py });
    });

    // row 3: status + next migration
    this.statusText = this.add.text(16, y0 + 126, "", text(18, COLORS.textDim));
    this.previewText = this.add.text(16, y0 + 152, "", text(18));

    // Row 4, the selected dinosaur's sheet. Four text lines, so the panel
    // is 86px rather than the 68 two lines needed and starts 16px higher;
    // the status and preview rows above moved up by 6 to pay for it. The
    // panel still ends inside the HUD: y0 + 180 + 86 = y0 + 266 < HUD_H.
    const panelY = y0 + 180;
    this.add.rectangle(8, panelY, CANVAS_W - 16, 86, COLORS.hudPanel).setOrigin(0, 0);
    // `SHEET_COL_W` on every line, as a hard wrap rather than as a hope:
    // a content edit that lengthens a line wraps it instead of running it
    // under the buttons. `tests/client/dino-sheet.spec.ts` asserts no def
    // in the shipped content actually reaches the wrap.
    const col = { wordWrap: { width: SHEET_COL_W } };
    this.panelName = this.add.text(20, panelY + 4, "", { ...text(20), ...col });
    this.panelKind = this.add.text(20, panelY + 28, "", { ...text(15, COLORS.textDim), ...col });
    this.panelStats = this.add.text(20, panelY + 46, "", { ...text(15), ...col });
    this.panelExtras = this.add.text(20, panelY + 64, "", { ...text(15, COLORS.textDim), ...col });
    this.growButton = this.button(CANVAS_W - 336, panelY + 17, 190, 52, "Grow", () => this.grow(), 17);
    this.sellButton = this.button(CANVAS_W - 136, panelY + 17, 120, 52, "Sell", () => this.sell(), 17);
    this.sellButton.bg.setFillStyle(COLORS.buttonDanger);
    this.setPanelVisible(false);
    // Nothing is armed at the start of a run, and that is a change from
    // the drag era, where `selectDef(hatchlings[0])` ran here. Under a
    // drag an armed tray was harmless: you had to press and move to
    // spend anything. Under tap-to-place it means the first tap anywhere
    // on the valley buys a dinosaur the player never chose — and worse,
    // their first tap on the lit card *cancels* it, because the card is
    // a toggle, so the tray reads as a card that cannot be selected.
  }

  private setPanelVisible(v: boolean): void {
    this.panelName.setVisible(v);
    this.panelKind.setVisible(v);
    this.panelStats.setVisible(v);
    this.panelExtras.setVisible(v);
    this.growButton.bg.setVisible(v);
    this.growButton.label.setVisible(v);
    this.sellButton.bg.setVisible(v);
    this.sellButton.label.setVisible(v);
  }

  private refreshHud(): void {
    const g = this.game_;
    const s = g.state;
    this.meatText.setText(`Meat ${s.meat}`);
    this.eggsText.setText(`Eggs ${s.eggs}`);
    const total = content.migrations.length;
    const shown = Math.min(s.migration + 1, total);
    this.waveText.setText(`Migration ${shown}/${total}`);
    if (s.phase === "build") {
      this.timerText.setText(`${Math.ceil(s.buildTimer / TICKS_PER_SECOND)}s`);
      const bonus = g.earlySendBonus();
      this.sendButton.label.setText(bonus > 0 ? `Send  +${bonus}` : "Send");
      this.sendButton.bg.setFillStyle(COLORS.buttonActive);
    } else {
      this.timerText.setText(s.phase === "migration" ? `${s.invaders.length + s.spawnQueue.length} left` : "");
      this.sendButton.label.setText("Send");
      this.sendButton.bg.setFillStyle(COLORS.button);
    }

    const m = g.currentMigration();
    if (m) {
      const desc = m.groups
        .map((gr) => {
          const inv = content.invaders[gr.invader];
          return inv ? `${gr.count}× ${inv.name} · ${inv.archetype} ${inv.kind}` : gr.invader;
        })
        .join(", ");
      this.previewText.setText(`${s.phase === "migration" ? "Now" : "Next"}: ${m.name} — ${desc}`);
    } else {
      this.previewText.setText("");
    }

    if (this.time.now > this.statusUntil) this.statusText.setText("");

    // The lit card is the only thing on screen that says what a tap on the
    // board will do. §4 of docs/01-art-hud-and-audio.md specifies three
    // channels and none of them is hue: a SELECT_LIFT px lift, a
    // SELECT_BORDER px `selection` border, and a larger silhouette. The
    // card's interior does not change at all, which is deliberate — every
    // text-on-panel contrast pair in §3's table stays as measured.
    //
    // The silhouette channel is the frame generator's; these cards carry a
    // text label rather than a sprite, so the lift and the border are the
    // two this scene can draw. Named in `selection-channels` below.
    //
    // `selectDef` toggles on exactly this condition — see the note there.
    for (const { def, button, restY } of this.paletteButtons) {
      const active = this.selectedDef?.id === def.id && this.selectedDino === null;
      const y = active ? restY - SELECT_LIFT : restY;
      button.bg.setStrokeStyle(active ? SELECT_BORDER : 0, COLORS.selection);
      button.bg.setY(y);
      button.label.setY(y + button.bg.height / 2);
      button.bg.setFillStyle(KIND_COLOR[def.kind], 0.25);
      // The cost's own colour says whether this kind is affordable. On a
      // `no-meat` refusal it flashes `refusal` instead, because that is
      // where the cause is — see `flashCardCost`.
      const flashing = this.cardFlashDefId === def.id && this.time.now < this.cardFlashUntil;
      button.label.setColor(
        flashing ? COLORS.refusalText : s.meat >= def.cost ? COLORS.text : COLORS.textDim,
      );
    }

    if (this.selectedDino !== null) {
      const d = s.dinos.find((x) => x.id === this.selectedDino);
      if (d) {
        const def = g.dinoDef(d);
        const lines = sheetLines(def);
        this.panelName.setText(lines.name);
        this.panelKind.setText(lines.kind);
        this.panelStats.setText(lines.stats);
        this.panelExtras.setText(lines.extras);
        const next = def.growsTo ? content.dinos[def.growsTo] : undefined;
        this.growButton.label.setText(next ? `Grow → ${next.name}\n${next.cost} meat` : "Fully grown").setAlign("center");
        this.growButton.label.setColor(next && s.meat >= next.cost ? COLORS.text : COLORS.textDim);
        this.sellButton.label.setText(`Sell\n+${g.sellValue(d)}`).setAlign("center");
      }
    }
  }

  private status(msg: string): void {
    this.statusText.setText(msg);
    this.statusUntil = this.time.now + 2000;
  }

  private showOverlay(title: string, sub: string): void {
    if (this.overlay) return;
    const c = this.add.container(0, 0);
    c.add(this.add.rectangle(0, 0, CANVAS_W, CANVAS_H, 0x000000, 0.7).setOrigin(0, 0).setInteractive());
    c.add(this.add.text(CANVAS_W / 2, BOARD_H / 2 - 60, title, text(48)).setOrigin(0.5));
    c.add(this.add.text(CANVAS_W / 2, BOARD_H / 2 + 4, sub, text(22, COLORS.textDim)).setOrigin(0.5));
    const b = this.button(CANVAS_W / 2 - 120, BOARD_H / 2 + 60, 240, 64, "Play again", () => this.scene.restart(), 22);
    c.add([b.bg, b.label]);
    this.overlay = c;
  }

  // --------------------------------------------------------------- input

  /**
   * One gesture places: tap a kind in the tray, then tap a cell. There is
   * no drag path. A fast finger mis-places on a phone — it paints the
   * line it crossed on the way to where the player was aiming — and a
   * single tap per dinosaur is what the arcade this is modelled on does.
   *
   * Selection is **one-shot**: a placement spends it, so every dinosaur is
   * two taps and a wall of N cells is 2N. A refusal does not spend it —
   * see `tryPlace`. Cancel survives that change and is still two gestures,
   * re-tapping the lit card and tapping bare HUD: one-shot makes a stranded
   * selection rarer, not impossible, and both are in the owner's ask.
   */
  private wireInput(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.overlay) return;
      const cell = this.cellAt(p);
      if (!cell) {
        // Off the board: bare HUD, or off-canvas. A tray card, Send, the
        // speed toggle, Grow and Sell all stop propagation in `button()`,
        // so this only ever fires for HUD chrome — which makes it the
        // "tap away to put the dinosaur back" half of cancel. It cannot
        // be an empty *cell* instead: an empty cell is always a placement
        // target, which is what the armed card is for.
        this.selectedDef = null;
        this.hoverCell = null;
        return;
      }
      // Every tap on a cell leaves the ring, drawn here — before the sim is
      // called — so it marks the tap and not its outcome. A tap that places,
      // a tap that refuses and a tap on a dinosaur all acknowledge
      // themselves, which is the whole point: the ring says "registered",
      // and what happened next is the toast's job or the meat count's.
      this.tapRing(cell.x, cell.y);
      const dino = this.game_.dinoAt(cell.x, cell.y);
      if (dino) {
        // The two selections are mutually exclusive (§4): inspecting a
        // dinosaur disarms the tray, and dismissing the sheet does not
        // restore the kind it replaced. One selection is live at a time, so
        // what a tap on a cell will do is never ambiguous.
        this.selectedDino = dino.id;
        this.selectedDef = null;
        this.hoverCell = null;
        this.setPanelVisible(true);
        return;
      }
      // Drawing the preview under the finger before placing is what makes
      // a refusal legible: the tap that was refused leaves the invalid
      // state on screen next to its toast.
      this.hoverCell = cell;
      if (this.selectedDino !== null) {
        // A tap on an empty cell with a sheet open closes the sheet. It
        // cannot also place, because opening the sheet disarmed the tray —
        // which is the mutual exclusion above, and is why the old
        // fall-through is gone rather than merely unused.
        this.selectedDino = null;
        this.setPanelVisible(false);
        return;
      }
      if (this.selectedDef) this.tryPlace(cell.x, cell.y);
    });
    // Desktop only: a touchscreen never hovers, which is why the tap above
    // sets `hoverCell` as well.
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.hoverCell = this.cellAt(p);
    });
    this.input.on("gameout", () => {
      this.hoverCell = null;
    });
  }

  private cellAt(p: Phaser.Input.Pointer): { x: number; y: number } | null {
    // `rowAt` subtracts the grid's inset before dividing. An integer divide
    // on its own is right for the 28-tall valley and one row out for any
    // other, and it would present as a drag-interpolation bug.
    const v = content.valley;
    const x = colAt(p.x, v.width);
    const y = rowAt(p.y, v.height);
    if (x === null || y === null) return null;
    return { x, y };
  }

  /** Acknowledges a tap on a cell. See `TAP_RING_R` for why it is 54px. */
  private tapRing(x: number, y: number): void {
    const c = this.cellCenter(x, y);
    this.effects.push({
      kind: "tap",
      x: c.x,
      y: c.y,
      color: COLORS.selection,
      ttl: TAP_RING_MS,
      life: TAP_RING_MS,
    });
  }

  /**
   * One tap, one attempt, and every refusal says why. There used to be a
   * `quiet` flag here, because a drag crossing the trail would otherwise
   * fire the same toast forty times in a second; with one placement per
   * tap there is nothing left to suppress, and a silent refusal is
   * indistinguishable from a tap the client dropped.
   *
   * **A placement spends the selection; a refusal does not.** That is the
   * owner's call of 2026-10-05 and it is the whole of one-shot: every
   * dinosaur is tap the card, then tap the cell. It is the safer half of
   * the trade — a stray tap on the valley costs nothing once the card has
   * been spent, where a selection that persisted would buy a dinosaur on
   * whatever the thumb brushed. The cost is a tap per cell on a long wall,
   * which the owner accepted; do not add a repeat affordance to claw it
   * back.
   *
   * The asymmetry is the point and not an oversight: a refused tap placed
   * nothing, so there is nothing to spend, and re-arming after it would
   * punish the player for a tap the game rejected. Refusal keeping the
   * card lit is also now the *only* path that does, which makes it the
   * sharper of the two tests.
   *
   * Feedback goes where the cause is (§4), which is why `no-meat` is the
   * one refusal that also marks the *card*: the cell did nothing wrong and
   * the fix is on the card, not on the valley. `would-block` and `rock`
   * never flash the card — those are facts about the cell.
   */
  private tryPlace(x: number, y: number): void {
    if (!this.selectedDef) return;
    const r = this.game_.apply({ type: "place", defId: this.selectedDef.id, x, y });
    if (r) {
      const c = this.cellCenter(x, y);
      this.effects.push({ kind: "flash", x: c.x, y: c.y, color: COLORS.refusal, ttl: 250, life: 250 });
      this.status(REFUSAL_TEXT[r]);
      if (r === "no-meat") this.flashCardCost(this.selectedDef.id);
      return;
    }
    // Placed. Spend the selection — the same two fields `selectDef` clears
    // when it toggles a lit card off, so the tray lands in one "nothing
    // armed" state however it got there.
    this.selectedDef = null;
    this.hoverCell = null;
  }

  /**
   * Flashes one tray card's cost line `refusal` once. `refreshHud` runs
   * every frame and rewrites this colour from the affordability test, so
   * the flash is a timestamp it reads rather than a colour set here —
   * otherwise the next frame would erase it.
   */
  private flashCardCost(defId: string): void {
    this.cardFlashDefId = defId;
    this.cardFlashUntil = this.time.now + 300;
  }

  /**
   * A tray card. Tapping the card that is already lit clears the
   * selection — the other half of cancel, and the discoverable one.
   *
   * The toggle tests the same condition `refreshHud` lights the card by,
   * so what the player sees and what the tap does cannot disagree: with a
   * dinosaur's sheet open no card is lit, and tapping the selected kind
   * there closes the sheet and re-arms it rather than clearing it.
   */
  private selectDef(def: DinoDef): void {
    if (this.selectedDef?.id === def.id && this.selectedDino === null) {
      this.selectedDef = null;
      this.hoverCell = null;
      return;
    }
    this.selectedDef = def;
    this.selectedDino = null;
    this.setPanelVisible(false);
  }

  private send(): void {
    const r = this.game_.apply({ type: "send" });
    if (r) this.status(REFUSAL_TEXT[r]);
  }

  private cycleSpeed(): void {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.speedButton.label.setText(`${this.speed}x`);
  }

  private grow(): void {
    if (this.selectedDino === null) return;
    const r = this.game_.apply({ type: "grow", dinoId: this.selectedDino });
    if (r) this.status(REFUSAL_TEXT[r]);
  }

  private sell(): void {
    if (this.selectedDino === null) return;
    const r = this.game_.apply({ type: "sell", dinoId: this.selectedDino });
    if (r) this.status(REFUSAL_TEXT[r]);
    else {
      this.selectedDino = null;
      this.setPanelVisible(false);
    }
  }

  // ---------------------------------------------------------- persistence

  /**
   * Writes the current run to the store. Called at phase boundaries
   * (autosave) and by `GameHandle.suspend()` when the shell is about to
   * background the app. A won or lost run is written with `run: null`:
   * there is nothing left to resume.
   */
  flush(): Promise<void> {
    const phase = this.game_.state.phase;
    const finished = phase === "won" || phase === "lost";
    const run: RunSave | null = finished
      ? null
      : {
          valleyId: content.valley.id,
          seed: this.runSeed,
          contentVersion: content.version,
          startedBy: this.startedBy,
          // Copied, not aliased: `IndexedDbSaveStore` may coalesce this
          // write up to `COALESCE_MS` into the future, and `tick`/`hash`
          // above are a snapshot of right now. A live reference to
          // `game_.log` would pick up whatever commands land on it
          // before the deferred write actually commits, landing a log
          // past the saved tick and failing replay on the next boot.
          log: [...this.game_.log],
          tick: this.game_.state.tick,
          hash: this.game_.hash(),
          playedMs: this.playedMsBase + (this.time.now - this.sessionStartMs),
        };
    // §1.7: a won or lost run writes `profile.best`, exactly once. `won`
    // and `lost` are terminal, so the phase is still `finished` for as
    // long as the "Play again" overlay is up, and `suspend()` calls
    // `flush()` unconditionally on every later tab-hide or `pagehide` in
    // that window -- without the latch, each of those would hand the
    // already-finished run to `runFinished` again and double (or
    // triple...) `fossilsEarned` and `runsFinished`. The award comes from
    // `content.rules.fossilWeights`, never a number here -- rule 4.
    const accountFinish = finished && !this.finishedAccounted;
    const profile = accountFinish
      ? runFinished(this.doc.profile, content.rules.fossilWeights, {
          valleyId: content.valley.id,
          seed: this.runSeed,
          contentVersion: content.version,
          migrationsCleared: this.game_.state.migration,
          eggsLeft: this.game_.state.eggs,
          meatUnspent: this.game_.state.meat,
        })
      : this.doc.profile;
    if (accountFinish) this.finishedAccounted = true;
    this.doc = { ...this.doc, run, profile, writtenBy: this.build };
    return services(this).saves.put(this.doc);
  }

  /** Fire-and-forget `flush()`: a storage error must never interrupt a running game. */
  private autosave(): void {
    this.flush().catch((err: unknown) => {
      // No HUD surface for a background save failure; the player keeps playing.
      console.error("mazeosaur: autosave failed", err);
    });
  }

  /** For tests and debugging from the console. */
  get sim(): Game {
    return this.game_;
  }

  /**
   * What is selected, for tests and debugging from the console. The input
   * model is now two taps where it was one drag, so "which kind is armed"
   * is a state a test has to be able to assert — a placement count alone
   * cannot tell a cleared selection from a refused tap.
   */
  get selection(): { kindId: string | null; dinoId: number | null; preview: { x: number; y: number } | null } {
    return { kindId: this.selectedDef?.id ?? null, dinoId: this.selectedDino, preview: this.hoverCell };
  }

  /**
   * The sheet's four lines as the renderer actually laid them out: the
   * width each one came to, and how many lines the wrap broke it into.
   *
   * This exists because the only honest check of "the text fits" is the
   * measured one. The content is data, the font is the platform's, and the
   * string lengths are not knowable from the layout constants — so the
   * guard against a content edit pushing a line under the Grow button has
   * to read real metrics out of a running client, which is what
   * `tests/client/dino-sheet.spec.ts` does with this.
   */
  get sheetWidths(): { name: number; kind: number; stats: number; extras: number; lines: number } {
    const rows = [this.panelName, this.panelKind, this.panelStats, this.panelExtras];
    return {
      name: this.panelName.width,
      kind: this.panelKind.width,
      stats: this.panelStats.width,
      extras: this.panelExtras.width,
      lines: rows.reduce((n, t) => n + t.getWrappedText(t.text).length, 0),
    };
  }
}
