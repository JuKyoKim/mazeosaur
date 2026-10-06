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
  CONTENT_W,
  GUTTER,
  HUD_H,
  HUD_Y,
  ROW1,
  ROW1_WRAP,
  ROW2,
  ROW2_TEXT_WRAP,
  ROW3,
  SELECT_BORDER,
  SELECT_LIFT,
  SHEET_COL_W,
  TOAST,
  TYPE,
  colAt,
  gridTop,
  kindButtonX,
  rowAt,
} from "./layout.js";
import { sheetLines } from "./sheet.js";
import { COLORS, KIND_COLOR, text, wrapped } from "./theme.js";
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

/** Distance between the air route's lights along the line, in logical px. */
const AIR_ROUTE_SPACING = 48;
/**
 * How long one light takes to march into the next light's slot. The whole
 * row shifts one slot per cycle and then wraps, so the march is seamless
 * and the direction of travel — spawn to nest — is readable from it.
 */
const AIR_ROUTE_MARCH_MS = 900;
/** One full dim-bright-dim of the lights. A second reads as a beacon. */
const AIR_ROUTE_BLINK_MS = 1000;
/**
 * The route's two strengths. During a build phase the fliers are the thing
 * the player is about to be unable to maze against, so the route is as
 * loud as a HUD mark on the board gets. Once they are actually in the air
 * the same line would compete with the invaders flying along it, so it
 * drops to a trace: still there to be checked, never the brightest thing
 * on the board.
 */
const AIR_ROUTE_LOUD = { line: 0.3, lightMin: 0.45, lightMax: 1, width: 3, radius: 5 };
const AIR_ROUTE_SUBDUED = { line: 0.12, lightMin: 0.15, lightMax: 0.35, width: 2, radius: 3 };

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

/**
 * Anything a tray card is made of. All three have `setY` and `setVisible`,
 * which is all a lift and a tray swap need.
 */
type CardPart = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;

/**
 * One kind's card in the shop tray: the box, the silhouette, the kind name
 * and the cost. `parts`/`restY` are parallel, and the lift is applied to the
 * rest position rather than to wherever the part is now — reading the
 * current y back would make the lift cumulative across frames.
 */
interface TrayCard {
  def: DinoDef;
  bg: Phaser.GameObjects.Rectangle;
  art: Phaser.GameObjects.Graphics;
  cost: Phaser.GameObjects.Text;
  parts: CardPart[];
  restY: number[];
}

