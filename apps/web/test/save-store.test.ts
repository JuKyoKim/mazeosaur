import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { content } from "@mazeosaur/content";
import { freshSave, Game, loadSave, type RunSave } from "@mazeosaur/sim";
import { IndexedDbSaveStore, moveAsideCorruptSave, readRawSave } from "../src/save-store.js";

const BUILD = { commit: "dev", platform: "web" as const };

// Deleting the database between tests keeps them independent. Defensive
// rather than strict: a broken or swapped-out `indexedDB` (see "storage
// unavailable" below) must never turn cleanup itself into a hung test.
afterEach(async () => {
  if (typeof indexedDB?.deleteDatabase !== "function") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("mazeosaur");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe("readRawSave", () => {
  it("resolves undefined when nothing has ever been written", async () => {
    expect(await readRawSave()).toBeUndefined();
  });
});

describe("IndexedDbSaveStore", () => {
  it("round-trips a document through put and readRawSave [@baseline]", async () => {
    const store = new IndexedDbSaveStore();
    const doc = freshSave(BUILD);
    await store.put(doc);
    expect(await readRawSave()).toEqual(doc);
  });

  it("clear removes the document", async () => {
    const store = new IndexedDbSaveStore();
    await store.put(freshSave(BUILD));
    await store.clear();
    expect(await readRawSave()).toBeUndefined();
  });

  it(
    "the first write is immediate; rapid follow-ups coalesce into one write of the latest document",
    async () => {
      const store = new IndexedDbSaveStore();
      const first = freshSave(BUILD);
      await store.put(first);
      expect(await readRawSave()).toEqual(first);

      const second = { ...first, profile: { ...first.profile, fossilsEarned: 1 } };
      const third = { ...first, profile: { ...first.profile, fossilsEarned: 2 } };
      const p2 = store.put(second);
      const p3 = store.put(third);
      // Neither coalesced write has landed yet; the store still holds the first document.
      expect(await readRawSave()).toEqual(first);

      await Promise.all([p2, p3]);
      expect(await readRawSave()).toEqual(third);
    },
    10_000,
  );
});

describe("flushNow", () => {
  it("writes a coalesced document immediately instead of waiting out COALESCE_MS [@baseline]", async () => {
    const store = new IndexedDbSaveStore();
    const first = freshSave(BUILD);
    await store.put(first);

    const second = { ...first, profile: { ...first.profile, fossilsEarned: 1 } };
    const p2 = store.put(second);
    expect(await readRawSave()).toEqual(first);

    await store.flushNow();
    expect(await readRawSave()).toEqual(second);
    await p2;
  });

  it("is a no-op when nothing is pending", async () => {
    const store = new IndexedDbSaveStore();
    await store.put(freshSave(BUILD));
    await expect(store.flushNow()).resolves.toBeUndefined();
    expect(await readRawSave()).toEqual(freshSave(BUILD));
  });
});

// The hazard `BoardScene.flush()` must avoid: it snapshots `tick` and
// `hash` but, before this fix, stored a live reference to `Game.log`
// rather than a copy. `IndexedDbSaveStore` only structured-clones a
// document when a coalesced write actually commits, up to `COALESCE_MS`
// later — so a command accepted on the live `Game` in that window landed
// in the stored log past the saved tick, and the next boot dropped the
// run with "replay-diverged". This reproduces the exact numbers from the
// architect's review of PR #24: tick 15 saved, a log entry lands at tick
// 18 before the deferred write commits.
describe("the live-log-vs-coalesced-write hazard (PR #24 review)", () => {
  function runSaveAt(game: Game, overrides: Partial<RunSave> = {}): RunSave {
    return {
      valleyId: content.valley.id,
      seed: game.seed,
      contentVersion: content.version,
      startedBy: BUILD,
      log: game.log,
      tick: game.state.tick,
      hash: game.hash(),
      playedMs: 0,
      ...overrides,
    };
  }

  it("a live `log` reference diverges when a later command lands before the deferred write commits", async () => {
    const store = new IndexedDbSaveStore();
    await store.put(freshSave(BUILD)); // immediate write; starts the coalesce clock.

    const game = new Game(content, 1234);
    game.apply({ type: "place", defId: "raptor-1", x: 2, y: 2 });
    for (let i = 0; i < 15; i++) game.tick();

    // Snapshot tick/hash now, but alias the live array — the bug.
    const run = runSaveAt(game);
    const doc = { ...freshSave(BUILD), run };
    const pending = store.put(doc); // coalesces: deferred up to COALESCE_MS.

    // Gameplay continues while the write is still pending.
    for (let i = 0; i < 3; i++) game.tick();
    game.apply({ type: "place", defId: "raptor-1", x: 0, y: 4 });
    expect(game.state.tick).toBe(18);

    await store.flushNow();
    await pending;

    const raw = await readRawSave();
    const outcome = loadSave(raw, content, "web");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.runDropped).toBe("replay-diverged");
  });

  it("a copied `log` snapshot survives the same race", async () => {
    const store = new IndexedDbSaveStore();
    await store.put(freshSave(BUILD));

    const game = new Game(content, 1234);
    game.apply({ type: "place", defId: "raptor-1", x: 2, y: 2 });
    for (let i = 0; i < 15; i++) game.tick();

    // The fix: copy the log at snapshot time.
    const run = runSaveAt(game, { log: [...game.log] });
    const doc = { ...freshSave(BUILD), run };
    const pending = store.put(doc);

    for (let i = 0; i < 3; i++) game.tick();
    game.apply({ type: "place", defId: "raptor-1", x: 0, y: 4 });

    await store.flushNow();
    await pending;

    const raw = await readRawSave();
    const outcome = loadSave(raw, content, "web");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.runDropped).toBeNull();
  });
});

describe("moveAsideCorruptSave", () => {
  it("backs up the raw record without disturbing the live save", async () => {
    const store = new IndexedDbSaveStore();
    const doc = freshSave(BUILD);
    await store.put(doc);
    await moveAsideCorruptSave({ not: "a save" });
    expect(await readRawSave()).toEqual(doc);
  });
});

describe("storage unavailable (private browsing)", () => {
  const realIndexedDb = indexedDB;

  beforeEach(() => {
    // Some private-browsing contexts throw synchronously from `open`
    // rather than failing the request asynchronously.
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          throw new Error("storage disabled");
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: realIndexedDb });
  });

  it("readRawSave resolves undefined instead of throwing", async () => {
    await expect(readRawSave()).resolves.toBeUndefined();
  });

  it("IndexedDbSaveStore.put rejects rather than silently losing progress", async () => {
    const store = new IndexedDbSaveStore();
    await expect(store.put(freshSave(BUILD))).rejects.toThrow();
  });

  it("moveAsideCorruptSave resolves without throwing when there is nowhere to write", async () => {
    await expect(moveAsideCorruptSave({ anything: true })).resolves.toBeUndefined();
  });
});
