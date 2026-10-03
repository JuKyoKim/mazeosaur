/**
 * The audio seam. `docs/01-art-hud-and-audio.md` section 6 is the source for
 * every number here.
 *
 * Three rules shape this file, and all three are load-bearing:
 *
 * 1. **The game must be fully playable on mute.** No sound may be the thing
 *    that advances state, so nothing here is awaited and nothing here can
 *    fail a command. A null sink is a supported configuration, not a
 *    degraded one — `SfxBus` with no service still runs the limiter and the
 *    phase tracking, it just has nowhere to send the result.
 * 2. **No audio path reaches the network** (repo rule 2). This module names
 *    sounds; it never fetches one. The shell injects something that can make
 *    a noise, and on mobile that something must be local or absent.
 * 3. **`hit` needs a limiter or it is a buzzsaw.** Sixty invaders under six
 *    adult dinosaurs is hundreds of hits a second.
 */

/** Every sound in section 6's table. */
export type SoundId =
  | "place"
  | "blocked"
  | "grow"
  | "sell"
  | "hit"
  | "kill"
  | "kill-boss"
  | "leak"
  | "leak-boss"
  | "send-early"
  | "migration-start"
  | "migration-clear"
  | "warn-eggs"
  | "select"
  | "defeat"
  | "victory";

/** What a sound interrupts while it plays. */
export type Ducks = "none" | "music" | "all";

export interface SoundSpec {
  /** Nominal length in milliseconds, from section 6. */
  readonly ms: number;
  readonly ducks: Ducks;
  /**
   * Minimum milliseconds between two plays of this sound, board-wide. Zero
   * means uncapped. Only the two combat sounds are capped: everything else
   * is already rate-limited by the player or by the migration.
   */
  readonly minGapMs: number;
}

/** Section 6's table, as data. The shell reads `ms` and `ducks`; we read `minGapMs`. */
export const SOUNDS: Record<SoundId, SoundSpec> = {
  place: { ms: 120, ducks: "none", minGapMs: 0 },
  blocked: { ms: 90, ducks: "none", minGapMs: 0 },
  grow: { ms: 600, ducks: "none", minGapMs: 0 },
  sell: { ms: 260, ducks: "none", minGapMs: 0 },
  hit: { ms: 40, ducks: "music", minGapMs: 60 },
  kill: { ms: 180, ducks: "music", minGapMs: 90 },
  "kill-boss": { ms: 1400, ducks: "all", minGapMs: 0 },
  leak: { ms: 300, ducks: "music", minGapMs: 0 },
  "leak-boss": { ms: 900, ducks: "all", minGapMs: 0 },
  "send-early": { ms: 500, ducks: "none", minGapMs: 0 },
  "migration-start": { ms: 900, ducks: "none", minGapMs: 0 },
  "migration-clear": { ms: 700, ducks: "none", minGapMs: 0 },
  "warn-eggs": { ms: 800, ducks: "music", minGapMs: 0 },
  select: { ms: 50, ducks: "none", minGapMs: 0 },
  defeat: { ms: 2000, ducks: "all", minGapMs: 0 },
  victory: { ms: 4000, ducks: "all", minGapMs: 0 },
};

/** The two music layers. They cross-fade on phase over 1.2s rather than cut. */
export type MusicLayer = "build" | "migration" | "none";
export const MUSIC_CROSSFADE_MS = 1200;

/**
 * What the shell injects. Both methods are fire-and-forget: the bus never
 * reads a return value and never waits, so a sink that cannot play — no
 * output device, autoplay still blocked, a mobile build with no audio at
 * all — costs the game nothing.
 *
 * `hue` on `play` is the kind's colour, which is how section 6 pitches
 * `place` and `hit` per kind. It is advisory; a sink may ignore it.
 */
export interface AudioService {
  play(id: SoundId, hue?: number): void;
  music(layer: MusicLayer): void;
}

/**
 * The policy between the scene and the sink: rate limiting, round-robin
 * across hues, and phase-to-music. The scene says what happened; this
 * decides what is actually audible.
 *
 * `now` is injected rather than read from a clock so that the limiter is
 * testable without a browser and without waiting in real time — the
 * limiter is the one piece here with behaviour worth asserting.
 */
export class SfxBus {
  private readonly lastPlayedAt = new Map<SoundId, number>();
  /**
   * Hues seen since the last `hit` actually played. Section 6 asks for
   * round-robin across the hues so a capped stream still sounds
   * distributed, rather than always being whichever dinosaur fired first.
   */
  private pendingHues: number[] = [];
  private hueCursor = 0;
  private layer: MusicLayer = "none";
  /** Counts what the cap threw away, so a drive can report the ratio. */
  private droppedCount = 0;

  constructor(
    private readonly service: AudioService | null,
    private readonly now: () => number,
  ) {}

  /**
   * Ask for a sound. Returns whether it was passed to the sink, which is
   * what the limiter test asserts on; the scene ignores it.
   *
   * A capped sound is **dropped, never queued**: a hit that was not audible
   * within 60ms of happening is not information any more, and queueing it
   * is how a burst turns into a stutter that outlasts the burst.
   */
  play(id: SoundId, hue?: number): boolean {
    const spec = SOUNDS[id];
    const t = this.now();
    if (spec.minGapMs > 0) {
      const last = this.lastPlayedAt.get(id);
      if (last !== undefined && t - last < spec.minGapMs) {
        if (hue !== undefined) this.remember(hue);
        this.droppedCount++;
        return false;
      }
    }
    this.lastPlayedAt.set(id, t);
    const h = spec.minGapMs > 0 ? this.nextHue(hue) : hue;
    this.service?.play(id, h);
    return true;
  }

  /** Cross-fade the music to match the phase. A repeat is a no-op. */
  music(layer: MusicLayer): void {
    if (layer === this.layer) return;
    this.layer = layer;
    this.service?.music(layer);
  }

  get currentLayer(): MusicLayer {
    return this.layer;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Reset for a new run. `scene.restart()` re-runs `create()` on the same
   * instance, so a bus that kept its timestamps would silently swallow the
   * first hit and kill of the next run.
   */
  reset(): void {
    this.lastPlayedAt.clear();
    this.pendingHues = [];
    this.hueCursor = 0;
    this.droppedCount = 0;
    this.layer = "none";
  }

  private remember(hue: number): void {
    if (!this.pendingHues.includes(hue)) this.pendingHues.push(hue);
  }

  /** Take the next hue in rotation among those that asked since last time. */
  private nextHue(hue: number | undefined): number | undefined {
    if (hue !== undefined) this.remember(hue);
    if (this.pendingHues.length === 0) return hue;
    const picked = this.pendingHues[this.hueCursor % this.pendingHues.length];
    this.hueCursor++;
    if (this.hueCursor >= this.pendingHues.length) {
      this.pendingHues = [];
      this.hueCursor = 0;
    }
    return picked ?? hue;
  }
}
