import { Grid, type Point } from "./grid.js";
import { distanceAt, nextStep, UNREACHABLE, type FlowField } from "./flowfield.js";
import { buildRefusal, computeLaneFields, legCount, type BuildRefusal } from "./lane.js";
import { Rng } from "./rng.js";
import {
  CELL,
  TICKS_PER_SECOND,
  kindMultiplier,
  type Content,
  type DinoDef,
  type InvaderDef,
  type MigrationDef,
} from "./content-types.js";

export type Phase = "build" | "migration" | "won" | "lost";

export interface Dino {
  readonly id: number;
  defId: string;
  readonly x: number;
  readonly y: number;
  cooldown: number;
  /** total meat ever spent on this dinosaur; the sell refund is a share of it */
  invested: number;
}

export interface Invader {
  readonly id: number;
  readonly defId: string;
  /** centre position in milli-cells */
  px: number;
  py: number;
  hp: number;
  readonly maxHp: number;
  readonly flying: boolean;
  /** which lane leg a ground invader is on (index into the lane's legs) */
  leg: number;
  /** the cell a ground invader is walking toward, or null when it needs a new one */
  next: Point | null;
  slowUntil: number;
  slowPercent: number;
  stunUntil: number;
  /** attacks still absorbed */
  shield: number;
  /** higher = closer to the nest; used for "first" targeting */
  progress: number;
}

export interface GameState {
  tick: number;
  phase: Phase;
  /** index of the current (migration phase) or next (build phase) migration */
  migration: number;
  buildTimer: number;
  meat: number;
  eggs: number;
  nextId: number;
  dinos: Dino[];
  invaders: Invader[];
  /** pending spawns for the running migration */
  spawnQueue: { defId: string; atTick: number }[];
}

export type Command =
  | { type: "place"; defId: string; x: number; y: number }
  | { type: "sell"; dinoId: number }
  | { type: "grow"; dinoId: number }
  | { type: "send" };

export type Refusal =
  | BuildRefusal
  | "unknown-dino"
  | "no-meat"
  | "invader-in-the-way"
  | "rock"
  | "not-yours"
  | "fully-grown"
  | "wrong-phase";

export type GameEvent =
  | { type: "placed"; dino: Dino }
  | { type: "sold"; dinoId: number; refund: number }
  | { type: "grown"; dino: Dino }
  | { type: "attack"; dinoId: number; invaderId: number; damage: number }
  | { type: "killed"; invaderId: number; bounty: number; at: Point }
  | { type: "split"; invaderId: number; into: number[] }
  | { type: "leaked"; invaderId: number; eggs: number }
  | { type: "migration-started"; index: number; bonus: number }
  | { type: "migration-cleared"; index: number; bonus: number }
  | { type: "won" }
  | { type: "lost" };

export interface LoggedCommand {
  readonly tick: number;
  readonly command: Command;
}

/**
 * The whole game. Construct with content and a seed, feed it commands and
 * ticks, read `state` and drain `events`. Nothing here knows about time,
 * screens or input; the renderer decides when to call tick().
 */
export class Game {
  readonly state: GameState;
  readonly grid: Grid;
  readonly rng: Rng;
  readonly log: LoggedCommand[] = [];
  private fields: FlowField[] = [];
  private events: GameEvent[] = [];
  private readonly rock: Set<number>;
  private readonly legs: number;

  constructor(
    readonly content: Content,
    readonly seed: number,
  ) {
    const v = content.valley;
    this.grid = new Grid(v.width, v.height);
    this.rock = new Set();
    for (const r of v.rock) {
      this.grid.setBlocked(r.x, r.y, true);
      this.rock.add(this.grid.index(r.x, r.y));
    }
    this.legs = legCount(v.lane);
    this.rng = new Rng(seed);
    this.state = {
      tick: 0,
      phase: "build",
      migration: 0,
      buildTimer: content.rules.buildPhaseTicks,
      meat: content.rules.startingMeat,
      eggs: content.rules.eggs,
      nextId: 1,
      dinos: [],
      invaders: [],
      spawnQueue: [],
    };
    this.rebuildFields();
  }

