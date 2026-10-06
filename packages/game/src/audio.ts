/**
 * The client's audio policy: the sound table from section 6 of
 * `docs/01-art-hud-and-audio.md`, and the limiter that keeps `hit` from
 * being a buzzsaw. Section 6 is the source for every number here.
 *
 * This is the layer between a scene and `AudioPort`. The port is a dumb
 * sink — it is handed a name and makes a noise. What a name *means*, how
 * long it is, what it interrupts and whether it is allowed to play at all
 * is decided here, in the game package, so that every target gets the same
 * answer from the same table.
 *
 * Three rules shape this file, and all three are load-bearing:
 *
 * 1. **The game must be fully playable on mute.** No sound may be the thing
 *    that advances state, so nothing here is awaited and nothing here can
 *    fail a command. `NULL_AUDIO_PORT` is a supported configuration, not a
 *    degraded one — `SfxBus` over it still runs the limiter and the phase
 *    tracking, it just has nowhere to send the result. That is also why no
 *    scene branches on `AudioPort.available`: §6 gives every sound a visual
 *    partner in §5.4, so there is nothing for a silent build to substitute.
 * 2. **No audio path reaches the network** (repo rule 2). This module names
 *    sounds; it never fetches one. The shell injects something that can make
 *    a noise, and on mobile that something must be local or absent.
 * 3. **`hit` needs a limiter or it is a buzzsaw.** Sixty invaders under six
 *    adult dinosaurs is hundreds of hits a second.
 */
import type { AudioPort } from "./platform.js";

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

/** Section 6's table, as data. The sink reads `ms` and `ducks`; we read `minGapMs`. */
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
 * The policy between the scene and the sink: rate limiting, round-robin
 * across hues, and phase-to-music. The scene says what happened; this
 * decides what is actually audible.
 *
 * `now` is injected rather than read from a clock so that the limiter is
 * testable without a browser and without waiting in real time — the
 * limiter is the one piece here with behaviour worth asserting.
 *
 * There is no `reset()`. `scene.restart()` re-runs `create()` on the same
 * instance, and a bus that kept its timestamps across that would silently
 * swallow the next run's first hit and kill; `create()` therefore builds a
 * fresh bus, which makes the hazard impossible rather than merely handled.
 * If a second construction site ever appears, that is the invariant to
 * keep — not a reset method to remember to call.
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
    private readonly port: AudioPort,
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
    // The rotation is board-wide, not per-sound, so a caller that passes no
    // hue must stay out of it entirely: `hit` and `kill` are both capped,
    // and a `kill` that consulted the rotation would come back carrying
    // some dinosaur's hue — which the sink then detunes by — and would also
    // spend a slot `hit` is owed. §6 gives `kill` the cap at 90ms and
    // nothing else; it is not pitched by kind. The drop path above guards
    // `remember()` the same way, so the two agree.
    const h = spec.minGapMs > 0 && hue !== undefined ? this.nextHue(hue) : hue;
    // Volume is left to the sink: §6 specifies character and length, and
    // per-sound mixing is the sink's own business. `volumes()` is the
    // player's control over it and nothing here touches that either.
    this.port.play(id, undefined, h);
    return true;
  }

  /**
   * Cross-fade the music to match the phase. A repeat is a no-op, which is
   * what lets `update()` call this every frame instead of tracking the
   * phase transition itself.
   */
  music(layer: MusicLayer): void {
    if (layer === this.layer) return;
    this.layer = layer;
    // `AudioPort.music` takes null for "stop", and the layer names are the
    // track ids: the sink knows "build" and "migration" by name.
    this.port.music(layer === "none" ? null : layer);
  }

  get currentLayer(): MusicLayer {
    return this.layer;
  }

  get dropped(): number {
    return this.droppedCount;
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
