import { describe, expect, it } from "vitest";
import { Game, type LoggedCommand } from "../src/game.js";
import {
  SAVE_FORMAT,
  SAVE_VERSION,
  ReplayDivergedError,
  freshSave,
  loadSave,
  replay,
  runMigrations,
  type RunSave,
  type SaveDocument,
} from "../src/save.js";
import { SAVE_MIGRATIONS, type SaveMigration } from "../src/save-migrations.js";
import { fixture } from "./fixture.js";

const BUILD = { commit: "dev", platform: "node" as const };

/** Plays the fixture content up to and including its first "send", landing mid-migration. */
function playIntoMigration(): Game {
  const g = new Game(fixture, 1);
  g.apply({ type: "place", defId: "raptor-1", x: 1, y: 0 });
  for (let i = 0; i < 5; i++) g.tick();
  g.apply({ type: "send" });
  for (let i = 0; i < 10; i++) g.tick();
  return g;
}

function runSaveFrom(g: Game): RunSave {
  return {
    valleyId: fixture.valley.id,
    seed: g.seed,
    contentVersion: fixture.version,
    startedBy: BUILD,
    log: g.log,
    tick: g.state.tick,
    hash: g.hash(),
    playedMs: 12_345,
  };
}

describe("save format version", () => {
  it("is exactly one more than the migration list", () => {
    expect(SAVE_VERSION).toBe(1 + SAVE_MIGRATIONS.length);
  });
});

describe("freshSave", () => {
  it("has no run and an empty profile", () => {
    const doc = freshSave(BUILD);
    expect(doc.format).toBe(SAVE_FORMAT);
    expect(doc.version).toBe(SAVE_VERSION);
    expect(doc.run).toBeNull();
    expect(doc.profile.fossilsEarned).toBe(0);
    expect(doc.profile.best).toEqual({});
  });
});

describe("replay", () => {
  it("reaches the same hash as the live game it was saved from, mid-migration", () => {
    const live = playIntoMigration();
    const run = runSaveFrom(live);
    const replayed = replay(fixture, run);
    expect(replayed.hash()).toBe(live.hash());
    expect(replayed.state.tick).toBe(live.state.tick);
    expect(replayed.state).toEqual(live.state);
  });

  it("survives a JSON round trip, as a save on disk would", () => {
    const live = playIntoMigration();
    const run = JSON.parse(JSON.stringify(runSaveFrom(live))) as RunSave;
    const replayed = replay(fixture, run);
    expect(replayed.hash()).toBe(live.hash());
  });

  it("throws when the saved hash does not match", () => {
    const live = playIntoMigration();
    const run = { ...runSaveFrom(live), hash: live.hash() ^ 1 };
    expect(() => replay(fixture, run)).toThrow(ReplayDivergedError);
  });

  it("throws when a logged command is refused on replay", () => {
    const live = playIntoMigration();
    const run = runSaveFrom(live);
    const badLog: LoggedCommand[] = [...run.log, { tick: run.tick, command: { type: "grow", dinoId: 99999 } }];
    expect(() => replay(fixture, { ...run, log: badLog, tick: run.tick })).toThrow(ReplayDivergedError);
  });

  it("throws rather than looping forever when the saved tick is past the game's end", () => {
    const g = new Game(fixture, 1);
    // Drain eggs by never building a wall; the fixture's lane feeds straight to the nest.
    while (g.state.phase !== "lost" && g.state.tick < 10_000) {
      if (g.state.phase === "build") g.apply({ type: "send" });
      g.tick();
    }
    expect(g.state.phase).toBe("lost");
    const run = { ...runSaveFrom(g), tick: g.state.tick + 50 };
    expect(() => replay(fixture, run)).toThrow(ReplayDivergedError);
  });
});

describe("runMigrations", () => {
  it("runs only entries above the document's version, in order", () => {
    const applied: number[] = [];
    const synthetic: SaveMigration[] = [
      { to: 2, because: "test: adds a field", up: (d) => (applied.push(2), { ...d, addedAtTwo: true }) },
      { to: 3, because: "test: adds another field", up: (d) => (applied.push(3), { ...d, addedAtThree: true }) },
    ];
    const out = runMigrations({ version: 1 }, synthetic, 1);
    expect(applied).toEqual([2, 3]);
    expect(out).toMatchObject({ addedAtTwo: true, addedAtThree: true });
  });

  it("skips entries at or below the document's version", () => {
    const synthetic: SaveMigration[] = [{ to: 2, because: "test", up: (d) => ({ ...d, touched: true }) }];
    const out = runMigrations({ version: 2 }, synthetic, 2);
    expect(out).toEqual({ version: 2 });
  });
});

