import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshSave } from "@mazeosaur/sim";
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
  it("round-trips a document through put and readRawSave", async () => {
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
