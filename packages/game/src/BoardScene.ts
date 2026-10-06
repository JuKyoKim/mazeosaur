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
  MIN_HIT,
  SELECT_BORDER,
  SELECT_LIFT,
  SHEET_COL_W,
  colAt,
  gridTop,
  rowAt,
} from "./layout.js";
import { sheetLines } from "./sheet.js";
import { COLORS, KIND_COLOR, text } from "./theme.js";
import { SfxBus } from "./audio.js";
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

/**
 * The egg count that gets its own warning, per §6 of
 * `docs/01-art-hud-and-audio.md`. A presentation threshold and not a rule:
 * nothing in the sim knows it, and changing it changes no outcome.
 */
const WARN_EGGS_AT = 3;

/**
 * What an invader looked like at the top of the current tick. The position is
 * the interpolation's `from`; `boss` is here because §6 of
 * `docs/01-art-hud-and-audio.md` gives a boss its own `kill` and `leak`
 * sound, and by the time the event is drained the sim has already removed
 * the invader from `state.invaders`, so its archetype is no longer
 * reachable. Snapshotting it with the position costs nothing: this object is
 * allocated per invader per tick either way.
 */
interface PrevInvader {
  x: number;
  y: number;
  boss: boolean;
}

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

/**
 * The pause menu, centred in the board area with the board still visible
 * behind its scrim. 328px wide to match `RESULTS.again` in `layout.ts`, and
 * `MIN_HIT` tall — these are the first overlay buttons in the client that
 * meet the 44pt hit floor, and a menu whose middle entry throws the run
 * away is exactly where a mis-tap is least acceptable.
 *
 * Here rather than in `layout.ts` because the shipped HUD's own row 1 and
 * the won/lost overlay are still hand-placed literals in this file too; the
 * v1 HUD recut onto `layout.ts`'s `ROW1`/`RESULTS` is what moves all three
 * at once, and splitting them early would leave the geometry in two files
 * disagreeing about which one is the HUD.
 */
