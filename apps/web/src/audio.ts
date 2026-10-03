import { SOUNDS, type AudioService, type MusicLayer, type SoundId } from "@mazeosaur/game";

/**
 * A sound sink built entirely from oscillators and noise. No files, no
 * decoding, no network — which is what lets it exist before the clips do and
 * is also the only kind of audio a mobile build may contain (rule 2).
 *
 * **These are placeholders.** Section 6 of the art spec describes each sound
 * in words ("a dry wooden click, no tone", "a wet snap plus a meat chime")
 * and the real recordings are the designer's, landing with the art
 * direction. What is real here is everything around the clip: the envelope
 * lengths from the spec's `ms` column, the ducking rules, the phase
 * cross-fade, and the fact that a missing or blocked audio context costs the
 * game nothing. Swapping a buffer in behind this interface changes no
 * caller.
 */

/** Section 6: the two layers cross-fade on phase over 1.2 seconds. */
const CROSSFADE_S = 1.2;
/** How far the music drops while a ducking sound plays, and the sfx bed too. */
const DUCK_TO = { music: 0.25, all: 0.08 };

type Wave = "sine" | "triangle" | "sawtooth" | "square";

interface Recipe {
  /** Base frequency in Hz, before the kind's pitch offset. */
  readonly hz: number;
  /** Where the pitch ends up, as a multiple of `hz`. 1 is flat. */
  readonly bend: number;
  readonly wave: Wave;
  /** Fraction of the voice that is filtered noise rather than tone. */
  readonly noise: number;
  /** Peak gain, before the master. */
  readonly gain: number;
  /** Repeats, for the sounds the spec describes as pulses or overlaps. */
  readonly repeats?: number;
  /** Gap between repeats, as a fraction of the duration. */
  readonly spacing?: number;
}

/**
 * One recipe per sound, following section 6's character column as closely as
 * two oscillators can. The durations are not here: they come from `SOUNDS`,
 * so the spec's `ms` column is the single source for them.
 */
const RECIPES: Record<SoundId, Recipe> = {
  // a soft earth thud plus the kind's pitch
  place: { hz: 140, bend: 0.6, wave: "sine", noise: 0.35, gain: 0.5 },
  // a dry wooden click, no tone
  blocked: { hz: 900, bend: 1, wave: "square", noise: 0.95, gain: 0.35 },
  // the kind's call, a fifth lower, with a swell
  grow: { hz: 220, bend: 1.5, wave: "triangle", noise: 0.1, gain: 0.45 },
  // a short reversed swell
  sell: { hz: 520, bend: 0.35, wave: "triangle", noise: 0.2, gain: 0.4 },
  // a tiny dry tick, pitched by the dinosaur's kind
  hit: { hz: 1400, bend: 0.8, wave: "square", noise: 0.7, gain: 0.18 },
  // a wet snap plus a meat chime
  kill: { hz: 660, bend: 1.6, wave: "sine", noise: 0.45, gain: 0.35 },
  // a long descending bellow and a sub drop
  "kill-boss": { hz: 160, bend: 0.25, wave: "sawtooth", noise: 0.25, gain: 0.6 },
  // a cracked-shell snap, close and dry
  leak: { hz: 300, bend: 0.5, wave: "triangle", noise: 0.8, gain: 0.55 },
  // the same five times, overlapping, plus sub
  "leak-boss": { hz: 240, bend: 0.4, wave: "triangle", noise: 0.8, gain: 0.6, repeats: 5, spacing: 0.12 },
  // a rising three-note horn
  "send-early": { hz: 330, bend: 1.5, wave: "sawtooth", noise: 0.05, gain: 0.4, repeats: 3, spacing: 0.3 },
  // a distant herd call that arrives from the spawn side
  "migration-start": { hz: 180, bend: 1.2, wave: "triangle", noise: 0.3, gain: 0.35 },
  // a two-note resolve, up
  "migration-clear": { hz: 392, bend: 1.26, wave: "sine", noise: 0.05, gain: 0.4, repeats: 2, spacing: 0.45 },
  // a low two-pulse heartbeat, once
  "warn-eggs": { hz: 70, bend: 0.85, wave: "sine", noise: 0.15, gain: 0.7, repeats: 2, spacing: 0.35 },
  // a short soft tick
  select: { hz: 1100, bend: 1, wave: "sine", noise: 0.2, gain: 0.14 },
  // the drone collapses to silence over 2s
  defeat: { hz: 130, bend: 0.2, wave: "sawtooth", noise: 0.2, gain: 0.5 },
  // the build-phase theme, full, resolved
  victory: { hz: 262, bend: 2, wave: "triangle", noise: 0.05, gain: 0.45, repeats: 4, spacing: 0.22 },
};

/** One second of mono noise, generated once and reused by every voice. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // A plain LCG rather than Math.random: this is presentation, so it does
  // not have to be deterministic, but a fixed bed means two runs of a drive
  // compare cleanly.
  let seed = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff - 1) * 0.6;
  }
  return buf;
}

/**
 * The kind's hue as a pitch offset, in semitones across a tritone. Section 6
 * pitches `place` and `hit` by kind; the hue is what the client already has
 * to hand, and deriving the offset from it means a new kind gets a voice
 * without anybody choosing a number.
 */