  /** Events since the last drain, in order. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  dinoAt(x: number, y: number): Dino | undefined {
    return this.state.dinos.find((d) => d.x === x && d.y === y);
  }

  dinoDef(d: Dino): DinoDef {
    return this.content.dinos[d.defId] as DinoDef;
  }

  invaderDef(i: Invader): InvaderDef {
    return this.content.invaders[i.defId] as InvaderDef;
  }

  currentMigration(): MigrationDef | undefined {
    return this.content.migrations[this.state.migration];
  }

  sellValue(d: Dino): number {
    const pct =
      this.state.phase === "migration"
        ? this.content.rules.sellRefundMigrationPercent
        : this.content.rules.sellRefundBuildPercent;
    return Math.floor((d.invested * pct) / 100);
  }

  earlySendBonus(): number {
    if (this.state.phase !== "build") return 0;
    return Math.floor(this.state.buildTimer / TICKS_PER_SECOND) * this.content.rules.earlyBonusPerSecond;
  }

  /** Why a placement would be refused, or null. Cheap enough to call on hover. */
  placeRefusal(defId: string, x: number, y: number): Refusal | null {
    const def = this.content.dinos[defId];
    if (!def) return "unknown-dino";
    if (def.stage !== 1) return "unknown-dino";
    if (this.state.phase === "won" || this.state.phase === "lost") return "wrong-phase";
    if (this.grid.inBounds(x, y) && this.rock.has(this.grid.index(x, y))) return "rock";
    const lane = buildRefusal(this.grid, this.content.valley.lane, { x, y });
    if (lane) return lane;
    if (this.invaderOccupies(x, y)) return "invader-in-the-way";
    if (this.state.meat < def.cost) return "no-meat";
    return null;
  }

  /** Apply a command now. Returns the refusal, or null when it took effect. */
  apply(command: Command): Refusal | null {
    const refusal = this.execute(command);
    if (refusal === null) this.log.push({ tick: this.state.tick, command });
    return refusal;
  }

  private execute(command: Command): Refusal | null {
    const s = this.state;
    switch (command.type) {
      case "place": {
        const r = this.placeRefusal(command.defId, command.x, command.y);
        if (r) return r;
        const def = this.content.dinos[command.defId] as DinoDef;
        const dino: Dino = {
          id: s.nextId++,
          defId: def.id,
          x: command.x,
          y: command.y,
          cooldown: 0,
          invested: def.cost,
        };
        s.meat -= def.cost;
        s.dinos.push(dino);
        this.grid.setBlocked(dino.x, dino.y, true);
        this.rebuildFields();
        this.events.push({ type: "placed", dino });
        return null;
      }
      case "sell": {
        if (s.phase === "won" || s.phase === "lost") return "wrong-phase";
        const idx = s.dinos.findIndex((d) => d.id === command.dinoId);
        if (idx < 0) return "not-yours";
        const dino = s.dinos[idx] as Dino;
        const refund = this.sellValue(dino);
        s.meat += refund;
        s.dinos.splice(idx, 1);
        this.grid.setBlocked(dino.x, dino.y, false);
        this.rebuildFields();
        this.events.push({ type: "sold", dinoId: dino.id, refund });
        return null;
      }
      case "grow": {
        if (s.phase === "won" || s.phase === "lost") return "wrong-phase";
        const dino = s.dinos.find((d) => d.id === command.dinoId);
        if (!dino) return "not-yours";
        const def = this.dinoDef(dino);
        if (!def.growsTo) return "fully-grown";
        const next = this.content.dinos[def.growsTo];
        if (!next) return "unknown-dino";
        if (s.meat < next.cost) return "no-meat";
        s.meat -= next.cost;
        dino.defId = next.id;
        dino.invested += next.cost;
        this.events.push({ type: "grown", dino });
        return null;
      }
      case "send": {
        if (s.phase !== "build") return "wrong-phase";
        const bonus = this.earlySendBonus();
        s.meat += bonus;
        this.startMigration(bonus);
        return null;
      }
    }
  }

