import type { SaveStore } from "@mazeosaur/game";
import type { SaveDocument } from "@mazeosaur/sim";

// docs/01-v1-architecture.md §1.7: IndexedDB, database "mazeosaur", object
// store "save", key "default". One document per device; `CORRUPT_KEY` is
// the one backup slot for a record that failed to load.
const DB_NAME = "mazeosaur";
const STORE = "save";
const SAVE_KEY = "default";
const CORRUPT_KEY = "corrupt";

/** At most one real write every two seconds (§1.7); rapid autosaves coalesce into the latest document. */
const COALESCE_MS = 2000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      // Some private-browsing contexts throw synchronously on open rather
      // than failing the request.
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("mazeosaur: IndexedDB open failed"));
    req.onblocked = () => reject(new Error("mazeosaur: IndexedDB open blocked by another tab"));
  });
}

// Each call opens its own connection and closes it once the transaction
// settles, rather than holding one open for the life of the store: a save
// happens a few times a minute at most, and an open connection is the
// thing that makes IndexedDB's own `deleteDatabase` hang.
function runTx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.onerror = () => reject(tx.error ?? new Error("mazeosaur: IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("mazeosaur: IndexedDB transaction aborted"));
    tx.oncomplete = () => resolve(req.result);
  }).finally(() => db.close());
}

/**
 * Reads the raw save at boot, before `mountGame`. Not part of `SaveStore`:
 * the port is write-only (see `packages/game/src/platform.ts`), because
 * the shell reads once, runs `loadSave`, and hands the result to the game
 * package. Any failure to reach storage at all — no IndexedDB, a private
 * browsing context that refuses it — comes back as `undefined`, which
 * `loadSave` treats the same as a device with nothing saved yet.
 */
export async function readRawSave(): Promise<unknown> {
  try {
    const db = await openDb();
    return await runTx(db, "readonly", (store) => store.get(SAVE_KEY));
  } catch {
    return undefined;
  }
}

/**
 * Moves a record that failed to load into the one backup slot, overwritten
 * each time. Best-effort: if storage is unreachable there is nowhere to put
 * it, and starting fresh in memory is still the right outcome.
 */
export async function moveAsideCorruptSave(raw: unknown): Promise<void> {
  try {
    const db = await openDb();
    await runTx(db, "readwrite", (store) => store.put(raw, CORRUPT_KEY));
  } catch {
    // Nowhere to back it up; the fresh save the shell starts with is the best available outcome.
  }
}

/**
 * The web `SaveStore`. `put` resolves once the document is durably
 * written, or rejects with whatever IndexedDB raised — a quota error, a
 * blocked upgrade, a private-browsing refusal. It never loses what was
 * already on disk: a rejected write just means the previous document is
 * still there, because an IndexedDB transaction either commits whole or
 * not at all.
 */
export class IndexedDbSaveStore implements SaveStore {
  private lastWriteAt = -Infinity;
  private pendingDoc: SaveDocument | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWaiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  put(doc: SaveDocument): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastWriteAt;
    if (elapsed >= COALESCE_MS && this.pendingTimer === null) {
      this.lastWriteAt = now;
      return this.writeNow(doc);
    }
    this.pendingDoc = doc;
    return new Promise((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject });
      if (this.pendingTimer === null) {
        this.pendingTimer = setTimeout(() => void this.flushPending(), Math.max(0, COALESCE_MS - elapsed));
      }
    });
  }

  /**
   * Writes any coalesced-but-not-yet-committed document immediately,
   * instead of waiting out the rest of `COALESCE_MS`. Not part of
   * `SaveStore` (same precedent as `readRawSave`): `GameHandle.suspend()`
   * only has the port's `put`, which would otherwise defer the suspend
   * write by up to two seconds — long enough for the OS to have already
   * killed the page. The web shell calls this right after `suspend()`.
   * A no-op when nothing is pending.
   */
  flushNow(): Promise<void> {
    if (this.pendingTimer === null) return Promise.resolve();
    clearTimeout(this.pendingTimer);
    return this.flushPending();
  }

  async clear(): Promise<void> {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingDoc = null;
    for (const waiter of this.pendingWaiters.splice(0)) waiter.resolve();
    const db = await openDb();
    await runTx(db, "readwrite", (store) => store.delete(SAVE_KEY));
  }

  private async flushPending(): Promise<void> {
    this.pendingTimer = null;
    const doc = this.pendingDoc;
    this.pendingDoc = null;
    const waiters = this.pendingWaiters.splice(0);
    if (!doc) return;
    this.lastWriteAt = Date.now();
    try {
      await this.writeNow(doc);
      for (const w of waiters) w.resolve();
    } catch (e) {
      for (const w of waiters) w.reject(e);
    }
  }

  private async writeNow(doc: SaveDocument): Promise<void> {
    const db = await openDb();
    await runTx(db, "readwrite", (store) => store.put(doc, SAVE_KEY));
  }
}
