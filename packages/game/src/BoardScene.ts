import Phaser from "phaser";
import { CELL, Game, TICKS_PER_SECOND, type DinoDef, type GameEvent, type Refusal } from "@mazeosaur/sim";
import { content, hatchlings } from "@mazeosaur/content";
import { CANVAS_H, CANVAS_W, CELL_PX, COLORS, KIND_COLOR, text } from "./theme.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;
const BOARD_H = content.valley.height * CELL_PX;
const HUD_Y = BOARD_H;

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

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
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
export class BoardScene extends Phaser.Scene {
  private game_!: Game;
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

  private meatText!: Phaser.GameObjects.Text;
  private eggsText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private statusUntil = 0;
  private previewText!: Phaser.GameObjects.Text;
  private paletteButtons: { def: DinoDef; button: Button }[] = [];
  private sendButton!: Button;
  private speedButton!: Button;
  private panelName!: Phaser.GameObjects.Text;
  private panelStats!: Phaser.GameObjects.Text;
  private growButton!: Button;
  private sellButton!: Button;
  private overlay: Phaser.GameObjects.Container | null = null;

  constructor(private readonly seed: number) {
    super("board");
  }

  create(): void {
    this.game_ = new Game(content, this.seed);
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
          break;
        case "migration-cleared":
          this.status(`Migration cleared: +${e.bonus} meat`);
          break;
        case "won":
          this.showOverlay("The nest is safe", `All ${content.migrations.length} migrations turned back with ${g.state.eggs} eggs left.`);
          break;
        case "lost":
          this.showOverlay("The nest is lost", `Fell on migration ${g.state.migration + 1} of ${content.migrations.length}.`);
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
    return { x: x * CELL_PX + CELL_PX / 2, y: y * CELL_PX + CELL_PX / 2 };
  }

  private worldFromMilli(px: number, py: number): { x: number; y: number } {
    return { x: (px * CELL_PX) / CELL, y: (py * CELL_PX) / CELL };
  }

  private drawStatic(): void {
    const gfx = this.staticGfx;
    const v = content.valley;
    gfx.clear();
    gfx.fillStyle(COLORS.boardBg, 1);
    gfx.fillRect(0, 0, CANVAS_W, BOARD_H);
    gfx.lineStyle(1, COLORS.gridLine, 1);
    for (let x = 0; x <= v.width; x++) gfx.lineBetween(x * CELL_PX, 0, x * CELL_PX, BOARD_H);
    for (let y = 0; y <= v.height; y++) gfx.lineBetween(0, y * CELL_PX, CANVAS_W, y * CELL_PX);

    const mark = (p: { x: number; y: number }, color: number, label: string) => {
      gfx.fillStyle(color, 1);
      gfx.fillRect(p.x * CELL_PX + 2, p.y * CELL_PX + 2, CELL_PX - 4, CELL_PX - 4);
      this.add.text(p.x * CELL_PX + CELL_PX / 2, p.y * CELL_PX + CELL_PX / 2, label, text(16, "#111")).setOrigin(0.5);
    };
    mark(v.lane.spawn, COLORS.spawn, "S");
    v.lane.checkpoints.forEach((c, i) => mark(c, COLORS.checkpoint, String(i + 1)));
    mark(v.lane.exit, COLORS.nest, "N");
    for (const r of v.rock) {
      gfx.fillStyle(0x4a4a4a, 1);
      gfx.fillRect(r.x * CELL_PX, r.y * CELL_PX, CELL_PX, CELL_PX);
    }
  }

  private drawTowers(): void {
    const gfx = this.towerGfx;
    gfx.clear();
    for (const d of this.game_.state.dinos) {
      const def = this.game_.dinoDef(d);
      const x = d.x * CELL_PX;
      const y = d.y * CELL_PX;
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
        gfx.strokeRect(d.x * CELL_PX + 1, d.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
      } else {
        this.selectedDino = null;
      }
    } else if (this.hoverCell && this.selectedDef && !this.painting) {
      const r = g.placeRefusal(this.selectedDef.id, this.hoverCell.x, this.hoverCell.y);
      const c = this.cellCenter(this.hoverCell.x, this.hoverCell.y);
      gfx.fillStyle(r ? COLORS.refusal : KIND_COLOR[this.selectedDef.kind], 0.45);
      gfx.fillRoundedRect(this.hoverCell.x * CELL_PX + 3, this.hoverCell.y * CELL_PX + 3, CELL_PX - 6, CELL_PX - 6, 6);
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
    this.add.rectangle(0, y0, CANVAS_W, CANVAS_H - y0, COLORS.hud).setOrigin(0, 0);

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
      this.paletteButtons.push({ def, button: b });
    });