  /** Advance one fixed step. */
  tick(): void {
    const s = this.state;
    if (s.phase === "won" || s.phase === "lost") return;
    s.tick++;
    if (s.phase === "build") {
      s.buildTimer--;
      if (s.buildTimer <= 0) this.startMigration(0);
      return;
    }
    this.spawn();
    this.moveInvaders();
    this.attack();
    if (s.phase !== "migration") return; // a leak may have ended the game
    if (s.spawnQueue.length === 0 && s.invaders.length === 0) this.clearMigration();
  }

  private startMigration(bonus: number): void {
    const s = this.state;
    const m = this.content.migrations[s.migration];
    if (!m) {
      s.phase = "won";
      this.events.push({ type: "won" });
      return;
    }
    s.phase = "migration";
    s.buildTimer = 0;
    let at = s.tick + 1;
    for (const g of m.groups) {
      for (let i = 0; i < g.count; i++) {
        s.spawnQueue.push({ defId: g.invader, atTick: at });
        at += g.spacing;
      }
    }
    this.events.push({ type: "migration-started", index: s.migration, bonus });
  }

  private clearMigration(): void {
    const s = this.state;
    const m = this.content.migrations[s.migration] as MigrationDef;
    s.meat += m.clearBonus;
    this.events.push({ type: "migration-cleared", index: s.migration, bonus: m.clearBonus });
    s.migration++;
    if (s.migration >= this.content.migrations.length) {
      s.phase = "won";
      this.events.push({ type: "won" });
      return;
    }
    s.phase = "build";
    s.buildTimer = this.content.rules.buildPhaseTicks;
  }

  private spawn(): void {
    const s = this.state;
    const lane = this.content.valley.lane;
    while (s.spawnQueue.length > 0 && (s.spawnQueue[0] as { atTick: number }).atTick <= s.tick) {
      const { defId } = s.spawnQueue.shift() as { defId: string };
      const def = this.content.invaders[defId];
      if (!def) continue;
      this.spawnInvader(def, lane.spawn.x * CELL + CELL / 2, lane.spawn.y * CELL + CELL / 2, 0);
    }
  }

  private spawnInvader(def: InvaderDef, px: number, py: number, leg: number): Invader {
    const s = this.state;
    const inv: Invader = {
      id: s.nextId++,
      defId: def.id,
      px,
      py,
      hp: def.hp,
      maxHp: def.hp,
      flying: def.flying,
      leg,
      next: null,
      slowUntil: 0,
      slowPercent: 0,
      stunUntil: 0,
      shield: def.shield ?? 0,
      progress: 0,
    };
    s.invaders.push(inv);
    return inv;
  }

