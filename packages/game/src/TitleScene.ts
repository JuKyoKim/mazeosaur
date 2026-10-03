import Phaser from "phaser";
import { content } from "@mazeosaur/content";
import { services } from "./platform.js";
import { CANVAS_H, CANVAS_W, CELL_PX } from "./layout.js";
import { COLORS, text } from "./theme.js";
import { makeButton } from "./ui.js";

const BUTTON_W = 440;
const BUTTON_X = (CANVAS_W - BUTTON_W) / 2;

/**
 * The first screen: the valley behind the name, start, and a resume that
 * stays dark until a shell injects save storage.
 *
 * This scene keeps no fields. Everything it draws is local to create(),
 * so coming back here from the results screen cannot leave a stale
 * reference to a destroyed display object.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super("title");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.drawValley();

    this.add.text(CANVAS_W / 2, 320, "MAZEOSAUR", text(78)).setOrigin(0.5);
    this.add.text(CANVAS_W / 2, 392, "Your pack is the maze.", text(24, COLORS.textDim)).setOrigin(0.5);

    const start = makeButton(this, BUTTON_X, 620, BUTTON_W, 88, "Start a run", () => this.start(), { size: 30 });
    start.bg.setFillStyle(COLORS.buttonActive);

    const saved = services(this).saves?.resumableRun() ?? null;
    makeButton(this, BUTTON_X, 728, BUTTON_W, 88, "Resume", () => this.scene.start("board", { resume: saved }), {
      size: 30,
      enabled: saved !== null,
    });
    if (!saved) {
      this.add
        .text(CANVAS_W / 2, 840, "Nothing to resume. Runs are saved in a later build.", text(18, COLORS.textDim))
        .setOrigin(0.5);
    }

    this.add
      .text(CANVAS_W / 2, CANVAS_H - 72, `One valley · ${content.migrations.length} migrations · ${content.valley.name}`, text(18, COLORS.textDim))
      .setOrigin(0.5);
  }

  private start(): void {
    this.scene.start("board", { seed: services(this).nextSeed() });
  }

  /** The valley itself, dimmed, as the backdrop: grid, lane, nest. */
  private drawValley(): void {
    const v = content.valley;
    const top = Math.round((CANVAS_H - v.height * CELL_PX) / 2);
    const gfx = this.add.graphics();

    gfx.lineStyle(1, COLORS.gridLine, 0.6);
    for (let x = 0; x <= v.width; x++) gfx.lineBetween(x * CELL_PX, top, x * CELL_PX, top + v.height * CELL_PX);
    for (let y = 0; y <= v.height; y++) gfx.lineBetween(0, top + y * CELL_PX, CANVAS_W, top + y * CELL_PX);

    const centre = (p: { x: number; y: number }) => ({ x: p.x * CELL_PX + CELL_PX / 2, y: top + p.y * CELL_PX + CELL_PX / 2 });
    const path = [v.lane.spawn, ...v.lane.checkpoints, v.lane.exit].map(centre);
    gfx.lineStyle(CELL_PX * 0.5, COLORS.boardBg, 1);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as { x: number; y: number };
      const b = path[i] as { x: number; y: number };
      gfx.lineBetween(a.x, a.y, b.x, b.y);
    }
    const spawn = centre(v.lane.spawn);
    const nest = centre(v.lane.exit);
    gfx.fillStyle(COLORS.spawn, 0.9);
    gfx.fillCircle(spawn.x, spawn.y, CELL_PX * 0.4);
    gfx.fillStyle(COLORS.nest, 0.9);
    gfx.fillCircle(nest.x, nest.y, CELL_PX * 0.4);

    // a scrim, so the name reads over the valley rather than fighting it
    this.add.rectangle(0, 0, CANVAS_W, CANVAS_H, COLORS.bg, 0.72).setOrigin(0, 0);
  }
}
