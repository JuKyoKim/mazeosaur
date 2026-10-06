import Phaser from "phaser";
import { CANVAS_H, CANVAS_W, GUTTER, HUD_H, HUD_Y, RESULTS, TYPE } from "./layout.js";
import { COLORS, KIND_COLOR, hexCss, text } from "./theme.js";
import type { RunSummary } from "./summary.js";

/**
 * The end-of-run screen: section 9 of `docs/01-art-hud-and-audio.md`, over
 * a scrim with the board still visible behind it, because the board is
 * what the player wants to look at.
 *
 * It owns no `Game` (§5.1). Everything it draws arrives through `init()`
 * as a `RunSummary` of plain numbers, so there is nothing here that could
 * resurrect the run it describes — and `again` therefore has to go back
 * through `board`, which is the only scene that constructs a `Game`.
 *
 * Every field below is declared and not initialised, per §5.2: this scene
 * is a singleton and `create()` runs again on every entry, so a field that
 * kept its value would be holding a display object the previous entry
 * destroyed.
 */
export class ResultsScene extends Phaser.Scene {
  /** Assigned in `init()`, which Phaser runs before `create()` on every start. */
  private summary!: RunSummary;

  constructor() {
    super("results");
  }

  init(summary: RunSummary): void {
    this.summary = summary;
  }

  create(): void {
    const s = this.summary;

    // The scrim is 70% rather than opaque so the valley reads through it.
    // `setInteractive()` with no handler is deliberate: it swallows taps
    // that would otherwise fall through to whatever is behind, and this
    // screen's only affordance is its own button.
    this.add.rectangle(0, 0, CANVAS_W, CANVAS_H, COLORS.bg, 0.7).setOrigin(0, 0).setInteractive();

    // The HUD band is covered opaquely, unlike the board above it. §9 asks
    // for "the board still visible behind it, because the board is what
    // the player wants to look at" — the HUD is not that, and leaving it
    // at 30% puts a legible-but-dead Send button directly behind Again, in
    // the one place §9 says Again goes. A control you can read and cannot
    // press is worse than no control, so this row is replaced rather than
    // dimmed.
    this.add.rectangle(0, HUD_Y, CANVAS_W, HUD_H, COLORS.hud, 1).setOrigin(0, 0);

    // `title` at 2x, per §9's type column.
    this.add.text(CANVAS_W / 2, RESULTS.headline.y, HEADLINE[s.outcome], text(TYPE.title * 2)).setOrigin(0.5);

    // The number first and big, which is what §9 asks for: the count is
    // the headline statistic and "of 50" is the context for it.
    this.add.text(CANVAS_W / 2, RESULTS.cleared.y, `${s.migrationsCleared}`, text(TYPE.vital)).setOrigin(0.5, 1);
    this.add
      .text(CANVAS_W / 2, RESULTS.cleared.y + 6, `of ${s.migrationsTotal} migrations turned back`, text(TYPE.label, COLORS.textDim))
      .setOrigin(0.5, 0);

    // Eggs left of centre, meat right of it, both on §9's y=520. The two
    // share a line and are anchored to the centre rather than to the
    // canvas edges, so neither moves when the other's digits grow.
    this.add.text(CANVAS_W / 2 - GUTTER, RESULTS.eggsKept.y, `${s.eggsKept} eggs kept`, text(TYPE.body, COLORS.eggs)).setOrigin(1, 0);
    this.add.text(CANVAS_W / 2 + GUTTER, RESULTS.meatUnspent.y, `${s.meatUnspent} meat unspent`, text(TYPE.body, COLORS.meat)).setOrigin(0, 0);

    // A paid run's award is `vital` in checkpoint yellow (§9) — the one
    // reward on the screen, and the loudest thing under the headline.
    // `theme.ts` holds the hue as a number for the renderer; Text wants the
    // CSS form.
    //
    // A run that paid nothing drops to `body` in `textDim` instead, per
    // §9's "the award line when the award is zero": checkpoint yellow at
    // `vital` is this screen's reward signal, and spending it on a zero
    // makes the loudest element on the screen the thing the player did not
    // get. The line is not omitted, because an ended run paying nothing is
    // a rule and this is the only place the game states it.
    //
    // Keyed on the *number* and not on the outcome, also per §9:
    // `fossilAward` pays per egg kept, per migration cleared and per meat
    // unspent, so a loss on migration 1 with nothing banked pays zero too —
    // the all-zeros case `packages/content/test/content.test.ts` already
    // pins. Only the wording is keyed on the outcome, and it has to be: on
    // an abandoned run the zero is a rule, and on a lost one it is
    // arithmetic.
    const paid = s.fossilsAwarded > 0;
    this.add
      .text(
        CANVAS_W / 2,
        RESULTS.fossils.y,
        paid ? `+${s.fossilsAwarded} fossils` : NO_AWARD[s.outcome],
        paid ? text(TYPE.vital, hexCss(COLORS.checkpoint)) : text(TYPE.body, COLORS.textDim),
      )
      // Both variants, so the line shrinks about its own centre and the
      // pack row under it does not move (§9).
      .setOrigin(0.5);

    this.drawPack();

    // Again sits in the HUD band at the same height Send was, so the thumb
    // does not move between the run that ended and the next one (§9).
    this.button(RESULTS.again, "Again", () => {
      // Back through `board`, which rebuilds the `Game`. §5.3 is "again
      // (same seed)": `BoardScene` keeps `runSeed` across a re-entry and
      // only asks `nextSeed()` on its first create(), so the seed is the
      // scene's to hold and not this screen's to pass.
      //
      // `start` and not `resume`: the board is *paused* behind this screen
      // (see `BoardScene.showResults`), and resuming it would hand the
      // player back the run they just finished — or, on the `abandoned`
      // path, the one they chose to walk out of. `start` re-runs its `create()`,
      // which is the fresh run — and stops this scene on the way out.
      this.scene.start("board");
    });

    // §5.3's `results ──▶ title` exit is not here, and that is deliberate
    // rather than forgotten: `title` does not exist yet (ARB-217 owns it),
    // and §9's element table specifies exactly one control on this screen.
    // Inventing a second button's geometry would be a HUD layout decision
    // taken in the renderer, which is maze-design's to make. The exit
    // lands with the scene it targets.
  }

