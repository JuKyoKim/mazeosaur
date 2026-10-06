import { describe, expect, it } from "vitest";
import { MUSIC_CROSSFADE_MS, SOUNDS, SfxBus, type SoundId } from "../src/audio.js";
import { NULL_AUDIO_PORT, type AudioPort } from "../src/platform.js";

/**
 * The audio seam's behaviour, without a browser and without waiting in real
 * time — `SfxBus` takes its clock as an argument for exactly that reason.
 *
 * The thing worth asserting is not that a sound plays; it is the limiter.
 * Section 6 of `docs/01-art-hud-and-audio.md` caps `hit` because sixty
 * invaders under six adult dinosaurs is hundreds of hits a second, and an
 * uncapped stream is a buzzsaw that also costs frames. A cap that silently
 * stopped working would not fail any other test and would not look like a
 * bug in a screenshot.
 */

/** A sink that records instead of making a noise. */
function recorder(): { played: { id: string; hue?: number }[]; music: (string | null)[]; port: AudioPort } {
  const played: { id: string; hue?: number }[] = [];
  const music: (string | null)[] = [];
  return {
    played,
    music,
    port: {
      available: true,
      play(id: string, _volume?: number, hue?: number) {
        played.push(hue === undefined ? { id } : { id, hue });
      },
      music(id: string | null) {
        music.push(id);
      },
      volumes() {},
    },
  };
}

/** A clock the test moves by hand. */
function clock(start = 0): { t: number; now: () => number; advance: (ms: number) => number } {
  const c = { t: start, now: () => c.t, advance: (ms: number) => (c.t += ms) };
  return c;
}

describe("the SFX table", () => {
  it("caps only the two combat sounds, which are the only ones the board can spam", () => {
    const capped = (Object.keys(SOUNDS) as SoundId[]).filter((id) => SOUNDS[id].minGapMs > 0);
    expect(capped.sort()).toEqual(["hit", "kill"]);
    expect(SOUNDS.hit.minGapMs).toBe(60);
    expect(SOUNDS.kill.minGapMs).toBe(90);
  });

  it("gives every sound a duration and a ducking rule", () => {
    for (const [id, spec] of Object.entries(SOUNDS)) {
      expect(spec.ms, `${id} has no duration`).toBeGreaterThan(0);
      expect(["none", "music", "all"], `${id} ducking`).toContain(spec.ducks);
    }
    // A boss is the one thing allowed to interrupt everything, along with
    // the two run-ending sounds.
    const all = (Object.keys(SOUNDS) as SoundId[]).filter((id) => SOUNDS[id].ducks === "all");
    expect(all.sort()).toEqual(["defeat", "kill-boss", "leak-boss", "victory"]);
  });

  it("crossfades the phase change rather than cutting it", () => {
    expect(MUSIC_CROSSFADE_MS).toBe(1200);
  });
});