  private moveInvaders(): void {
    const s = this.state;
    const nest = this.content.valley.lane.exit;
    const nestX = nest.x * CELL + CELL / 2;
    const nestY = nest.y * CELL + CELL / 2;
    const regenTick = s.tick % TICKS_PER_SECOND === 0;
    for (let i = s.invaders.length - 1; i >= 0; i--) {
      const inv = s.invaders[i] as Invader;
      const def = this.invaderDef(inv);
      if (regenTick && def.regen && inv.hp < inv.maxHp) inv.hp = Math.min(inv.maxHp, inv.hp + def.regen);
      let speed = def.speed;
      if (inv.slowUntil > s.tick) speed = Math.floor((speed * (100 - inv.slowPercent)) / 100);
      if (speed < 1) speed = 1;
      if (inv.stunUntil > s.tick) speed = 0;

      if (inv.flying) {
        const arrived = speed > 0 && this.moveToward(inv, nestX, nestY, speed);
        inv.progress = 100_000_000 - Math.abs(nestX - inv.px) - Math.abs(nestY - inv.py);
        if (arrived) this.leak(i);
        continue;
      }

      let budget = speed;
      while (budget > 0) {
        if (inv.next === null) {
          const cell = { x: Math.floor(inv.px / CELL), y: Math.floor(inv.py / CELL) };
          const field = this.fields[inv.leg] as FlowField;
          const step = nextStep(field, this.grid, cell);
          if (step === null) {
            // on the leg's target (or sealed in, which the build rules prevent)
            if (distanceAt(field, this.grid, cell) === 0) {
              inv.leg++;
              if (inv.leg >= this.legs) {
                this.leak(i);
                break;
              }
              continue;
            }
            break;
          }
          inv.next = step;
        }
        const tx = inv.next.x * CELL + CELL / 2;
        const ty = inv.next.y * CELL + CELL / 2;
        const dx = tx - inv.px;
        const dy = ty - inv.py;
        const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
        if (dist <= budget) {
          inv.px = tx;
          inv.py = ty;
          budget -= dist;
          inv.next = null;
        } else {
          inv.px += Math.floor((dx * budget) / dist);
          inv.py += Math.floor((dy * budget) / dist);
          budget = 0;
        }
      }
      if (inv.leg < this.legs) {
        const field = this.fields[inv.leg] as FlowField;
        const cell = { x: Math.floor(inv.px / CELL), y: Math.floor(inv.py / CELL) };
        const d = distanceAt(field, this.grid, cell);
        inv.progress = inv.leg * 10_000_000 - (d === UNREACHABLE ? 9_999_999 : d);
      }
    }
  }

  /** Straight-line move; true when the target centre is reached this tick. */
  private moveToward(inv: Invader, tx: number, ty: number, speed: number): boolean {
    const dx = tx - inv.px;
    const dy = ty - inv.py;
    const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
    if (dist <= speed) {
      inv.px = tx;
      inv.py = ty;
      return true;
    }
    inv.px += Math.floor((dx * speed) / dist);
    inv.py += Math.floor((dy * speed) / dist);
    return false;
  }

  private leak(index: number): void {
    const s = this.state;
    const inv = s.invaders[index] as Invader;
    const def = this.invaderDef(inv);
    s.invaders.splice(index, 1);
    s.eggs -= def.eggs;
    this.events.push({ type: "leaked", invaderId: inv.id, eggs: def.eggs });
    if (s.eggs <= 0) {
      s.eggs = 0;
      s.phase = "lost";
      this.events.push({ type: "lost" });
    }
  }

  private attack(): void {
    const s = this.state;
    if (s.invaders.length === 0) {
      for (const d of s.dinos) if (d.cooldown > 0) d.cooldown--;
      return;
    }
    for (const dino of s.dinos) {
      if (dino.cooldown > 0) {
        dino.cooldown--;
        continue;
      }
      const def = this.dinoDef(dino);
      const cx = dino.x * CELL + CELL / 2;
      const cy = dino.y * CELL + CELL / 2;
      const r2 = def.range * def.range;
      const inRange: Invader[] = [];
      for (const inv of s.invaders) {
        if (!this.canTarget(def, inv)) continue;
        const dx = inv.px - cx;
        const dy = inv.py - cy;
        if (dx * dx + dy * dy > r2) continue;
        inRange.push(inv);
      }
      if (inRange.length === 0) continue;
      // "first": furthest along the trail. Ties by id so every client agrees.
      inRange.sort((a, b) => b.progress - a.progress || a.id - b.id);
      const targets = inRange.slice(0, def.targetCount ?? 1);
      dino.cooldown = def.cooldown;
      for (const target of targets) {
        if (target.hp <= 0) continue; // already killed by splash from an earlier target this tick
        if (def.splash) {
          const sr2 = def.splash * def.splash;
          const victims = s.invaders.filter((inv) => {
            if (!this.canTarget(def, inv)) return false;
            const dx = inv.px - target.px;
            const dy = inv.py - target.py;
            return dx * dx + dy * dy <= sr2;
          });
          for (const v of victims) this.hit(dino, def, v);
        } else {
          this.hit(dino, def, target);
        }
      }
    }
  }