  /**
   * The pack row: every genus the player grew to adult, as its block, in a
   * row (§9). The one piece of this screen that is not a statistic.
   *
   * Drawn with the same rounded rect and stage pips `BoardScene.drawTowers`
   * uses, so an animal is the same object here as it was on the valley —
   * the client loads no atlas, and a different shape here would read as a
   * different thing rather than as the one the player just played.
   */
  private drawPack(): void {
    const { pack } = this.summary;
    const box = RESULTS.pack;
    if (pack.length === 0) {
      this.add
        .text(CANVAS_W / 2, box.y + box.h / 2, "No dinosaur reached adult", text(TYPE.body, COLORS.textDim))
        .setOrigin(0.5);
      return;
    }

    // The row is divided into equal columns and the block is centred in
    // its column — rather than the blocks being packed and the labels hung
    // under them. The genus is the longest thing in a column
    // (`Tyrannosaurus` is far wider than a 96px block), so a label given
    // only the block's width runs under its neighbour's; giving it the
    // column means the block's size and the label's never fight.
    const colW = box.w / pack.length;
    const cell = Math.min(PACK_CELL_MAX, Math.floor(colW - PACK_COL_PAD));
    const gfx = this.add.graphics();

    pack.forEach((entry, i) => {
      const cx = box.x + colW * (i + 0.5);
      const x = Math.round(cx - cell / 2);
      const y = box.y;
      gfx.fillStyle(KIND_COLOR[entry.kind], 1);
      gfx.fillRoundedRect(x, y, cell, cell, Math.round(cell / 6));
      // Three pips: an adult is stage 3, and the pips are what say so on
      // the valley too.
      gfx.fillStyle(COLORS.ink, 0.85);
      const pipR = Math.max(2, Math.round(cell / 12));
      for (let p = 0; p < 3; p++) gfx.fillCircle(x + cell / 2 + (p - 1) * pipR * 3, y + cell - pipR * 3, pipR);

      // The genus is the collectible, so it is spelled out rather than
      // implied by hue, and the count rides the same line: §9's example is
      // "three Utahraptors", which is one phrase and not a badge. Wrapped
      // at the column with `useAdvancedWrap`, because a genus is a single
      // word and the default word wrap cannot break one.
      this.add
        .text(cx, y + cell + 8, entry.count > 1 ? `${entry.name} x${entry.count}` : entry.name, {
          ...text(TYPE.label),
          align: "center",
          wordWrap: { width: Math.floor(colW - PACK_COL_PAD), useAdvancedWrap: true },
        })
        .setOrigin(0.5, 0);
    });
  }