describe("the hit limiter", () => {
  it("drops rather than queues, so a burst never outlasts itself", () => {
    const r = recorder();
    const c = clock();
    const bus = new SfxBus(r.port, c.now);

    // 100 hits inside a single 20Hz tick: what six adult dinosaurs over a
    // swarm migration actually produces.
    for (let i = 0; i < 100; i++) expect(bus.play("hit", 0x111111)).toBe(i === 0);
    expect(r.played).toHaveLength(1);
    expect(bus.dropped).toBe(99);

    // Nothing was held back for later: time passing does not release a queue.
    c.advance(59);
    expect(bus.play("hit")).toBe(false);
    c.advance(1);
    expect(bus.play("hit")).toBe(true);
    expect(r.played).toHaveLength(2);
  });

  it("lets through about one hit per 60ms over a sustained burst", () => {
    const r = recorder();
    const c = clock();
    const bus = new SfxBus(r.port, c.now);
    // One second of hits at 200Hz.
    for (let i = 0; i < 200; i++) {
      bus.play("hit");
      c.advance(5);
    }
    // 1000ms / 60ms, give or take the first one.
    expect(r.played.length).toBeGreaterThanOrEqual(16);
    expect(r.played.length).toBeLessThanOrEqual(18);
  });

  it("caps kill separately from hit, so one does not starve the other", () => {
    const r = recorder();
    const c = clock();
    const bus = new SfxBus(r.port, c.now);
    expect(bus.play("hit")).toBe(true);
    expect(bus.play("kill")).toBe(true);
    c.advance(60);
    expect(bus.play("hit")).toBe(true);
    // kill's gap is 90ms, so it is still closed at 60.
    expect(bus.play("kill")).toBe(false);
    c.advance(30);
    expect(bus.play("kill")).toBe(true);
  });

  it("never caps a sound the player causes", () => {
    const r = recorder();
    const bus = new SfxBus(r.port, clock().now);
    for (const id of ["place", "blocked", "grow", "sell", "select"] as SoundId[]) {
      expect(bus.play(id), `${id} was capped`).toBe(true);
      expect(bus.play(id), `${id} was capped on repeat`).toBe(true);
    }
  });

  it("rotates the hue across a capped burst instead of always using the first", () => {
    const r = recorder();
    const c = clock();
    const bus = new SfxBus(r.port, c.now);
    const hues = [0xf4a82a, 0xbd2b1d, 0x3ab1ea];
    // Three kinds all firing, far faster than the cap, for several windows.
    for (let window = 0; window < 3; window++) {
      for (const h of hues) bus.play("hit", h);
      c.advance(60);
    }
    bus.play("hit", hues[0]);
    const used = r.played.filter((p) => p.id === "hit").map((p) => p.hue);
    // Every kind that asked reached the sink, which is the whole point: a
    // cap that always picked the first would make a three-kind board sound
    // like a one-kind board. Asserting the exact set rather than "more than
    // one" is deliberate — a rotation that loses a kind still passes the
    // weaker assertion, and that is how a hue leak once went unnoticed.
    expect(new Set(used)).toEqual(new Set(hues));
  });

  it("lets a kill through a hit burst without taking a hue or a rotation slot", () => {
    const r = recorder();
    const c = clock();
    const bus = new SfxBus(r.port, c.now);
    const [amber, rust, sky] = [0xf4a82a, 0xbd2b1d, 0x3ab1ea];

    // Three kinds land hits inside one cap window: the first is audible and
    // the other two hues are held back for the rotation to spend later.
    expect(bus.play("hit", amber)).toBe(true);
    expect(bus.play("hit", rust)).toBe(false);
    expect(bus.play("hit", sky)).toBe(false);

    // Then an invader dies. §6 gives `kill` "a wet snap plus a meat chime"
    // and the cap at 90ms — the cap, not the hue rotation. It is not pitched
    // by kind, and the scene passes no hue for it. The sink applies
    // `semitones(hue)` to whatever it is handed, so handing it a hue here
    // would detune the kill by whichever dinosaur was capped a moment ago.
    expect(bus.play("kill")).toBe(true);
    expect(r.played.filter((p) => p.id === "kill")).toEqual([{ id: "kill" }]);

    // And the kill must not have *consumed* a slot either: the rotation
    // still owes rust and sky, so the next two windows pay them out.
    c.advance(60);
    bus.play("hit", amber);
    c.advance(60);
    bus.play("hit", amber);

    const used = r.played.filter((p) => p.id === "hit").map((p) => p.hue);
    expect(new Set(used)).toEqual(new Set([amber, rust, sky]));
  });
});

describe("mute is a supported configuration, not a degraded one", () => {
  it("runs the limiter and the phase tracking over NULL_AUDIO_PORT", () => {
    const c = clock();
    const bus = new SfxBus(NULL_AUDIO_PORT, c.now);
    expect(() => {
      for (const id of Object.keys(SOUNDS) as SoundId[]) bus.play(id);
      bus.music("build");
      bus.music("migration");
    }).not.toThrow();
    // The cap still applied, so the game's behaviour does not depend on
    // whether a sink is present.
    expect(bus.play("hit")).toBe(false);
    expect(bus.currentLayer).toBe("migration");
  });
});

describe("music", () => {
  it("crossfades once per change and ignores a repeat", () => {
    const r = recorder();
    const bus = new SfxBus(r.port, clock().now);
    // update() calls music() every frame; only the changes may reach the sink.
    bus.music("build");
    bus.music("build");
    bus.music("migration");
    bus.music("migration");
    bus.music("build");
    expect(r.music).toEqual(["build", "migration", "build"]);
  });

  it("stops the track with null rather than with a layer name", () => {
    const r = recorder();
    const bus = new SfxBus(r.port, clock().now);
    bus.music("migration");
    bus.music("none");
    expect(r.music).toEqual(["migration", null]);
    expect(bus.currentLayer).toBe("none");
  });
});

describe("a new run", () => {
  it("starts with the limiter open, because create() builds a fresh bus", () => {
    const r = recorder();
    const c = clock();
    const first = new SfxBus(r.port, c.now);
    first.play("hit");
    first.music("migration");
    // Same instant, new bus: a `scene.restart()` must not inherit a closed
    // limiter, or the next run's first hit and kill are silent. This is
    // what makes the absence of a `reset()` safe — see audio.ts.
    const next = new SfxBus(r.port, c.now);
    expect(next.play("hit")).toBe(true);
    expect(next.dropped).toBe(0);
    expect(next.currentLayer).toBe("none");
  });
});