    // row 3: status + next migration
    this.statusText = this.add.text(16, y0 + 132, "", text(18, COLORS.textDim));
    this.previewText = this.add.text(16, y0 + 160, "", text(18));

    // row 4: selected dino panel
    const panelY = y0 + 196;
    this.add.rectangle(8, panelY, CANVAS_W - 16, 68, COLORS.hudPanel).setOrigin(0, 0);
    this.panelName = this.add.text(20, panelY + 8, "", text(20));
    this.panelStats = this.add.text(20, panelY + 36, "", text(15, COLORS.textDim));
    this.growButton = this.button(CANVAS_W - 336, panelY + 8, 190, 52, "Grow", () => this.grow(), 17);
    this.sellButton = this.button(CANVAS_W - 136, panelY + 8, 120, 52, "Sell", () => this.sell(), 17);
    this.sellButton.bg.setFillStyle(COLORS.buttonDanger);
    this.setPanelVisible(false);

    if (hatchlings[0]) this.selectDef(hatchlings[0]);
  }

  private setPanelVisible(v: boolean): void {
    this.panelName.setVisible(v);
    this.panelStats.setVisible(v);
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

    for (const { def, button } of this.paletteButtons) {
      const active = this.selectedDef?.id === def.id && this.selectedDino === null;
      button.bg.setStrokeStyle(active ? 3 : 0, 0xffffff);
      button.label.setColor(s.meat >= def.cost ? COLORS.text : COLORS.textDim);
    }

    if (this.selectedDino !== null) {
      const d = s.dinos.find((x) => x.id === this.selectedDino);
      if (d) {
        const def = g.dinoDef(d);
        const stage = ["", "hatchling", "juvenile", "adult"][def.stage];
        this.panelName.setText(`${def.name}  ·  ${def.kind} ${stage}`);
        const dps = ((def.damage * TICKS_PER_SECOND) / def.cooldown).toFixed(1);
        const extras = [
          def.splash ? "splash" : "",
          def.slow ? `slow ${def.slow.percent}%` : "",
          def.stun ? `stun ${(def.stun.ticks / TICKS_PER_SECOND).toFixed(1)}s` : "",
          def.targetCount && def.targetCount > 1 ? `${def.targetCount} targets` : "",
        ].filter(Boolean);
        this.panelStats.setText(
          `${def.damage} dmg every ${(def.cooldown / TICKS_PER_SECOND).toFixed(2)}s (${dps}/s) · range ${(def.range / CELL).toFixed(1)} · hits ${def.targets}${extras.length ? " · " + extras.join(", ") : ""}`,
        );
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

  private wireInput(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.overlay) return;
      const cell = this.cellAt(p);
      if (!cell) return;
      const dino = this.game_.dinoAt(cell.x, cell.y);
      if (dino) {
        this.selectedDino = dino.id;
        this.setPanelVisible(true);
        return;
      }
      if (this.selectedDino !== null) {
        this.selectedDino = null;
        this.setPanelVisible(false);
        if (!this.selectedDef) return;
      }
      if (this.selectedDef) {
        this.painting = true;
        this.lastPaint = cell;
        this.tryPlace(cell.x, cell.y);
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
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
    if (p.y >= BOARD_H || p.y < 0 || p.x < 0 || p.x >= CANVAS_W) return null;
    return { x: Math.floor(p.x / CELL_PX), y: Math.floor(p.y / CELL_PX) };
  }

  private tryPlace(x: number, y: number, quiet = false): void {
    if (!this.selectedDef) return;
    const r = this.game_.apply({ type: "place", defId: this.selectedDef.id, x, y });
    if (r) {
      const c = this.cellCenter(x, y);
      this.effects.push({ kind: "flash", x: c.x, y: c.y, color: COLORS.refusal, ttl: 250, life: 250 });
      if (!quiet || r === "no-meat" || r === "would-block") this.status(REFUSAL_TEXT[r]);
    }
  }

  private selectDef(def: DinoDef): void {
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

  /** For tests and debugging from the console. */
  get sim(): Game {
    return this.game_;
  }
}
