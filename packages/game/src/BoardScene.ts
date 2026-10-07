import Phaser from "phaser";
import {
  CELL,
  Game,
  TICKS_PER_SECOND,
  type BuildStamp,
  type DinoDef,
  type GameEvent,
  type Kind,
  type Refusal,
  type RunSave,
  type SaveDocument,
} from "@mazeosaur/sim";
import { content, hatchlings } from "@mazeosaur/content";
import { ATLAS, STRIKE_FRAMES, TOY_BOX_SCALE, loadToyBox } from "./atlas.js";
import {
  BOARD_H,
  CANVAS_H,
  CANVAS_W,
  CELL_PX,
  CONTENT_W,
  GUTTER,
  HUD_H,
  HUD_Y,
  MIN_HIT,
  PAUSE_MENU,
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
import { MIGRATION_LABEL, migrationCounter } from "./row1.js";
import { sheetLines } from "./sheet.js";
import { COLORS, KIND_COLOR, text, wrapped } from "./theme.js";
import { SfxBus } from "./audio.js";
import { again, boardEntry, type BoardEntry } from "./entry.js";
import { services } from "./platform.js";
import { runFinished, runStarted } from "./profile.js";
import { gameForRun } from "./resume.js";
import { runSummary } from "./summary.js";
import type { Outcome } from "./summary.js";

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

/**
 * One drawn attack strike: §5.4.1's second `hit` layer, which says *which
 * kind* is hitting where the tracer says which invader is being hit. Not an
 * `Effect` because it is drawn with a sprite out of the toy-box atlas
 * rather than into `dynGfx`, and because its clip outlives the tracer.
 *
 * `x`/`y` are the world centre of the dinosaur's own cell, resolved once at
 * the event. A dinosaur does not move, so there is nothing to re-resolve
 * per frame, and a strike whose thrower was sold still finishes playing
 * where the animal stood — which is right: the hit it draws did happen.
 */
interface Strike {
  kind: Kind;
  x: number;
  y: number;
  ttl: number;
  life: number;
}

/**
 * §5.4.1's three steps, in the order they are held: the wind-up for 50ms,
 * full extension for 90ms, and the mark left behind for 120ms while the
 * whole thing fades. These are the `hit` row's 80ms *spent* rather than
 * added to it.
 *
 * Held as elapsed-time boundaries compared against one countdown, not as
 * three timers: a strike ages on `this.effects`' stopped clock, so a
 * paused board holds its frame instead of finishing the clip behind a
 * frozen game.
 */
const STRIKE_STEP_MS = [50, 90, 120] as const;
const STRIKE_TTL = STRIKE_STEP_MS[0] + STRIKE_STEP_MS[1] + STRIKE_STEP_MS[2];
/**
 * Reduced motion (§7): the clip does not play. Step 2 alone, for its own
 * 90ms, fading — it is the frame that carries the kind, so the information
 * survives and the movement does not.
 */
const STRIKE_REDUCED_MS = STRIKE_STEP_MS[1];
/**
 * How many strikes may be live at once, which is also the cap on the
 * sprite pool.
 *
 * §2's target is ~250 dinosaurs. A strike lives 260ms and the shortest
 * cooldown in content is 26 ticks — 1.3s, or 433ms at 3x — so one live
 * strike per dinosaur is the real ceiling and this is it, rounded up.
 * Past the cap a strike is simply not drawn, and nothing else changes:
 * §5.4.1 is explicit that the hit is never gated behind the clip, so the
 * damage, the tracer and the sound have all already landed.
 */
const STRIKE_MAX = 256;

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
  /** §5.4.1's live strikes, capped at `STRIKE_MAX`. */
  private strikes!: Strike[];
  /**
   * The strikes' own layer, and depth is the whole reason it exists.
   * Nothing in this scene sets a depth, so render order is display-list
   * order — and a sprite allocated lazily during `update()` would be added
   * after `buildHud()` ran and draw *over* the HUD. A container created
   * here, between `dynGfx` and the HUD, holds the entire pool at the
   * board's slot however late a member of it is allocated.
   */
  private strikeLayer!: Phaser.GameObjects.Container;
  /**
   * Re-used strike sprites, grown to the board's high-water mark and never
   * freed inside a run. §5.4.1 runs per attack at up to 3x on a phone, so
   * the draw path allocates nothing: a frame assigns the live strikes to
   * the front of this pool and hides the tail.
   *
   * This and `strikeLayer` both hold display objects that `create()`
   * destroys, which is §5.2's reset rule and the reason
   * `tests/client/restart-regression.spec.ts` exists: a restart that
   * inherited either would draw through a destroyed sprite on its first
   * attack and freeze the canvas with the sim running underneath.
   */
  private strikePool!: Phaser.GameObjects.Sprite[];
  /**
   * `prefers-reduced-motion`, read once per run rather than per strike.
   * Per-run rather than per-instance because `create()` re-runs and the
   * setting can change between two runs of the same session.
   */
  private reducedMotion!: boolean;

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

  /**
   * Persistence. The save as this scene last wrote it, minus `run`, which
   * is rebuilt from `game_` on every autosave; see `flush()`.
   *
   * The one field here that is not per-run, and the only one assigned in
   * the constructor: it spans every run this mount plays, because
   * `profile` accumulates across them (`runsStarted`, `runsFinished`,
   * `best`). §5.2's rule still holds — it is not initialised at its
   * declaration, and a re-entry reads what `flush()` left here rather than
   * the mount's frozen document. The mount's document is this field's
   * first value and nothing else; there is no second field holding it, so
   * there is nothing for a re-entry to resurrect.
   */
  private doc: SaveDocument;
  private runSeed!: number;
  private startedBy!: BuildStamp;
  private playedMsBase!: number;
  private sessionStartMs!: number;
  // `won`/`lost` is terminal: nothing re-ticks it, so the phase is still
  // `won` or `lost` for as long as `results` is up, and
  // `GameHandle.suspend()` calls `flush()` unconditionally in that window
  // (every `visibilitychange` -> hidden, every `pagehide`) — this scene is
  // stopped, not destroyed, so `flush()` still reaches a live `game_`.
  // Latches the fossil award and `runsFinished` to once per run so a
  // backgrounded results screen cannot count the same run twice.
  private finishedAccounted!: boolean;
  /**
   * What this run earned, as `runFinished` computed it at the terminal
   * flush. Per-run state, reset in `create()` with the latch above.
   *
   * Kept here rather than recomputed for `results` because §5.4 pays the
   * run in this scene: the award exists once, at the save that latches it,
   * and `showResults()` hands that same number on. `flush()` runs its
   * body synchronously before it awaits the store, so this is already set
   * by the time `showResults()`'s `autosave()` returns.
   */
  private fossilsAwarded!: number;

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
  private pauseButton!: Button;
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

  /**
   * The pause menu's container while it is up, null otherwise.
   *
   * It is the only overlay drawn *inside* this scene. Every way a run ends
   * — won, lost, and the player's own "End run" — goes to the `results`
   * scene, which is a scene and not a container (§5.3). The field keeps
   * its nullable shape and its `create()` reset because the menu is still
   * per-run state holding a display object, and §5.2 makes no exception
   * for the last one left.
   */
  private overlay!: Phaser.GameObjects.Container | null;

  /**
   * How this entry into `board` says it got here (§5.3). Assigned in
   * `init()`, which Phaser runs before `create()` on every start.
   */
  private entry!: BoardEntry;

  constructor(
    initialDoc: SaveDocument,
    // `LoadOutcome.resumed`: the `Game` the mount-time load's own replay
    // already built, or null. Read and cleared by the first create() --
    // see the comment there -- so a later "Play again" restart can never
    // hand back a Game the previous run already played to its end.
    private resumed: Game | null,
    private readonly nextSeed: () => number,
    private readonly build: BuildStamp,
  ) {
    super("board");
    this.doc = initialDoc;
  }

  /**
   * §5.3: every way into `board` says which way it is, as data on the
   * transition. Phaser hands this whatever `scene.start("board", data)` or
   * `scene.restart(data)` passed, and `mountGame` starts the scene
   * explicitly so that the very first entry carries its mode too.
   *
   * The entry is **consumed**, not merely read. Phaser keeps
   * `settings.data` from the previous start, so a caller that passed
   * nothing would silently inherit the last caller's mode — and the mode
   * it would inherit most often is a mid-run `resume`. Clearing it here
   * turns §5.3's third-producer hazard into a throw from `boardEntry`
   * below, at the transition that got it wrong, instead of a board that
   * quietly hands back a run nobody asked for.
   */
  init(data: unknown): void {
    this.entry = boardEntry(data);
    this.sys.settings.data = {};
  }

  /**
   * The only thing this scene loads, and Phaser's own contract is that it
   * completes before `create()` runs — so `create()` may name a frame
   * without checking whether the texture arrived.
   *
   * Where the bytes come from is decision 0005: the bundler, as a
   * content-hashed URL under `/assets/`, and never out of
   * `apps/web/public/`. See `atlas.ts`, which also makes this idempotent
   * across a restart.
   */
  preload(): void {
    loadToyBox(this.load);
  }

  create(): void {
    // scene.restart() re-runs create() on the same instance: every field
    // that refers to a display object or to the previous run must reset
    // here, or the HUD keeps touching destroyed objects.
    //
    // §5.3: the entry mode is the *only* thing that decides whether the
    // document's run is picked up. `resume` is the one mode that plays a
    // saved run; `fresh` and `again` ignore `doc.run` whatever it holds, so
    // no caller has to launder the document before coming in here. That is
    // the whole point of the mode being data on the transition: the old
    // shape read `run` unconditionally and depended on every producer
    // having nulled it first, which is a convention and not a mechanism —
    // and it was about to acquire a third producer (`title`, whose "New
    // run" sits on top of exactly the save it must not resume).
    //
    // A `resume` whose document has no run falls through to the fresh
    // branch with a fresh seed. That is not a programmer error: §1.5 drops
    // an unresumable run at load, so a caller can honestly ask to resume a
    // document that no longer has anything to resume, and a playable board
    // is the right answer.
    const run = this.entry.mode === "resume" ? this.doc.run : null;
    this.doc = { ...this.doc, run: null };
    // Consumed and cleared in this same block, exactly once: `resumed` is
    // only ever meaningful for the mount-time load's `create()`, and a
    // later "Play again" restart must not receive it a second time even
    // though by then `run` above is null anyway, because `again` does not
    // read the document's run at all. Clearing it unconditionally, rather
    // than per mode, makes that true by construction.
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
      // §5.3: `again` plays the seed it was handed; `fresh` draws one.
      // The seed rides the transition rather than surviving on this scene,
      // so nothing in `create()` reads a field the previous run left
      // behind -- which is §5.2's rule, applied to the one field that used
      // to be allowed to break it.
      this.runSeed = this.entry.mode === "again" ? this.entry.seed : this.nextSeed();
      this.game_ = new Game(content, this.runSeed);
      this.startedBy = this.build;
      this.playedMsBase = 0;
      // A fresh `Game` is one `runsStarted` -- including every "Play
      // again", which is its own fresh run at tick 0. A resumed run was
      // already counted when it first started, in the branch above.
      this.doc = { ...this.doc, profile: runStarted(this.doc.profile) };
    }
    // §1.2: a won/lost run must be accounted for exactly once, even
    // though `suspend()` keeps calling `flush()` while the terminal
    // phase sits behind the `results` screen. See `flush()`.
    this.finishedAccounted = false;
    this.fossilsAwarded = 0;
    this.sessionStartMs = this.time.now;
    this.acc = 0;
    this.speed = 1;
    this.paused = false;
    this.abandoned = false;
    this.prevInvaders = new Map();
    this.effects = [];
    this.strikes = [];
    // Read here rather than at the declaration so a player who turns the
    // setting on and taps "Again" gets the reduced clip on the next run
    // without reloading.
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    this.trayCards = [];
    // `wireInput`'s pointerdown returns early whenever this is set, so a
    // field left pointing at the container `shutdown` destroyed reads as an
    // overlay that is up, and neither a cell nor the pause button responds
    // on the restarted board. §5.2's reset rule, and the one field where
    // skipping it produces a board that looks entirely correct in a sim
    // snapshot and in a screenshot while taking no input at all.
    //
    // Every path that raises the pause menu — the only thing `overlay`
    // holds now — does close it before leaving. That is not what this line
    // rests on: the two have come unstuck twice, and the guard above is
    // what makes the failure silent rather than loud.
    this.overlay = null;
    this.toastUntil = 0;
    // "" is not any migration's key, so the first `refreshPreview` of a
    // run always rebuilds row 2 rather than trusting the previous run's.
    this.previewKey = "";
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.staticGfx = this.add.graphics();
    this.towerGfx = this.add.graphics();
    this.dynGfx = this.add.graphics();
    // Above the board and below the HUD, which is display-list order and
    // the reason the pool is parented rather than added to the scene: see
    // `strikeLayer`. Created here, so `buildHud()` below still wins.
    this.strikeLayer = this.add.container(0, 0);
    this.strikePool = [];
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
        this.tickOnce();
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
      for (const s of this.strikes) s.life -= delta;
      this.strikes = this.strikes.filter((s) => s.life > 0);
    }

    if (this.towersDirty) this.drawTowers();
    this.drawDynamic(alpha);
    // Outside the `paused` guard on purpose: a paused board still has to
    // re-assert where its strikes are, because the pool is shared and the
    // sprite one of them is using may have been handed to a different
    // strike on the frame the pause landed.
    this.drawStrikes();
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

  /** One sim tick plus the bookkeeping `update()` runs around it, shared below. */
  private tickOnce(): void {
    this.snapshotPositions();
    this.game_.tick();
    this.handleEvents(this.game_.drainEvents());
  }

  /**
   * Runs exactly `n` ticks through the real per-tick pipeline — the same
   * `tickOnce()` the update loop calls, so a leak, a loss and the overlay
   * it raises all still come from the real code path — without waiting on
   * `update()`'s real-time accumulator to deliver them. That accumulator
   * paces ticks to the browser's actual frame rate, which is what made the
   * client-smoke full-run spec's wall-clock budget hostage to CI frame
   * delivery (ARB-242: the same spec timed out at Playwright's 60s limit on
   * one run and passed in 53.5s on another, no gameplay difference between
   * them). For tests and debugging from the console, like `sim` below;
   * reachable only through `window.mazeosaurBoard`, which the Playwright
   * harness installs in `openGame` via `addInitScript`, built on top of
   * `window.mazeosaur`, which the dev build installs and a production
   * build never does.
   */
  advanceTicks(n: number): void {
    for (let i = 0; i < n && (this.game_.state.phase === "build" || this.game_.state.phase === "migration"); i++) {
      this.tickOnce();
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
          // §5.4.1: `hit` is two layers with one job each, and both are
          // drawn. The tracer above says *which invader* — on its own it is
          // one shape for all six kinds with the colour doing all the work,
          // which is the gap the owner named on the demo. The strike says
          // *which kind*: the animal's own weapon, on the animal's own
          // cell, never pointed, because the tracer already carries the
          // direction and an isometric block render cannot be rotated
          // without reading as a second camera.
          //
          // Capped rather than queued. Past `STRIKE_MAX` the strike is
          // dropped and nothing else is: the damage is already committed in
          // the sim, and the tracer and the sound are unaffected.
          if (this.strikes.length < STRIKE_MAX) {
            const ttl = this.reducedMotion ? STRIKE_REDUCED_MS : STRIKE_TTL;
            this.strikes.push({ kind: g.dinoDef(d).kind, x: from.x, y: from.y, ttl, life: ttl });
          }
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
          this.toast(`An invader reached the nest: -${e.eggs} egg${e.eggs > 1 ? "s" : ""}`, false);
          this.sfx.play(this.prevInvaders.get(e.invaderId)?.boss === true ? "leak-boss" : "leak");
          break;
        }
        case "migration-started":
          // The text is `announceMigration`'s, which names the migration and
          // folds the early-send bonus into that one line rather than
          // spending a second message on it. The bonus still decides the
          // horn: it is the sim's own test for "early", so the sound cannot
          // disagree with the meat the player was just paid.
          this.announceMigration(e.bonus);
          // Both, when the player sent early: the horn is the answer to
          // their button and the herd call is the migration arriving.
          if (e.bonus > 0) this.sfx.play("send-early");
          this.sfx.play("migration-start");
          this.autosave();
          break;
        case "migration-cleared":
          this.toast(`Migration cleared: +${e.bonus} meat`, false);
          this.sfx.play("migration-clear");
          this.autosave();
          break;
        case "won":
          this.sfx.play("victory");
          this.showResults("won");
          break;
        case "lost":
          this.sfx.play("defeat");
          this.showResults("lost");
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

  /**
   * §5.4.1's strike layer. One pooled sprite per live strike, taken from
   * the front of the pool in order and the tail hidden, so a frame
   * allocates only when the board has more strikes up at once than it has
   * ever had before — and never past `STRIKE_MAX`.
   *
   * Which sprite draws which strike is deliberately not stable between
   * frames. Nothing about a strike is carried on the sprite: the frame, the
   * position, the alpha and the visibility are all written every frame from
   * the `Strike` record, so a sprite handed from an expiring strike to a
   * new one cannot bring anything of the old one with it.
   */
  private drawStrikes(): void {
    let used = 0;
    for (const s of this.strikes) {
      const sprite = this.strikePool[used] ?? this.newStrikeSprite();
      const elapsed = s.ttl - s.life;
      // Reduced motion pins step 2 — the frame that reads, and the one that
      // carries the kind. Otherwise the three steps run on the elapsed
      // boundaries, holding step 3 to the end: it is the mark left behind
      // and holds no weapon, which is what lets the fade sit on it without
      // the clip looking like it rewinds.
      const step = this.reducedMotion
        ? 1
        : elapsed < STRIKE_STEP_MS[0]
          ? 0
          : elapsed < STRIKE_STEP_MS[0] + STRIKE_STEP_MS[1]
            ? 1
            : 2;
      // One expression for both modes: the fade is the last step's own
      // duration, and during the steps before it `life` is larger than that
      // so this clamps to fully opaque.
      const fade = this.reducedMotion ? STRIKE_REDUCED_MS : STRIKE_STEP_MS[2];
      sprite.setFrame(STRIKE_FRAMES[s.kind][step]);
      sprite.setPosition(s.x, s.y);
      sprite.setAlpha(Math.min(1, s.life / fade));
      sprite.setVisible(true);
      used++;
    }
    for (let i = used; i < this.strikePool.length; i++) this.strikePool[i]?.setVisible(false);
  }

  /**
   * Grows the pool by one. The scale is the atlas's own — `TOY_BOX_SCALE`,
   * which is 45/64 and **not** 45/128: a strike frame is two authored
   * squares wide to buy the swing its reach, at the animal's own world
   * scale, so reading the frame's 128 draws every strike at half the size
   * of the dinosaur throwing it.
   *
   * The origin is the cell centre rather than a pair of feet, which is the
   * one line of §5.5's rule that a strike changes: it is anchored on the
   * cell, not stood on the ground.
   */
  private newStrikeSprite(): Phaser.GameObjects.Sprite {
    const sprite = this.add.sprite(0, 0, ATLAS.strikes, STRIKE_FRAMES.raptor[1]).setOrigin(0.5, 0.5).setScale(TOY_BOX_SCALE);
    // Reparented, not merely positioned: `add.sprite` appends to the
    // scene's display list, which by now is after the HUD.
    this.strikeLayer.add(sprite);
    this.strikePool.push(sprite);
    return sprite;
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
   * eggs, which migration, and the three clock controls — Send, Pause and
   * the speed toggle. All three are `MIN_HIT` squares; see `ROW1` for why
   * that is the only width three of them fit in.
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
    this.add.text(ROW1.migrationLabel.x, ROW1.migrationLabel.y, MIGRATION_LABEL, text(TYPE.label, COLORS.textDim));
    this.migrationValue = this.add.text(
      ROW1.migrationValue.x,
      ROW1.migrationValue.y,
      "",
      wrapped(TYPE.body, ROW1_WRAP.migration),
    );

    this.sendButton = this.button(ROW1.send.x, ROW1.send.y, ROW1.send.w, ROW1.send.h, "Send", () => this.send(), TYPE.body);
    // Held as a field only so `hudTargets` can report it: nothing ever
    // rewrites its label or its fill, which is the one row-1 control that
    // is true of.
    this.pauseButton = this.button(ROW1.pause.x, ROW1.pause.y, ROW1.pause.w, ROW1.pause.h, "Pause", () => this.pause(), TYPE.body);
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
    this.migrationValue.setText(migrationCounter(s.migration, total));

    // The bar drains across the build phase and is the early-send
    // affordance at the same time: what is left of it *is* the bonus.
    // `displayWidth` and not a redraw — this runs every frame.
    if (s.phase === "build") {
      const frac = Math.max(0, Math.min(1, s.buildTimer / content.rules.buildPhaseTicks));
      this.timerBar.setVisible(true);
      this.timerBar.displayWidth = ROW1.timerBar.w * frac;
      const bonus = g.earlySendBonus();
      // Two lines, not `Send  +25` on one: Send is an 82px square since
      // Pause took the width it had spare, and `+25` beside the word runs
      // past the button. Grow and Sell already stack a label over a number
      // for the same reason, so this is the row's existing idiom and not a
      // new shape.
      this.sendButton.label.setText(bonus > 0 ? `Send\n+${bonus}` : "Send").setAlign("center");
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
      const flashing = this.cardFlashDefId === card.def.id && this.playedMs() < this.cardFlashUntil;
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
   *
   * On `playedMs()` and not `this.time.now`, for the same reason the air
   * route's lights are: the toast is drawn over the board, it animates, and
   * 1.6s is how long the *player* gets to read it. A toast that kept fading
   * under the pause scrim would be motion on a frozen board, and one that
   * expired while the menu was up would spend its 1.6s where nobody could
   * read it. `create()` resets `toastUntil` to 0, so a restart's jump back
   * to a fresh clock cannot leave a stale deadline in the future.
   */
  private toast(msg: string, refusal: boolean): void {
    this.toastText.setText(msg);
    this.toastUntil = this.playedMs() + TOAST_MS + TOAST_FADE_MS;
    this.toastPanel.setVisible(true);
    this.toastBar.setVisible(refusal);
    this.toastText.setVisible(true);
  }

  /** The fade, driven off the clock rather than a tween, so a restart cannot leave one running. */
  private refreshToast(): void {
    const left = this.toastUntil - this.playedMs();
    if (left <= 0) {
      this.hideToast();
      return;
    }
    const a = Math.min(1, left / TOAST_FADE_MS);
    this.toastPanel.setAlpha(TOAST_ALPHA * a);
    this.toastBar.setAlpha(a);
    this.toastText.setAlpha(a);
  }

  /**
   * Hand a run that is over to `results` (§5.3's
   * `board ──won / lost / abandoned──▶ results`). Replaces the in-board
   * "Play again" overlay this scene used to raise for itself.
   *
   * All three of §5.4's outcomes come through here, including the player's
   * own `abandoned`. They differ in what the screen says and in what the
   * run was paid, never in which screen it lands on: one end-of-run shape
   * means the second one cannot drift away from it, which is what the
   * in-board overlay had already started doing — its own geometry, its own
   * "Play again", and a reset contract only it depended on.
   *
   * Still named `showResults` and not `endRun`: the pause menu owns that
   * name for the gesture, and this is the handoff the gesture ends in.
   *
   * The `autosave()` below is no longer load-bearing for the re-entry.
   * It used to be: `create()` read `doc.run` unconditionally, so the only
   * thing that stopped `Again` resuming the run it had just finished was
   * that `flush()` had synchronously nulled `doc.run` first. §5.3's entry
   * mode replaced that ordering argument with a mechanism — `Again` says
   * `again`, and `again` does not read `doc.run` — so what is left here is
   * the ordinary reason to save a run that just ended, plus one that has
   * nothing to do with restarting: `flush()` is where §5.4 pays the run,
   * so `this.fossilsAwarded` is only the award after it has run, and the
   * summary below reads it.
   *
   * `autosave()` rather than `flush()` because a storage error must not
   * strand the player on a board whose run is over; the handoff below
   * happens either way.
   */
  private showResults(outcome: Outcome): void {
    this.autosave();
    // The toast fades on `playedMs()`, and `scene.pause()` below stops the
    // clock it reads — so whatever was up when the run ended would sit
    // there at a fixed alpha for as long as the results screen is, which
    // on a loss is always "An invader reached the nest: -1 egg". Seen in
    // the drive. Same argument as `abandonRun`'s `showSheet(false)`: a run
    // that is over must not leave live-looking HUD behind the scrim.
    this.hideToast();
    const summary = runSummary(outcome, this.game_.state, (d) => this.game_.dinoDef(d), this.runSeed, content, this.fossilsAwarded);
    // `launch` + `pause`, not `start`. §9 of the art doc puts the results
    // screen "over a 70% `bg` scrim, the board still visible behind it,
    // because the board is what the player wants to look at" — and
    // `scene.start()` *stops* this scene, which leaves the scrim over an
    // empty canvas and the last thing the player did invisible. A paused
    // scene keeps rendering and stops updating, which is exactly the two
    // halves wanted: the valley stays on screen and its input is dead.
    this.scene.launch("results", summary);
    this.scene.pause();
  }

  /**
   * The scrim the pause menu sits on, with the board still legible behind
   * it. The only overlay this scene still draws for itself — every
   * end-of-run screen is `results`, which raises its own. Two jobs beyond
   * the dimming:
   *
   * It **swallows the tap**. The rectangle is interactive and sits above
   * the HUD in the display list, but Phaser keeps walking the candidates
   * under a pointer unless one of them cancels the event — so without the
   * `stopPropagation` here a tap on the scrim reached the live Send and
   * speed buttons behind it. A paused run is still in `build` or
   * `migration`, so that Send would have taken the command.
   *
   * And `onTap` is the dismiss gesture, which is the pause menu's whole
   * reason for being an overlay rather than a scene: there is a run behind
   * it to go back to.
   */
  private scrim(onTap: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const r = this.add.rectangle(0, 0, CANVAS_W, CANVAS_H, 0x000000, 0.7).setOrigin(0, 0).setInteractive();
    r.on("pointerdown", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onTap();
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
    // 48 is off the four-size scale in `layout.ts`, and so is the results
    // screen's own headline at `TYPE.title * 2` = 52. Two headline sizes
    // for the two screens a run ends on, neither of them named, and 4px
    // apart: a drift worth settling, but in the results-screen recut
    // (§5.1), which moves both at once. The same argument `ROW1` settled
    // for the HUD, one layer up.
    c.add(this.add.text(CANVAS_W / 2, PAUSE_MENU.title.y, "Paused", text(48)).setOrigin(0.5));
    c.add(this.add.text(CANVAS_W / 2, PAUSE_MENU.sub.y, this.runLine(), text(TYPE.body, COLORS.textDim)).setOrigin(0.5));
    const entries = [
      { y: PAUSE_MENU.resume.y, label: "Resume", fill: COLORS.buttonActive, onClick: () => this.resume() },
      { y: PAUSE_MENU.restart.y, label: "Restart run", fill: COLORS.button, onClick: () => this.restartRun() },
      { y: PAUSE_MENU.end.y, label: "End run", fill: COLORS.buttonDanger, onClick: () => this.endRun() },
    ];
    for (const e of entries) {
      const b = this.button(PAUSE_MENU.x, e.y, PAUSE_MENU.w, PAUSE_MENU.h, e.label, e.onClick, TYPE.title);
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
    // `showSheet(false)` and not a panel hide: row 3 is a swapping tray
    // since ARB-186, so putting the sheet away *is* putting the shop back.
    // It matters on the `endRun` path, which leaves this scene alive under
    // the results scrim: without it the HUD sits there showing a Grow
    // button and a live sell price for a run that is over.
    this.showSheet(false);
    this.autosave();
  }

  /**
   * Start this seed over. The clock stays stopped until `create()` clears
   * `paused`, so the abandoned board cannot tick in the frames between.
   *
   * `again` carries the seed (§5.3), so it is this seed that comes back
   * and not a new one — "Restart run" and not "New run".
   *
   * `abandonRun()` is still not optional, but it is no longer what makes
   * the restart safe: `again` does not read `doc.run` at all, so the run
   * this throws away cannot come back through `create()` whatever the
   * document holds. What it is for is the *stored* document — `flush()`
   * has been keeping an in-flight run on it since the first autosave, and
   * a tab closed in the frames between here and the next autosave would
   * otherwise offer to resume a run the player already restarted.
   */
  private restartRun(): void {
    this.abandonRun();
    this.closeOverlay();
    this.scene.restart(again(this.runSeed));
  }

  /**
   * Stop playing. Section 5.1's `results` scene, the same one a win and a
   * loss reach — with `abandoned` as the outcome, so the screen can say
   * which of the three it is drawing.
   *
   * `closeOverlay()` first and not last: the pause menu is the container
   * `overlay` is holding right now, and it has to be destroyed before
   * `results` is launched over the board, or the menu stays drawn under
   * the new scrim with its own Resume still on screen.
   *
   * The award is `showResults`'s to read and nothing here produces one.
   * `abandonRun()` has already set `abandoned`, and §5.4's payment is
   * `flush()`'s `accountFinish`, which tests the `won` and `lost` phases
   * only — so an abandoned run arrives at the screen with `fossilsAwarded`
   * still 0 and `finishedAccounted` still false, which is the whole of
   * rule 2 of this path and is asserted from the player's side in
   * `tests/client/pause.spec.ts`.
   *
   * `paused` stays true underneath as well as `scene.pause()`, which
   * matters here and not on the won/lost paths: an ended run's phase is
   * still `build` or `migration`, so it has no terminal phase of its own
   * to stop it if the scene is ever resumed.
   */
  private endRun(): void {
    this.abandonRun();
    this.closeOverlay();
    this.showResults("abandoned");
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
      // A won or lost run no longer needs a guard here: `showResults()`
      // pauses this scene, which takes its input plugin down with it.
      //
      // This one is still load-bearing for the other two overlays. The
      // pause menu and an ended run are drawn *inside* this scene, so
      // their taps do reach this handler — `scrim()` stops propagation
      // and should catch them first, and this is the second line of that
      // defence rather than a duplicate of it: the guard holds even for a
      // pointer event that never crossed the scrim's own hit area.
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
        // The sheet *is* the tray now, so this call swaps the shop out
        // rather than revealing a panel beside it.
        this.showSheet(true);
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
   *
   * `playedMs()` like the toast and the air route. 300ms is short enough
   * that a pause almost never catches one mid-flash; it is on the run's
   * clock anyway so that there is one answer to "which clock does the
   * renderer animate on" rather than a list of exceptions.
   */
  private flashCardCost(defId: string): void {
    this.cardFlashDefId = defId;
    this.cardFlashUntil = this.playedMs() + 300;
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
    // long as `results` is up, and `suspend()` calls
    // `flush()` unconditionally on every later tab-hide or `pagehide` in
    // that window -- without the latch, each of those would hand the
    // already-finished run to `runFinished` again and double (or
    // triple...) `fossilsEarned` and `runsFinished`. The award comes from
    // `content.rules.fossilWeights`, never a number here -- rule 4.
    const accountFinish = finished && !this.finishedAccounted;
    const finish = accountFinish
      ? runFinished(this.doc.profile, content.rules.fossilWeights, {
          valleyId: content.valley.id,
          seed: this.runSeed,
          contentVersion: content.version,
          migrationsCleared: this.game_.state.migration,
          eggsLeft: this.game_.state.eggs,
          meatUnspent: this.game_.state.meat,
        })
      : null;
    const profile = finish ? finish.profile : this.doc.profile;
    if (finish) {
      this.finishedAccounted = true;
      // The one place this run's award is produced; `showResults()` shows
      // this number rather than deriving a second one. §5.4.
      this.fossilsAwarded = finish.fossilsAwarded;
    }
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
   * The profile as `flush()` last wrote it, for tests and for the console.
   *
   * Exists so a browser spec can hold the award on the results screen
   * against the award actually banked — the §5.4 claim that there is only
   * one of them. Nothing else can check it: the player is shown one figure
   * and credited another, and sees only the first.
   */
  get bankedProfile(): SaveDocument["profile"] {
    return this.doc.profile;
  }

  /**
   * Whether the toast is on screen. For `results.spec.ts`, which asserts
   * it is not: the fade runs on `playedMs()`, and the results screen stops
   * that clock, so a toast left up would stay up.
   */
  get toastShown(): boolean {
    return this.toastPanel.visible;
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
      box("Pause", this.pauseButton.bg),
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