describe("loadSave", () => {
  it("loads a fresh document unchanged", () => {
    const doc = freshSave(BUILD);
    const outcome = loadSave(JSON.parse(JSON.stringify(doc)), fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.doc).toEqual(doc);
      expect(outcome.migratedFrom).toBeNull();
      expect(outcome.runDropped).toBeNull();
      expect(outcome.resumed).toBeNull();
    }
  });

  it("loads a document with a resumable run mid-migration, dropping nothing", () => {
    const live = playIntoMigration();
    const doc: SaveDocument = { ...freshSave(BUILD), run: runSaveFrom(live) };
    const outcome = loadSave(JSON.parse(JSON.stringify(doc)), fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.runDropped).toBeNull();
      expect(outcome.doc.run?.tick).toBe(live.state.tick);
    }
  });

  it("resumed is the replay's own object: same hash and tick as the run it was built from", () => {
    const live = playIntoMigration();
    const doc: SaveDocument = { ...freshSave(BUILD), run: runSaveFrom(live) };
    const outcome = loadSave(JSON.parse(JSON.stringify(doc)), fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resumed).not.toBeNull();
      expect(outcome.resumed?.hash()).toBe(outcome.doc.run?.hash);
      expect(outcome.resumed?.state.tick).toBe(outcome.doc.run?.tick);
    }
  });

  it("resumed is null for a fresh document, which has no run to resume", () => {
    const outcome = loadSave(JSON.parse(JSON.stringify(freshSave(BUILD))), fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.doc.run).toBeNull();
      expect(outcome.resumed).toBeNull();
    }
  });

  it("rejects a document with no format field", () => {
    expect(loadSave({ version: 1 }, fixture, "node")).toEqual({ ok: false, reason: "not-a-save" });
  });

  it("rejects a non-object", () => {
    expect(loadSave("not a save", fixture, "node")).toEqual({ ok: false, reason: "not-a-save" });
    expect(loadSave(null, fixture, "node")).toEqual({ ok: false, reason: "not-a-save" });
  });

  it("rejects a non-positive-integer version as not-a-save", () => {
    expect(loadSave({ format: SAVE_FORMAT, version: 0 }, fixture, "node")).toEqual({ ok: false, reason: "not-a-save" });
    expect(loadSave({ format: SAVE_FORMAT, version: 1.5 }, fixture, "node")).toEqual({ ok: false, reason: "not-a-save" });
  });

  it("refuses to load, and does not throw, a save from a newer version", () => {
    const doc = { ...freshSave(BUILD), version: SAVE_VERSION + 1 };
    expect(loadSave(doc, fixture, "node")).toEqual({ ok: false, reason: "from-the-future" });
  });

  it("flags a structurally broken document as corrupt rather than crashing", () => {
    const doc = { ...freshSave(BUILD), profile: "not a profile" };
    expect(loadSave(doc, fixture, "node")).toEqual({ ok: false, reason: "corrupt" });
  });

  it("repairs a missing writtenBy instead of rejecting the document", () => {
    const doc = freshSave(BUILD) as unknown as Record<string, unknown>;
    delete (doc as { writtenBy?: unknown }).writtenBy;
    const outcome = loadSave(doc, fixture, "ios");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.doc.writtenBy).toEqual({ commit: "unknown", platform: "ios" });
  });

  it("drops the run but keeps the profile when content.version no longer matches", () => {
    const live = playIntoMigration();
    const run = { ...runSaveFrom(live), contentVersion: "a-version-that-no-longer-exists" };
    const doc: SaveDocument = { ...freshSave(BUILD), profile: { ...freshSave(BUILD).profile, fossilsEarned: 7 }, run };
    const outcome = loadSave(doc, fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.runDropped).toBe("content-version");
      expect(outcome.doc.run).toBeNull();
      expect(outcome.doc.profile.fossilsEarned).toBe(7);
      expect(outcome.resumed).toBeNull();
    }
  });

  it("drops the run but keeps the profile when the replay diverges", () => {
    const live = playIntoMigration();
    const run = { ...runSaveFrom(live), hash: live.hash() ^ 1 };
    const doc: SaveDocument = { ...freshSave(BUILD), profile: { ...freshSave(BUILD).profile, fossilsEarned: 7 }, run };
    const outcome = loadSave(doc, fixture, "node");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.runDropped).toBe("replay-diverged");
      expect(outcome.doc.run).toBeNull();
      expect(outcome.doc.profile.fossilsEarned).toBe(7);
      expect(outcome.resumed).toBeNull();
    }
  });
});