  private canTarget(def: DinoDef, inv: Invader): boolean {
    if (def.targets === "both") return true;
    return def.targets === "air" ? inv.flying : !inv.flying;
  }

  private hit(dino: Dino, def: DinoDef, inv: Invader): void {
    const s = this.state;
    const idef = this.invaderDef(inv);
    if (inv.shield > 0) {
      // a shield eats the whole attack: damage, slow and stun alike
      inv.shield--;
      this.events.push({ type: "attack", dinoId: dino.id, invaderId: inv.id, damage: 0 });
      return;
    }
    let damage = Math.floor((def.damage * kindMultiplier(def.kind, idef.kind)) / 100);
    if (damage < 1) damage = 1;
    inv.hp -= damage;
    if (def.slow) {
      inv.slowUntil = s.tick + def.slow.ticks;
      inv.slowPercent = def.slow.percent;
    }
    if (def.stun && !inv.flying) inv.stunUntil = Math.max(inv.stunUntil, s.tick + def.stun.ticks);
    this.events.push({ type: "attack", dinoId: dino.id, invaderId: inv.id, damage });
    if (inv.hp <= 0) {
      const idx = s.invaders.indexOf(inv);
      if (idx >= 0) s.invaders.splice(idx, 1);
      s.meat += idef.bounty;
      this.events.push({
        type: "killed",
        invaderId: inv.id,
        bounty: idef.bounty,
        at: { x: inv.px, y: inv.py },
      });
      if (idef.splitsInto) {
        const child = this.content.invaders[idef.splitsInto.invader];
        if (child) {
          const into: number[] = [];
          for (let i = 0; i < idef.splitsInto.count; i++) {
            const c = this.spawnInvader(child, inv.px, inv.py, inv.leg);
            into.push(c.id);
          }
          this.events.push({ type: "split", invaderId: inv.id, into });
        }
      }
    }
  }

  private invaderOccupies(x: number, y: number): boolean {
    for (const inv of this.state.invaders) {
      if (inv.flying) continue;
      if (Math.floor(inv.px / CELL) === x && Math.floor(inv.py / CELL) === y) return true;
      if (inv.next && inv.next.x === x && inv.next.y === y) return true;
    }
    return false;
  }

  private rebuildFields(): void {
    this.fields = computeLaneFields(this.grid, this.content.valley.lane);
    // invaders mid-step keep their current target cell (still walkable, the
    // build rules guarantee it); they pick a new direction at the next cell.
    //
    // Building on a checkpoint changes which cells end that leg, so this has
    // to recompute from the grid rather than from a cached target list.
  }

  /** Flow field for a lane leg; the renderer uses it to draw the route preview. */
  field(leg: number): FlowField | undefined {
    return this.fields[leg];
  }

  /**
   * A stable fingerprint of the state. Two clients that agree on it after
   * the same command log are in sync; the server uses it to verify runs.
   */
  hash(): number {
    const s = this.state;
    const parts: number[] = [s.tick, s.phase.length, s.migration, s.buildTimer, s.meat, s.eggs, s.nextId];
    for (const d of s.dinos) parts.push(d.id, d.x, d.y, d.cooldown, d.invested, d.defId.length);
    for (const i of s.invaders) parts.push(i.id, i.px, i.py, i.hp, i.leg, i.slowUntil, i.stunUntil, i.shield);
    let h = 0x811c9dc5;
    for (const p of parts) {
      h ^= p & 0xffff;
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= p >>> 16;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
}