const PAUSE_MENU = {
  title: 328,
  sub: 388,
  x: Math.round((CANVAS_W - 328) / 2),
  w: 328,
  h: MIN_HIT,
  resume: 432,
  restart: 528,
  end: 624,
} as const;

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
  /**
   * The clock is stopped. Nothing below the client knows: `packages/sim`
   * has no timers, so "paused" is this scene declining to call `tick()` —
   * no command enters the log, `state.tick` does not move, and a resumed
   * run's hash is the hash it had when the menu opened. A pause the sim
   * knew about would be a determinism change and is not this.
   *
   * Also true for as long as an ended run's results overlay is up, which
   * is what keeps the board from ticking on under it: `won`/`lost` stop
   * the clock by their phase, and an ended run has no phase of its own.
   */
  private paused!: boolean;
  /**
   * The player ended this run from the pause menu. `flush()` writes
   * `run: null` for it exactly as it does for a won or lost one — there is
   * nothing left to resume — but it is *not* a finished run, so it earns
   * no fossils and does not count toward `runsFinished`; see `flush()`.
   */
  private abandoned!: boolean;
  private prevInvaders!: Map<number, PrevInvader>;
  private effects!: Effect[];

  /**
   * Section 6's sound table and its limiter. Built fresh here rather than
   * reset, so a `scene.restart()` cannot inherit a closed limiter and
   * swallow the next run's first hit — see `audio.ts`. The port comes from
   * the registry, so on a shell with no audio this is `NULL_AUDIO_PORT` and
   * every call below is still made and still free.
   */
  private sfx!: SfxBus;
  /** `warn-eggs` is "once" per §6, so the crossing is latched. */
  private warnedEggs!: boolean;

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
  /**
   * Whichever overlay is up: the pause menu, or the end-of-run screen.
   * One field, because only one is ever up and because `wireInput` reads
   * it to make the board inert underneath — a tap on the valley behind a
   * menu must not place a dinosaur.
   */
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
    this.paused = false;
    this.abandoned = false;
    this.prevInvaders = new Map();
    this.effects = [];
    // A fresh bus per run, which is the whole of the restart hazard for
    // audio: no field here holds a display object, but the limiter's
    // timestamps are per-run state and `this.time.now` does not restart
    // with the scene.
    this.sfx = new SfxBus(services(this).audio, () => this.time.now);
    this.warnedEggs = false;
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
    // `paused` gates the accumulator, so a pause is a clock that is not
    // running rather than a state the sim is in: no tick is taken, no
    // command is logged, and `acc` keeps the sub-tick remainder the pause
    // interrupted so the resumed run picks up mid-tick where it left off.
    if (!this.paused && (g.state.phase === "build" || g.state.phase === "migration")) {
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
    // §6: the two layers cross-fade on phase over 1.2s rather than cut, so
    // the scene states the phase every frame and `SfxBus` ignores a repeat.
    // Tracking the transition here instead would mean a second place that
    // has to agree with `game_.state.phase`.
    //
    // `abandoned` is the one case where the phase is not the whole answer:
    // a won or lost run reaches a phase of its own and falls to "none", but
    // an ended run's phase is still `build` or `migration` (see `endRun`),
    // so without this the migration layer would play on under the "The run
    // is over" scrim. The rule is the same either way — no live run, no
    // music. A *paused* run is still live and keeps its layer.
    this.sfx.music(
      this.abandoned
        ? "none"
        : g.state.phase === "build"
          ? "build"
          : g.state.phase === "migration"
            ? "migration"
            : "none",
    );

    const alpha = Math.min(1, this.acc / TICK_MS);
    // Effects age on the same stopped clock. They are purely cosmetic, so
    // letting them run would not desync anything — but an attack line that
    // fades out while the board behind it is frozen reads as the game still
    // being alive, which is the one thing a pause has to deny.
    if (!this.paused) {
      for (const e of this.effects) e.life -= delta;
      this.effects = this.effects.filter((e) => e.life > 0);
    }

    if (this.towersDirty) this.drawTowers();
    this.drawDynamic(alpha);
    this.refreshHud();
  }

  private snapshotPositions(): void {
    this.prevInvaders.clear();
    for (const inv of this.game_.state.invaders) {
      this.prevInvaders.set(inv.id, {
        x: inv.px,
        y: inv.py,
        boss: this.game_.invaderDef(inv).archetype === "boss",
      });
    }
  }

  /**
   * Draws and sounds what the tick did. §6's table names the event each
   * sound fires on, and every one of them is taken from the sim's own event
   * rather than from the command that caused it: the sim decides whether a
   * placement happened, whether a kill was a boss and whether a send was
   * early, so reading the answer here keeps the sound honest even when the
   * command was refused.
   *
   * Nothing here branches on whether audio is available. Every sound has a
   * visual partner in §5.4, so a silent build is the same scene minus the
   * noise, and `NULL_AUDIO_PORT` makes each of these calls free.
   */
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
          const hue = KIND_COLOR[g.dinoDef(d).kind];
          this.effects.push({ kind: "attack", x: from.x, y: from.y, x2: to.x, y2: to.y, color: hue, ttl: 120, life: 120 });
          // §6 fires `hit` on *damage dealt*, and a shield eats the whole
          // attack for `damage: 0` — the ring that draws it is the feedback
          // there, and a tick that did no damage has no tick to make. This
          // is the one sound the board can produce hundreds of times a
          // second, which is what the limiter in `SfxBus` is for.
          if (e.damage > 0) this.sfx.play("hit", hue);
          break;
        }
        case "killed": {
          const p = this.worldFromMilli(e.at.x, e.at.y);
          this.effects.push({ kind: "kill", x: p.x, y: p.y, color: 0xf39c12, ttl: 300, life: 300 });
          // The invader is already out of `state.invaders` by now, so the
          // archetype comes from this tick's snapshot. An invader that both
          // spawned and died inside one tick is not in it and reads as
          // ordinary, which no boss can be: a boss has thousands of HP.
          this.sfx.play(this.prevInvaders.get(e.invaderId)?.boss === true ? "kill-boss" : "kill");
          break;
        }
        case "leaked": {
          const n = this.cellCenter(content.valley.lane.exit.x, content.valley.lane.exit.y);
          this.effects.push({ kind: "leak", x: n.x, y: n.y, color: COLORS.refusal, ttl: 500, life: 500 });
          this.status(`An invader reached the nest: -${e.eggs} egg${e.eggs > 1 ? "s" : ""}`);
          this.sfx.play(this.prevInvaders.get(e.invaderId)?.boss === true ? "leak-boss" : "leak");
          break;
        }
        case "migration-started":
          this.status(e.bonus > 0 ? `Sent early: +${e.bonus} meat` : "The migration begins");
          // Both, when the player sent early: the horn is the answer to
          // their button and the herd call is the migration arriving. The
          // bonus is the sim's own test for "early", so this cannot
          // disagree with the meat the player was just paid.
          if (e.bonus > 0) this.sfx.play("send-early");
          this.sfx.play("migration-start");
          this.autosave();
          break;
        case "migration-cleared":
          this.status(`Migration cleared: +${e.bonus} meat`);
          this.sfx.play("migration-clear");
          this.autosave();
          break;
        case "won":
          this.showOverlay("The nest is safe", `All ${content.migrations.length} migrations turned back with ${g.state.eggs} eggs left.`);
          this.sfx.play("victory");
          this.autosave();
          break;
        case "lost":
          this.showOverlay("The nest is lost", `Fell on migration ${g.state.migration + 1} of ${content.migrations.length}.`);
          this.sfx.play("defeat");
          this.autosave();
          break;
        case "placed":
          this.towersDirty = true;
          this.sfx.play("place", KIND_COLOR[g.dinoDef(e.dino).kind]);
          break;
        case "grown":
          this.towersDirty = true;
          this.sfx.play("grow", KIND_COLOR[g.dinoDef(e.dino).kind]);
          break;
        case "sold":
          this.towersDirty = true;
          this.sfx.play("sell");
          break;
      }
    }
    // §6: "eggs drop to 3", once. Checked after the batch rather than inside
    // the `leaked` case because a boss leak can take the count from 5 to 2
    // and never pass through 3 — the threshold is the warning, not the
    // exact number.
    if (!this.warnedEggs && g.state.eggs <= WARN_EGGS_AT && g.state.phase !== "lost") {
      this.warnedEggs = true;
      this.sfx.play("warn-eggs");
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
   * The blink is this scene's clock and nothing else — not `state.tick`.
   * The sim has no timers and must not grow one for a decoration (CLAUDE.md
   * rule 1), and keeping it off the tick also means the speed toggle does
   * not speed the beacon up. A triangle wave rather than a sine: the hard
   * turn at each end is what makes it read as a light blinking instead of a
   * line breathing.
   *
   * `playedMs()` rather than `this.time.now`, so the route holds still under
   * the pause scrim for the same reason the effects do: the one thing a
   * pause has to deny is the board looking alive, and lights marching
   * spawn-to-nest over a frozen migration deny it loudest. The two clocks
   * are the same clock while a run is running — `pause()` folds the session
   * into `playedMsBase` before stopping it, so the value does not jump at
   * either edge — and neither is the sim's.
   */
  private drawAirRoute(gfx: Phaser.GameObjects.Graphics): void {
    if (!this.migrationHasFliers()) return;
    const lane = content.valley.lane;
    const from = this.cellCenter(lane.spawn.x, lane.spawn.y);
    const to = this.cellCenter(lane.exit.x, lane.exit.y);
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len === 0) return;
    const a = this.game_.state.phase === "migration" ? AIR_ROUTE_SUBDUED : AIR_ROUTE_LOUD;

    const blink = this.airRouteBlink();
    const ux = (to.x - from.x) / len;
    const uy = (to.y - from.y) / len;

    // The line under the lights, so the route is a route between blinks
    // and not a dotted suggestion. Dim at both strengths: the lights are
    // the signal, this is what joins them up.
    gfx.lineStyle(a.width, KIND_COLOR.flier, a.line);
    gfx.lineBetween(from.x, from.y, to.x, to.y);

    gfx.fillStyle(KIND_COLOR.flier, a.lightMin + (a.lightMax - a.lightMin) * blink);
    const march = ((this.playedMs() % AIR_ROUTE_MARCH_MS) / AIR_ROUTE_MARCH_MS) * AIR_ROUTE_SPACING;
    for (let d = march; d < len; d += AIR_ROUTE_SPACING) {
      gfx.fillCircle(from.x + ux * d, from.y + uy * d, a.radius);
    }
  }

  /**
   * The lights' alpha wave: 0 -> 1 -> 0 across `AIR_ROUTE_BLINK_MS`. Its
   * own method so the `airRoute` getter a test reads is the same arithmetic
   * the lights are drawn with, rather than a second copy that could drift
   * from it. Returns a number, not an object, because the draw path
   * allocates nothing.
   */
  private airRouteBlink(): number {
    const t = (this.playedMs() % AIR_ROUTE_BLINK_MS) / AIR_ROUTE_BLINK_MS;
    return t < 0.5 ? t * 2 : 2 - t * 2;
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
      const prev = this.prevInvaders.get(inv.id);
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

    // row 1: numbers, then the three clock controls at the right.
    //
    // Pause came out of Send's width rather than out of the row: Send is
    // the widest control here and its longest label ("Send  +25" at 19px)
    // needs under 96px, where the timer slot and the two toggles have no
    // slack at all. Send keeps its left edge and the row keeps its right
    // edge at `CONTENT_RIGHT`, so nothing that was already placed moves.
    // The row is over-packed either way — "Migration 50/50" reaches into
    // the timer's slot at the widest, which is the v1 HUD recut's to fix.
    this.meatText = this.add.text(16, y0 + 16, "", text(22, COLORS.meat));
    this.eggsText = this.add.text(150, y0 + 16, "", text(22, COLORS.eggs));
    this.waveText = this.add.text(272, y0 + 16, "", text(22));
    this.timerText = this.add.text(420, y0 + 16, "", text(22, COLORS.textDim));
    this.sendButton = this.button(496, y0 + 8, 96, 42, "Send", () => this.send(), 19);
    // Not kept as a field: its label never changes, so `refreshHud` has no
    // reason to hold it and the restart rule has one less field to reset.
    this.button(600, y0 + 8, 48, 42, "Pause", () => this.pause(), 15);
    this.speedButton = this.button(656, y0 + 8, 48, 42, "1x", () => this.cycleSpeed(), 19);

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

  /**
   * The scrim every overlay sits on, with the board still legible behind
   * it. Two jobs beyond the dimming:
   *
   * It **swallows the tap**. The rectangle is interactive and sits above
   * the HUD in the display list, but Phaser keeps walking the candidates
   * under a pointer unless one of them cancels the event — so without the
   * `stopPropagation` here a tap on the scrim reached the live Send and
   * speed buttons behind it. Harmless on a won or lost run, whose phase
   * refuses a `send` anyway; not harmless on an ended run, which is still
   * in `build` and would have taken the command.
   *
   * And `onTap` is the dismiss gesture. Only the pause menu has one: a
   * won, lost or ended run has nothing behind the scrim to go back to.
   */
  private scrim(onTap?: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const r = this.add.rectangle(0, 0, CANVAS_W, CANVAS_H, 0x000000, 0.7).setOrigin(0, 0).setInteractive();
    r.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onTap?.();
    });
    c.add(r);
    return c;
  }

  /** How far this run got, as one line. The pause menu's and the results screen's. */
  private runLine(): string {
    const s = this.game_.state;
    const total = content.migrations.length;
    return `Migration ${Math.min(s.migration + 1, total)}/${total} · ${s.eggs} eggs · ${s.meat} meat`;
  }

  /** The end-of-run screen: won, lost, or ended by the player. Terminal. */
  private showOverlay(title: string, sub: string): void {
    if (this.overlay) return;
    const c = this.scrim();
    c.add(this.add.text(CANVAS_W / 2, BOARD_H / 2 - 60, title, text(48)).setOrigin(0.5));
    c.add(this.add.text(CANVAS_W / 2, BOARD_H / 2 + 4, sub, text(22, COLORS.textDim)).setOrigin(0.5));
    const b = this.button(CANVAS_W / 2 - 120, BOARD_H / 2 + 60, 240, 64, "Play again", () => this.scene.restart(), 22);
    c.add([b.bg, b.label]);
    this.overlay = c;
  }

  private closeOverlay(): void {
    // Containers are exclusive by default, so this destroys the scrim, the
    // labels and the buttons with it. `create()` nulls the field on a
    // restart, which destroys the whole display list anyway; this is the
    // path that has to clean up without one.
    this.overlay?.destroy();
    this.overlay = null;
  }

  // ----------------------------------------------------------- pause menu

  /**
   * Pause. The owner asked for "pause/menu … standard option to end game
   * and such standard ui" (ARB-216 item 2), which is three entries: back
   * to the run, start it over, or stop playing it.
   *
   * Opening the menu does not disarm the tray or close a dinosaur's sheet:
   * resuming has to put the player back exactly where they were, and a
   * selection is where they were.
   */
  private pause(): void {
    if (this.overlay) return;
    this.paused = true;
    // Time in a menu is not time played: fold the session so far into the
    // base now, and `playedMs()` adds nothing more until `resume()` starts
    // a new session. Without this a run left paused overnight would save
    // with a night on its clock.
    this.playedMsBase += this.time.now - this.sessionStartMs;

    const c = this.scrim(() => this.resume());
    c.add(this.add.text(CANVAS_W / 2, PAUSE_MENU.title, "Paused", text(48)).setOrigin(0.5));
    c.add(this.add.text(CANVAS_W / 2, PAUSE_MENU.sub, this.runLine(), text(22, COLORS.textDim)).setOrigin(0.5));
    const entries = [
      { y: PAUSE_MENU.resume, label: "Resume", fill: COLORS.buttonActive, onClick: () => this.resume() },
      { y: PAUSE_MENU.restart, label: "Restart run", fill: COLORS.button, onClick: () => this.restartRun() },
      { y: PAUSE_MENU.end, label: "End run", fill: COLORS.buttonDanger, onClick: () => this.endRun() },
    ];
    for (const e of entries) {
      const b = this.button(PAUSE_MENU.x, e.y, PAUSE_MENU.w, PAUSE_MENU.h, e.label, e.onClick, 24);
      b.bg.setFillStyle(e.fill);
      c.add([b.bg, b.label]);
    }
    this.overlay = c;
  }

  private resume(): void {
    this.closeOverlay();
    // A new play session starts here, so the paused span is never counted.
    this.sessionStartMs = this.time.now;
    this.paused = false;
  }

  /**
   * The run is over by the player's choice. Nothing is left to resume, so
   * `flush()` writes `run: null` — see `abandoned`, and see `flush()` for
   * why that is still not a *finished* run.
   */
  private abandonRun(): void {
    this.abandoned = true;
    // The tray goes with the run. `drawDynamic` draws a placement preview
    // wherever a card is armed and the pointer has been, and that ghost
    // sits on the board behind the results screen — a run that is over
    // showing a cell it is about to build on. Seen in the drive.
    this.selectedDef = null;
    this.selectedDino = null;
    this.hoverCell = null;
    this.setPanelVisible(false);
    this.autosave();
  }

  /**
   * Start this seed over. The clock stays stopped until `create()` clears
   * `paused`, so the abandoned board cannot tick in the frames between.
   *
   * The discard is not optional. `create()` resumes `doc.run` whenever it
   * is non-null, and `flush()` has been keeping an in-flight run on `doc`
   * since the first autosave — so a restart that skipped `abandonRun()`
   * would hand back the very run it was asked to throw away. The won/lost
   * path gets this for free, because its own `flush()` already wrote
   * `run: null` before the overlay offered "Play again"; a mid-run restart
   * is the first path that does not.
   */
  private restartRun(): void {
    this.abandonRun();
    this.closeOverlay();
    this.scene.restart();
  }

  /**
   * Stop playing. Section 5.1's `results` scene is where this goes once it
   * exists, and `title` after that; until then the end-of-run overlay the
   * won and lost paths already draw *is* the results screen, so ending a
   * run shows that rather than inventing a second shape for it.
   *
   * `paused` stays true underneath, which is what stops the board ticking
   * on behind the scrim — an ended run's phase is still `build` or
   * `migration`, so unlike a win or a loss it has nothing else to stop it.
   */
  private endRun(): void {
    this.abandonRun();
    this.closeOverlay();
    this.showOverlay("The run is over", `${this.runLine()}. Nothing to resume.`);
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
        // §6's `select` fires on "a dinosaur is tapped", which is this tap
        // and not a tray card: the card's own feedback is the lift and the
        // border, and arming a kind is not yet a thing that happened on the
        // valley.
        //
        // No hue: §6 gives `select` "a short soft tick", and names the kind
        // only for `place`, `grow` and `hit`. The sink pitches whatever hue
        // it is handed, so passing one here would pitch a sound the spec
        // does not pitch. If §6 is amended to want a pitched tick, pass
        // `KIND_COLOR[this.game_.dinoDef(dino).kind]` and it comes back.
        this.sfx.play("select");
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
      // Every refusal, and only a refusal: §6 gives `blocked` "a dry wooden
      // click, no tone" precisely so it cannot be mistaken for a placement.
      // `place` is not fired here — it comes from the sim's `placed` event
      // below, so a sound can never claim a dinosaur the sim refused.
      this.sfx.play("blocked");
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
    // An abandoned run is as unresumable as a finished one, so it is
    // written the same way: `run: null`. It is deliberately *not* folded
    // into `finished` — see `accountFinish` below, which still tests only
    // the won/lost phases, because a run the player walked out of did not
    // finish and must not earn its fossils or its `profile.best` entry.
    const run: RunSave | null = finished || this.abandoned
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
          playedMs: this.playedMs(),
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

  /**
   * How long this run has been played. `pause()` folds the elapsed session
   * into `playedMsBase` and `resume()` starts a new one, so a paused run
   * adds nothing here — a `suspend()` flush that lands while the menu is
   * up (every `visibilitychange` to hidden does) must not re-count the
   * span the pause already banked.
   */
  private playedMs(): number {
    return this.playedMsBase + (this.paused ? 0 : this.time.now - this.sessionStartMs);
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
   * How many sounds §6's cap threw away this run, for a drive from the
   * console. The limiter's own behaviour is asserted in
   * `test/audio.test.ts` against an injected clock; what a browser adds is
   * the ratio under a real migration, which is the number that says whether
   * the cap is doing anything at all on this content. Nothing reads it.
   */
  get sfxDropped(): number {
    return this.sfx.dropped;
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
   * The fliers' air route, for tests and debugging from the console:
   * whether it is on screen, which of its two strengths it is at, and the
   * segment it runs along. A test can assert the client's line is the
   * lane's spawn-to-nest segment, which is the claim `drawAirRoute` makes
   * about the sim — reading it off the canvas could only say that
   * *something* blue was drawn.
   *
   * `blink` is the triangle wave the lights' alpha is read off, so a test
   * can assert the route holds still under the pause scrim. Two samples a
   * stopped clock apart are the same number; two a running clock apart are
   * not.
   */
  get airRoute(): { shown: boolean; subdued: boolean; blink: number; from: { x: number; y: number }; to: { x: number; y: number } } {
    const lane = content.valley.lane;
    return {
      shown: this.migrationHasFliers(),
      subdued: this.game_.state.phase === "migration",
      blink: this.airRouteBlink(),
      from: this.cellCenter(lane.spawn.x, lane.spawn.y),
      to: this.cellCenter(lane.exit.x, lane.exit.y),
    };
  }

  /**
   * The clock, for tests and debugging from the console. A pause is
   * invisible to the sim by design, so `state.tick` holding still is the
   * only thing a sim snapshot can see — and that is exactly what a frozen
   * renderer looks like too. These two fields tell the cases apart.
   */
  get clock(): { paused: boolean; abandoned: boolean; speed: number } {
    return { paused: this.paused, abandoned: this.abandoned, speed: this.speed };
  }
}