/** How long a toast stays, and the fade it leaves on. §4 of the art spec. */
const TOAST_MS = 1600;
const TOAST_FADE_MS = 200;
/** The toast panel's opacity, per §4: the board stays readable behind it. */
const TOAST_ALPHA = 0.78;

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

  /** Row 1. The build timer is a bar and not digits — see `buildRow1`. */
  private hudGfx!: Phaser.GameObjects.Graphics;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private meatText!: Phaser.GameObjects.Text;
  private eggsText!: Phaser.GameObjects.Text;
  private migrationValue!: Phaser.GameObjects.Text;
  private sendButton!: Button;
  private speedButton!: Button;

  /** Row 2, the one line that says what is coming. */
  private previewChip!: Phaser.GameObjects.Rectangle;
  private previewText!: Phaser.GameObjects.Text;
  private previewMeta!: Phaser.GameObjects.Text;
  /** What row 2 is already showing, so `refreshPreview` can do nothing. */
  private previewKey!: string;

  /** Row 3's two trays. Exactly one of them is on screen at a time. */
  private trayCards!: TrayCard[];
  private sheetPanel!: Phaser.GameObjects.Rectangle;
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

  /** The toast, over the board rather than in a HUD row. */
  private toastPanel!: Phaser.GameObjects.Rectangle;
  private toastBar!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private toastUntil!: number;

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
    this.trayCards = [];
    this.overlay = null;
    this.toastUntil = 0;
    // "" is not any migration's key, so the first `refreshPreview` of a
    // run always rebuilds row 2 rather than trusting the previous run's.
    this.previewKey = "";
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
          this.toast(`An invader reached the nest: -${e.eggs} egg${e.eggs > 1 ? "s" : ""}`, false);
          break;
        }
        case "migration-started":
          this.announceMigration(e.bonus);
          this.autosave();
          break;
        case "migration-cleared":
          this.toast(`Migration cleared: +${e.bonus} meat`, false);
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

  /**
   * True when the migration the preview row is naming — the one in the air
   * during a migration, the one coming during a build phase — contains a
   * flier. `InvaderDef.flying` is the predicate and `currentMigration()` is
   * the same source `refreshHud` reads `Now:`/`Next:` off, so the route and
   * that row can never disagree about which migration is meant.
   *
   * Indexed rather than `.some()`: this runs once per frame in the draw
   * path, and a closure per frame is a closure per frame.
   */
  private migrationHasFliers(): boolean {
    const phase = this.game_.state.phase;
    if (phase !== "build" && phase !== "migration") return false;
    const m = this.game_.currentMigration();
    if (!m) return false;
    for (let i = 0; i < m.groups.length; i++) {
      const group = m.groups[i];
      if (group && content.invaders[group.invader]?.flying) return true;
    }
    return false;
  }

  /**
   * The fliers' air route: a line of blinking lights from the lane's spawn
   * to the nest, marching the way the fliers will.
   *
   * **That line is the whole route.** A flying invader never touches the
   * flow field — `moveInvaders` in `packages/sim/src/game.ts` sends it at
   * the nest centre with `moveToward` and scores its `progress` as a
   * manhattan distance to that cell — so its path is the segment between
   * the two cells the lane already names, and no wall the player builds
   * bends it. Not seeing that is what makes a flier migration feel unfair
   * rather than hard: the player reads their maze as the answer to every
   * migration, and for this one it is not the answer at all.
   *
   * Drawn only when a flier is actually in the migration being named, so
   * the route means "this one goes over your maze" rather than being
   * scenery. Both ends come from `content.valley.lane`; a map with a
   * different spawn or nest moves the line with no change here.
   *
   * The blink is this scene's clock and nothing else — `this.time.now`,
   * not `state.tick`. The sim has no timers and must not grow one for a
   * decoration (CLAUDE.md rule 1), and keeping it off the tick also means
   * the speed toggle does not speed the beacon up. A triangle wave rather
   * than a sine: the hard turn at each end is what makes it read as a
   * light blinking instead of a line breathing.
   */
  private drawAirRoute(gfx: Phaser.GameObjects.Graphics): void {
    if (!this.migrationHasFliers()) return;
    const lane = content.valley.lane;
    const from = this.cellCenter(lane.spawn.x, lane.spawn.y);
    const to = this.cellCenter(lane.exit.x, lane.exit.y);
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len === 0) return;
    const a = this.game_.state.phase === "migration" ? AIR_ROUTE_SUBDUED : AIR_ROUTE_LOUD;

    // 0 -> 1 -> 0 across AIR_ROUTE_BLINK_MS.
    const t = (this.time.now % AIR_ROUTE_BLINK_MS) / AIR_ROUTE_BLINK_MS;
    const blink = t < 0.5 ? t * 2 : 2 - t * 2;
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;

    // The line under the lights, so the route is a route between blinks
    // and not a dotted suggestion. Dim at both strengths: the lights are
    // the signal, this is what joins them up.
    gfx.lineStyle(a.width, KIND_COLOR.flier, a.line);
    gfx.lineBetween(from.x, from.y, to.x, to.y);

    gfx.fillStyle(KIND_COLOR.flier, a.lightMin + (a.lightMax - a.lightMin) * blink);
    const march = ((this.time.now % AIR_ROUTE_MARCH_MS) / AIR_ROUTE_MARCH_MS) * AIR_ROUTE_SPACING;
    for (let d = march; d < len; d += AIR_ROUTE_SPACING) {
      gfx.fillCircle(from.x + ux * d, from.y + uy * d, a.radius);
    }
  }

  private drawDynamic(alpha: number): void {
    const gfx = this.dynGfx;
    const g = this.game_;
    gfx.clear();

    // Under everything else this layer draws — the route is context for
    // the board, and must never be the thing the eye lands on when there
    // is an invader or a placement preview to read instead.
    this.drawAirRoute(gfx);

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

  /**
   * A tap on a HUD control. `stopPropagation` is what keeps the scene's own
   * `pointerdown` — the "tap away to cancel" gesture — from also firing, so
   * every interactive thing in the HUD has to go through here.
   */
  private onTap(obj: Phaser.GameObjects.GameObject, onClick: () => void): void {
    obj.setInteractive({ useHandCursor: true });
    obj.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick();
      p.event.preventDefault?.();
    });
  }

  private button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, size = 20): Button {
    const bg = this.add.rectangle(x, y, w, h, COLORS.button).setOrigin(0, 0);
    const t = this.add.text(x + w / 2, y + h / 2, label, text(size)).setOrigin(0.5);
    this.onTap(bg, onClick);
    return { bg, label: t };
  }

  /**
   * The HUD is `layout.ts`'s three rows, and every number it draws comes
   * from there. It used to be four bands of literals in this function, and
   * all five of its controls were under the 44pt hit floor both platforms
   * publish — Send and the speed toggle at 22.8pt, the kind cards at
   * 33.6pt, Grow and Sell at 28.2pt. That was not fixable by nudging the
   * old layout: the shop (128px) and the sheet (107px) stacked are 235px
   * into the 136px row 3 has, so **the tray swaps instead of stacking**,
   * and once it does, the rest of the HUD has to be where `layout.ts` says
   * it is for the row to be free. The status line left the HUD for the
   * toast and the timer digits became a bar for the same reason: both were
   * sitting in space row 2 and row 3 need.
   */
  private buildHud(): void {
    this.add.rectangle(0, HUD_Y, CANVAS_W, HUD_H, COLORS.hud).setOrigin(0, 0);
    this.hudGfx = this.add.graphics();

    this.buildRow1();
    this.buildRow2();
    this.buildRow3();
    this.buildToast();

    this.showSheet(false);
    // Nothing is armed at the start of a run, and that is a change from
    // the drag era, where `selectDef(hatchlings[0])` ran here. Under a
    // drag an armed tray was harmless: you had to press and move to
    // spend anything. Under tap-to-place it means the first tap anywhere
    // on the valley buys a dinosaur the player never chose — and worse,
    // their first tap on the lit card *cancels* it, because the card is
    // a toggle, so the tray reads as a card that cannot be selected.
  }

  /**
   * Row 1: the build timer as a draining bar along the seam, then meat,
   * eggs, which migration, Send and the speed toggle.
   *
   * **The timer shows no digits.** A full-width bar on the boundary between
   * board and HUD is legible without being read, which is the point — in a
   * build phase the player is looking at the grid. It is also the early-send
   * affordance: what is left of the bar *is* the bonus. And the arithmetic
   * agrees with the design (§4): the band between the migration readout at
   * 320 and Send at 444 is 124px, of which `MIGRATION` takes 108, so a digit
   * field does not fit there at any value.
   */
  private buildRow1(): void {
    const bar = ROW1.timerBar;
    this.add.rectangle(bar.x, bar.y, bar.w, bar.h, COLORS.hudPanel).setOrigin(0, 0);
    this.timerBar = this.add.rectangle(bar.x, bar.y, bar.w, bar.h, COLORS.buttonActive).setOrigin(0, 0);

    // Meat and eggs are an icon and a count rather than a labelled field:
    // 214 and 14 are read as shapes. Flat placeholders until the atlas
    // lands — the sprite drops into the same box.
    const meat = ROW1.meatIcon;
    const egg = ROW1.eggIcon;
    this.hudGfx.fillStyle(COLORS.meatFill, 1);
    this.hudGfx.fillRoundedRect(meat.x, meat.y, meat.w, meat.h, 8);
    this.hudGfx.fillStyle(COLORS.eggsFill, 1);
    this.hudGfx.fillEllipse(egg.x + egg.w / 2, egg.y + egg.h / 2, egg.w, egg.h);

    this.meatText = this.add.text(ROW1.meatValue.x, ROW1.meatValue.y, "", wrapped(TYPE.vital, ROW1_WRAP.meat, COLORS.meat));
    this.eggsText = this.add.text(ROW1.eggValue.x, ROW1.eggValue.y, "", wrapped(TYPE.vital, ROW1_WRAP.eggs, COLORS.eggs));

    // `label` over `body` at one x, and not one line: `MIGRATION 49 / 50`
    // on one line runs 61px into Send. Stacking it is why row 1 is 96 tall
    // rather than the 82 the hit floor alone asks for.
    this.add.text(ROW1.migrationLabel.x, ROW1.migrationLabel.y, "MIGRATION", text(TYPE.label, COLORS.textDim));
    this.migrationValue = this.add.text(
      ROW1.migrationValue.x,
      ROW1.migrationValue.y,
      "",
      wrapped(TYPE.body, ROW1_WRAP.migration),
    );

    this.sendButton = this.button(ROW1.send.x, ROW1.send.y, ROW1.send.w, ROW1.send.h, "Send", () => this.send(), TYPE.body);
    this.speedButton = this.button(ROW1.speed.x, ROW1.speed.y, ROW1.speed.w, ROW1.speed.h, "1x", () => this.cycleSpeed(), TYPE.body);
  }

  /**
   * Row 2: the one line that says what is coming. A kind chip carries the
   * hue, then the count and genus, then the archetype and kind dim and
   * right-aligned. Information only — nothing in this row takes a pointer,
   * which is the whole reason 40px is allowed to sit under the hit floor.
   */
  private buildRow2(): void {
    this.previewChip = this.add
      .rectangle(ROW2.chip.x, ROW2.chip.y, ROW2.chip.w, ROW2.chip.h, COLORS.hudPanel)
      .setOrigin(0, 0);
    this.previewText = this.add.text(ROW2.text.x, ROW2.text.y, "", wrapped(TYPE.body, ROW2_TEXT_WRAP));
    // Anchored to the content edge, which is what `setOrigin(1, 0)` buys:
    // the string is variable and its right edge is not.
    this.previewMeta = this.add
      .text(ROW2.meta.right, ROW2.meta.y, "", wrapped(TYPE.label, ROW2.meta.w, COLORS.textDim))
      .setOrigin(1, 0);
  }

  /**
   * Row 3, both trays, built once and swapped by `showSheet`. The shop is
   * six kind cards; the sheet is four text lines plus Grow and Sell. They
   * share the 136px row because only one of them is ever on screen, and
   * that swap is the onboarding too (§8): tapping a dinosaur and watching
   * the shop become a sheet with a Grow button on it is how a player
   * discovers growing without being told.
   */
  private buildRow3(): void {
    const kb = ROW3.kindButton;
    hatchlings.forEach((def, i) => {
      const x = kindButtonX(i);
      const cx = x + kb.w / 2;
      const hue = KIND_COLOR[def.kind];

      const bg = this.add.rectangle(x, kb.y, kb.w, kb.h, hue, 0.22).setOrigin(0, 0);
      this.onTap(bg, () => this.selectDef(def));

      // The silhouette, as a flat shape in the kind's hue until the atlas
      // lands. Drawn centred on its own origin so the selected card can
      // grow it with `setScale` — §4's third selection channel is 56px to
      // 60px, and a Graphics cannot be resized without being redrawn.
      const art = this.add.graphics({ x: cx, y: kb.y + ROW3.kindArt.dy + ROW3.kindArt.h / 2 });
      art.fillStyle(hue, 1);
      art.fillRoundedRect(-ROW3.kindArt.w / 2, -ROW3.kindArt.h / 2, ROW3.kindArt.w, ROW3.kindArt.h, 10);

      const name = this.add.text(cx, kb.y + ROW3.kindName.dy, def.kind, text(TYPE.label)).setOrigin(0.5, 0);

      // The cost is a meat pip and a number, placed as one object so the
      // pair reads as a price rather than as two marks.
      const pip = this.add.graphics({ x: cx - ROW3.kindCost.pipGap - ROW3.kindCost.pipR, y: kb.y + ROW3.kindCost.dy + TYPE.label / 2 });
      pip.fillStyle(COLORS.meatFill, 1);
      pip.fillCircle(0, 0, ROW3.kindCost.pipR);
      const cost = this.add
        .text(cx + ROW3.kindCost.pipGap, kb.y + ROW3.kindCost.dy, `${def.cost}`, text(TYPE.label, COLORS.meat))
        .setOrigin(0.5, 0);

      const parts: CardPart[] = [bg, art, name, pip, cost];
      this.trayCards.push({ def, bg, art, cost, parts, restY: parts.map((p) => p.y) });
    });

    this.sheetPanel = this.add.rectangle(GUTTER, kb.y, CONTENT_W, kb.h, COLORS.hudPanel).setOrigin(0, 0);
    // `SHEET_COL_W` on every line, as a hard wrap rather than as a hope:
    // a content edit that lengthens a line wraps it instead of running it
    // under the buttons. `tests/client/dino-sheet.spec.ts` asserts no def
    // in the shipped content actually reaches the wrap.
    this.panelName = this.add.text(ROW3.sheetName.x, ROW3.sheetName.y, "", wrapped(TYPE.title, SHEET_COL_W));
    this.panelKind = this.add.text(ROW3.sheetKind.x, ROW3.sheetKind.y, "", wrapped(TYPE.label, SHEET_COL_W, COLORS.textDim));
    this.panelStats = this.add.text(ROW3.sheetStats.x, ROW3.sheetStats.y, "", wrapped(TYPE.body, SHEET_COL_W));
    this.panelExtras = this.add.text(ROW3.sheetExtras.x, ROW3.sheetExtras.y, "", wrapped(TYPE.label, SHEET_COL_W, COLORS.textDim));
    this.growButton = this.button(ROW3.grow.x, ROW3.grow.y, ROW3.grow.w, ROW3.grow.h, "Grow", () => this.grow(), TYPE.label);
    this.sellButton = this.button(ROW3.sell.x, ROW3.sell.y, ROW3.sell.w, ROW3.sell.h, "Sell", () => this.sell(), TYPE.label);
    this.sellButton.bg.setFillStyle(COLORS.buttonDanger);
  }

  /**
   * The toast sits over the bottom of the board and not in a HUD row: it
   * costs no layout height and it puts the message where the eye and the
   * thumb already are. A refusal gets a bar down its left edge; an event
   * does not.
   */
  private buildToast(): void {
    this.toastPanel = this.add.rectangle(TOAST.x, TOAST.y, TOAST.w, TOAST.h, COLORS.hud).setOrigin(0, 0);
    this.toastBar = this.add.rectangle(TOAST.x, TOAST.y, TOAST.barW, TOAST.h, COLORS.refusal).setOrigin(0, 0);
    this.toastText = this.add
      .text(TOAST.x + TOAST.pad, TOAST.y + TOAST.h / 2, "", wrapped(TYPE.body, TOAST.w - TOAST.pad * 2))
      .setOrigin(0, 0.5);
    this.hideToast();
  }

  /**
   * Swap the tray. The shop and the sheet are never both on screen — that
   * is what pays for row 3's hit targets, and it is why this is one call
   * and not two visibility flags that could disagree.
   */
  private showSheet(v: boolean): void {
    this.sheetPanel.setVisible(v);
    this.panelName.setVisible(v);
    this.panelKind.setVisible(v);
    this.panelStats.setVisible(v);
    this.panelExtras.setVisible(v);
    this.growButton.bg.setVisible(v);
    this.growButton.label.setVisible(v);
    this.sellButton.bg.setVisible(v);
    this.sellButton.label.setVisible(v);
    for (const card of this.trayCards) for (const p of card.parts) p.setVisible(!v);
  }

  private hideToast(): void {
    this.toastPanel.setVisible(false);
    this.toastBar.setVisible(false);
    this.toastText.setVisible(false);
  }

  private refreshHud(): void {
    const g = this.game_;
    const s = g.state;
    this.meatText.setText(`${s.meat}`);
    this.eggsText.setText(`${s.eggs}`);
    const total = content.migrations.length;
    this.migrationValue.setText(`${Math.min(s.migration + 1, total)} / ${total}`);

    // The bar drains across the build phase and is the early-send
    // affordance at the same time: what is left of it *is* the bonus.
    // `displayWidth` and not a redraw — this runs every frame.
    if (s.phase === "build") {
      const frac = Math.max(0, Math.min(1, s.buildTimer / content.rules.buildPhaseTicks));
      this.timerBar.setVisible(true);
      this.timerBar.displayWidth = ROW1.timerBar.w * frac;
      const bonus = g.earlySendBonus();
      this.sendButton.label.setText(bonus > 0 ? `Send  +${bonus}` : "Send");
      this.sendButton.bg.setFillStyle(COLORS.buttonActive);
    } else {
      this.timerBar.setVisible(false);
      this.sendButton.label.setText("Send");
      this.sendButton.bg.setFillStyle(COLORS.button);
    }

    this.refreshPreview();
    this.refreshToast();

    // The lit card is the only thing on screen that says what a tap on the
    // board will do. §4 of docs/01-art-hud-and-audio.md specifies three
    // channels and none of them is hue: a SELECT_LIFT px lift, a
    // SELECT_BORDER px `selection` border, and a silhouette drawn 1.08
    // larger. The card's interior colour does not change at all, which is
    // deliberate — every text-on-panel contrast pair in §3's table stays
    // as measured.
    //
    // `selectDef` toggles on exactly this condition — see the note there.
    for (const card of this.trayCards) {
      const active = this.selectedDef?.id === card.def.id && this.selectedDino === null;
      const dy = active ? -SELECT_LIFT : 0;
      for (let i = 0; i < card.parts.length; i++) card.parts[i]!.setY(card.restY[i]! + dy);
      card.bg.setStrokeStyle(active ? SELECT_BORDER : 0, COLORS.selection);
      card.art.setScale(active ? ROW3.kindArt.selectedW / ROW3.kindArt.w : 1);
      // The cost's own colour says whether this kind is affordable, and the
      // silhouette stays at full strength either way (§4): an unaffordable
      // card is still a label, just not yet a purchase. On a `no-meat`
      // refusal the cost flashes `refusal`, because that is where the cause
      // is — see `flashCardCost`.
      const flashing = this.cardFlashDefId === card.def.id && this.time.now < this.cardFlashUntil;
      card.cost.setColor(flashing ? COLORS.refusalText : s.meat >= card.def.cost ? COLORS.meat : COLORS.textDim);
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

  /**
   * Row 2's line. Rebuilt only when the migration or the phase changes, not
   * every frame: this runs inside `refreshHud` on the draw path, and the
   * three strings it would otherwise allocate sixty times a second never
   * differ between two frames of the same migration.
   *
   * The *headline* group and not every group. Row 2 is one 40px line and a
   * migration can carry several groups, so it names the largest one — the
   * thing the player has to answer — and counts the rest. The migration's
   * own name moved to the toast it is announced in, where there is room for
   * it.
   */
  private refreshPreview(): void {
    const s = this.game_.state;
    const m = this.game_.currentMigration();
    const key = m ? `${s.phase}|${s.migration}` : "";
    if (key === this.previewKey) return;
    this.previewKey = key;
    if (!m) {
      this.previewChip.setVisible(false);
      this.previewText.setText("");
      this.previewMeta.setText("");
      return;
    }
    const head = m.groups.reduce((a, b) => (b.count > a.count ? b : a));
    const inv = content.invaders[head.invader];
    const rest = m.groups.length - 1;
    this.previewChip.setVisible(true);
    this.previewChip.setFillStyle(inv ? KIND_COLOR[inv.kind] : COLORS.hudPanel);
    this.previewText.setText(
      `${s.phase === "migration" ? "NOW" : "NEXT"}  ${head.count}× ${inv ? inv.name : head.invader}${rest > 0 ? `  +${rest}` : ""}`,
    );
    this.previewMeta.setText(inv ? `${inv.archetype} · ${inv.kind}` : "");
  }

  /**
   * The migration-started toast, which carries the migration's name.
   *
   * Row 2 gave the name up when it became one line of count-and-genus per
   * §4, and this is where it belongs instead: the name is flavour, the
   * toast is the one surface with room for a sentence, and the moment a
   * migration starts is the moment the sentence is about.
   */
  private announceMigration(bonus: number): void {
    const m = this.game_.currentMigration();
    const name = m ? m.name : "The migration";
    this.toast(bonus > 0 ? `${name} — sent early, +${bonus} meat` : name, false);
  }

  /**
   * A message over the bottom of the board: 1.6s, then a 200ms fade (§4).
   * `refusal` is the bar down the left edge, which is the one thing that
   * separates "you cannot do that" from "this happened".
   */
  private toast(msg: string, refusal: boolean): void {
    this.toastText.setText(msg);
    this.toastUntil = this.time.now + TOAST_MS + TOAST_FADE_MS;
    this.toastPanel.setVisible(true);
    this.toastBar.setVisible(refusal);
    this.toastText.setVisible(true);
  }

  /** The fade, driven off the clock rather than a tween, so a restart cannot leave one running. */
  private refreshToast(): void {
    const left = this.toastUntil - this.time.now;
    if (left <= 0) {
      this.hideToast();
      return;
    }
    const a = Math.min(1, left / TOAST_FADE_MS);
    this.toastPanel.setAlpha(TOAST_ALPHA * a);
    this.toastBar.setAlpha(a);
    this.toastText.setAlpha(a);
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
        // speed toggle, Grow and Sell all stop propagation in `onTap`,
        // so this only ever fires for HUD chrome — which makes it the
        // "tap away to put the dinosaur back" half of cancel. It cannot
        // be an empty *cell* instead: an empty cell is always a placement
        // target, which is what the armed card is for.
        //
        // It clears *both* selections, and that matters more since row 3
        // became a swapping tray: an open sheet now hides the shop, so a
        // gesture that cancelled the card and left the sheet up would be a
        // cancel that cannot reach the thing the player wants back.
        // Tapping an empty cell closes the sheet too (§4) — this is the
        // same idea on the one part of the canvas that is not a cell.
        this.selectedDef = null;
        this.selectedDino = null;
        this.hoverCell = null;
        this.showSheet(false);
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
        this.showSheet(true);
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
        this.showSheet(false);
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
      this.toast(REFUSAL_TEXT[r], true);
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

  /**
   * Every control a finger is supposed to be able to hit, as the renderer
   * actually built it: the live rectangle's position and size, read off the
   * display object rather than off `layout.ts`.
   *
   * The point is the gap between those two things.
   * `packages/game/test/layout.test.ts` already proves the *constants*
   * clear the 44pt floor, and they did while every control on screen was
   * under it — because `buildHud` was writing its own numbers and nothing
   * compared the two. That is the defect ARB-186 fixed, and this is what
   * makes it unable to come back quietly:
   * `tests/client/hud-hit-targets.spec.ts` reads this out of a running
   * client and measures it.
   *
   * Both trays are reported, whichever is on screen: a hidden control still
   * has its geometry, and the alternative is a test that silently measures
   * five of the seven.
   */
  get hudTargets(): { name: string; x: number; y: number; w: number; h: number }[] {
    const box = (name: string, r: Phaser.GameObjects.Rectangle) => ({
      name,
      x: r.x,
      y: r.y,
      w: r.displayWidth,
      h: r.displayHeight,
    });
    return [
      box("Send", this.sendButton.bg),
      box("speed toggle", this.speedButton.bg),
      ...this.trayCards.map((c, i) => box(`kind card ${i}`, c.bg)),
      box("Grow", this.growButton.bg),
      box("Sell", this.sellButton.bg),
    ];
  }

  /**
   * The fliers' air route, for tests and debugging from the console:
   * whether it is on screen, which of its two strengths it is at, and the
   * segment it runs along. A test can assert the client's line is the
   * lane's spawn-to-nest segment, which is the claim `drawAirRoute` makes
   * about the sim — reading it off the canvas could only say that
   * *something* blue was drawn.
   */
  get airRoute(): { shown: boolean; subdued: boolean; from: { x: number; y: number }; to: { x: number; y: number } } {
    const lane = content.valley.lane;
    return {
      shown: this.migrationHasFliers(),
      subdued: this.game_.state.phase === "migration",
      from: this.cellCenter(lane.spawn.x, lane.spawn.y),
      to: this.cellCenter(lane.exit.x, lane.exit.y),
    };
  }
}
