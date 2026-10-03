import Phaser from "phaser";
import { services } from "./platform.js";
import { CANVAS_W, COLORS, text } from "./theme.js";
import { makeButton } from "./ui.js";

/** What the board scene reports when a run ends. All of it read from the sim. */
export interface RunSummary {
  readonly won: boolean;
  readonly seed: number;
  readonly migrationsCleared: number;
  readonly totalMigrations: number;
  readonly eggs: number;
  readonly meat: number;
}

const BUTTON_W = 440;
const BUTTON_X = (CANVAS_W - BUTTON_W) / 2;
const PANEL_X = 80;
const PANEL_W = CANVAS_W - PANEL_X * 2;

/**
 * How a run ended, and the seed that would run it again.
 *
 * Like the title scene this keeps no fields: the summary arrives through
 * init() as plain data and everything drawn is local to create().
 */
export class ResultsScene extends Phaser.Scene {
  private summary: RunSummary = { won: false, seed: 0, migrationsCleared: 0, totalMigrations: 0, eggs: 0, meat: 0 };

  constructor() {
    super("results");
  }

  init(data: RunSummary): void {
    this.summary = data;
  }

  create(): void {
    const s = this.summary;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.add
      .text(CANVAS_W / 2, 260, s.won ? "The nest holds" : "The nest is lost", text(58, s.won ? COLORS.text : COLORS.eggs))
      .setOrigin(0.5);
    this.add
      .text(
        CANVAS_W / 2,
        326,
        s.won
          ? `Every migration turned back with ${s.eggs} egg${s.eggs === 1 ? "" : "s"} still in the nest.`
          : `Migration ${Math.min(s.migrationsCleared + 1, s.totalMigrations)} broke through.`,
        text(22, COLORS.textDim),
      )
      .setOrigin(0.5);

    const rows: [string, string][] = [
      ["Migrations cleared", `${s.migrationsCleared} / ${s.totalMigrations}`],
      ["Eggs kept", `${s.eggs}`],
      ["Meat unspent", `${s.meat}`],
      ["Seed", `${s.seed}`],
    ];
    const rowH = 72;
    this.add.rectangle(PANEL_X, 410, PANEL_W, rows.length * rowH + 24, COLORS.hudPanel).setOrigin(0, 0);
    rows.forEach(([label, value], i) => {
      const y = 410 + 12 + i * rowH + rowH / 2;
      this.add.text(PANEL_X + 28, y, label, text(24, COLORS.textDim)).setOrigin(0, 0.5);
      this.add.text(PANEL_X + PANEL_W - 28, y, value, text(28)).setOrigin(1, 0.5);
    });

    this.add
      .text(CANVAS_W / 2, 410 + rows.length * rowH + 60, "The same seed replays the same run.", text(18, COLORS.textDim))
      .setOrigin(0.5);

    const again = makeButton(this, BUTTON_X, 860, BUTTON_W, 88, "Play again", () => this.playAgain(), { size: 30 });
    again.bg.setFillStyle(COLORS.buttonActive);
    makeButton(this, BUTTON_X, 968, BUTTON_W, 72, "Title screen", () => this.scene.start("title"), { size: 24 });
  }

  /** A new run, not a rewound one: the shell hands out the next seed. */
  private playAgain(): void {
    this.scene.start("board", { seed: services(this).nextSeed() });
  }
}