function semitones(hue: number | undefined): number {
  if (hue === undefined) return 0;
  const r = (hue >> 16) & 0xff;
  const g = (hue >> 8) & 0xff;
  const b = hue & 0xff;
  return (((r * 7 + g * 3 + b) % 13) - 6) / 2;
}

const ratio = (semis: number): number => 2 ** (semis / 12);

export function createWebAudio(): AudioService {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let musicGain: GainNode;
  let sfxGain: GainNode;
  let noise: AudioBuffer;
  let musicVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  let layer: MusicLayer = "none";
  /** When the current duck ends, so a shorter sound cannot cut a longer one. */
  let duckUntil = 0;

  /**
   * The context is created on the first sound, not at load. Browsers block
   * one made before a gesture, and the title screen's play button is the
   * gesture — so the first sound a run makes is also the thing that is
   * allowed to make it. Everything here no-ops if that still fails.
   */
  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 1;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 1;
      sfxGain.connect(master);
      noise = noiseBuffer(ctx);
      return ctx;
    } catch {
      // No output device, or the context was refused. Silence is a valid
      // outcome: the game is fully playable this way.
      ctx = null;
      return null;
    }
  }

  /** Dip the music, and for a boss or a run ending the sfx bed too. */
  function duck(kind: "music" | "all", seconds: number): void {
    const c = ctx;
    if (!c) return;
    const end = c.currentTime + seconds;
    if (end <= duckUntil) return;
    duckUntil = end;
    const to = DUCK_TO[kind];
    const ramp = (node: GainNode) => {
      node.gain.cancelScheduledValues(c.currentTime);
      node.gain.setTargetAtTime(to, c.currentTime, 0.02);
      node.gain.setTargetAtTime(1, end, 0.12);
    };
    ramp(musicGain);
    if (kind === "all") ramp(sfxGain);
  }

  /** One voice: a bent oscillator and a band of noise under one envelope. */
  function voice(c: AudioContext, r: Recipe, at: number, seconds: number, hz: number): void {
    const env = c.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(r.gain, at + Math.min(0.012, seconds * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    env.connect(sfxGain);

    if (r.noise < 1) {
      const osc = c.createOscillator();
      osc.type = r.wave;
      osc.frequency.setValueAtTime(hz, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, hz * r.bend), at + seconds);
      const g = c.createGain();
      g.gain.value = 1 - r.noise;
      osc.connect(g).connect(env);
      osc.start(at);
      osc.stop(at + seconds);
    }
    if (r.noise > 0) {
      const src = c.createBufferSource();
      src.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(hz, at);
      bp.frequency.exponentialRampToValueAtTime(Math.max(40, hz * r.bend), at + seconds);
      bp.Q.value = 1.2;
      const g = c.createGain();
      g.gain.value = r.noise;
      src.connect(bp).connect(g).connect(env);
      src.start(at, 0, Math.min(seconds, 1));
      src.stop(at + seconds);
    }
  }

  return {
    play(id: SoundId, hue?: number): void {
      const c = ensure();
      if (!c) return;
      const spec = SOUNDS[id];
      const r = RECIPES[id];
      const seconds = spec.ms / 1000;
      if (spec.ducks !== "none") duck(spec.ducks, seconds);
      const hz = r.hz * ratio(semitones(hue));
      const repeats = r.repeats ?? 1;
      const step = seconds * (r.spacing ?? 0);
      // Repeats share the nominal duration rather than extending past it,
      // so "the same five times, overlapping" stays inside its 900ms.
      const each = repeats > 1 ? seconds * (1 - step * (repeats - 1) / seconds) : seconds;
      for (let i = 0; i < repeats; i++) {
        voice(c, r, c.currentTime + i * step, Math.max(0.03, each), hz * (r.bend > 1 ? ratio(i * 2) : 1));
      }
    },

    music(next: MusicLayer): void {
      const c = ensure();
      if (!c || next === layer) return;
      layer = next;
      const t = c.currentTime;
      for (const v of musicVoices) {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, CROSSFADE_S / 3);
        v.osc.stop(t + CROSSFADE_S * 2);
      }
      musicVoices = [];
      if (next === "none") return;
      // Valley, not jungle: a slow drone plus a low drum in a build phase,
      // the same drone with a pulse and a higher line during a migration.
      const beds = next === "build" ? [55, 82.5] : [55, 82.5, 164.8, 220];
      for (const hz of beds) {
        const osc = c.createOscillator();
        osc.type = hz > 150 ? "triangle" : "sine";
        osc.frequency.value = hz;
        const g = c.createGain();
        g.gain.value = 0;
        g.gain.setTargetAtTime(hz > 150 ? 0.035 : 0.07, t, CROSSFADE_S / 3);
        osc.connect(g).connect(musicGain);
        osc.start(t);
        musicVoices.push({ osc, gain: g });
      }
    },
  };
}