  /**
   * A button from a layout rect. `BoardScene` has its own `button()` and
   * this is deliberately not shared with it: that one stops propagation
   * because the board has a scene-level `pointerdown` behind it that would
   * otherwise cancel the player's selection. This screen has no such
   * handler, so the stop would be cargo-culted.
   */
  private button(rect: { x: number; y: number; w: number; h: number }, label: string, onClick: () => void): void {
    const bg = this.add.rectangle(rect.x, rect.y, rect.w, rect.h, COLORS.buttonActive).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.add.text(rect.x + rect.w / 2, rect.y + rect.h / 2, label, text(TYPE.body)).setOrigin(0.5);
    bg.on("pointerdown", (p: Phaser.Input.Pointer) => {
      onClick();
      p.event.preventDefault?.();
    });
  }

  /** Everything this screen can report, for a browser spec to read back. */
  get runSummary(): RunSummary {
    return this.summary;
  }
}

/**
 * The headline per outcome. A `Record<Outcome, string>` and not a ternary:
 * `outcome === "won" ? … : …` sent every value that was not `won` to the
 * *loss* headline, so adding `abandoned` would have told a player who quit
 * that the valley had fallen. A total record makes the next outcome a type
 * error at this line instead.
 *
 * All three strings are maze-design's, from §9's headline table (ARB-322).
 * `abandoned` is "The pack withdraws" and not a defeat line: nobody beat
 * the player, so "The valley is quiet" would tell someone who walked away
 * that the nest had fallen. It is also the pack row's own noun, which is
 * what sits directly under it.
 */
const HEADLINE: Record<RunSummary["outcome"], string> = {
  won: "The nest holds",
  lost: "The valley is quiet",
  abandoned: "The pack withdraws",
};

/**
 * What the award line says when the award is zero — §9's second table.
 *
 * A record for the same reason `HEADLINE` is one, and the wording is the
 * only part of the zero case that looks at the outcome at all: "No fossils
 * for an ended run" names **End run**, the button the player just pressed,
 * which is the whole of the teaching. Telling a player who lost migration 1
 * with nothing banked the same thing would teach them a rule that does not
 * exist, so that case gets the arithmetic line instead.
 *
 * `won` is unreachable in practice — clearing every migration pays — but it
 * is spelled rather than narrowed, because `Record<Outcome, string>` is what
 * makes the next outcome a type error here instead of `undefined` drawn on
 * the screen.
 */
const NO_AWARD: Record<RunSummary["outcome"], string> = {
  won: "No fossils earned",
  lost: "No fossils earned",
  abandoned: "No fossils for an ended run",
};

/** The pack blocks stop growing here; a two-genus run is not a mural. */
const PACK_CELL_MAX = 96;
/** Breathing room between pack columns, so two labels never touch. */
const PACK_COL_PAD = 12;
