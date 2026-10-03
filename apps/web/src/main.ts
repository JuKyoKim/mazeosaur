import { mountGame, NULL_AUDIO_PORT, NULL_SAVE_STORE, type PlatformServices } from "@mazeosaur/game";
import { content } from "@mazeosaur/content";
import { freshSave, loadSave, type BuildStamp, type SaveDocument } from "@mazeosaur/sim";
import { IndexedDbSaveStore, moveAsideCorruptSave, readRawSave } from "./save-store.js";

// TODO(maze-release #8): once the `__BUILD_COMMIT__` define lands, read it
// here instead of the literal. Until then every web build honestly stamps
// "dev", which is what docs/01-v1-architecture.md §1.2 says a build nobody
// stamped should say.
const build: BuildStamp = { commit: "dev", platform: "web" };

// The shell decides the seed. `?seed=` pins one so a bug can be reproduced
// exactly; otherwise every run is fresh. Read once: a pinned seed repeats
// across every call this session, a free one does not.
const params = new URLSearchParams(location.search);
const pinned = params.has("seed") ? Number(params.get("seed")) : null;
const hasPinnedSeed = pinned !== null && Number.isFinite(pinned);
function nextSeed(): number {
  if (hasPinnedSeed) return (pinned as number) >>> 0;
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

async function boot(): Promise<void> {
  const raw = await readRawSave();
  const outcome = loadSave(raw, content, build.platform);

  // A save from a newer build must not be clobbered by this one (§1.4):
  // play from a fresh document in memory and never touch the stored
  // bytes for the rest of the session, including every later autosave.
  if (!outcome.ok && outcome.reason === "from-the-future") {
    console.warn("mazeosaur: this save was written by a newer version; starting a fresh run without touching it.");
    void startGame(freshSave(build), NULL_SAVE_STORE);
    return;
  }

  if (!outcome.ok) {
    if (raw !== undefined) await moveAsideCorruptSave(raw);
    void startGame(freshSave(build), new IndexedDbSaveStore());
    return;
  }

  if (outcome.runDropped === "content-version") {
    console.warn("mazeosaur: the saved run was from an older content version; starting a fresh run on the same profile.");
  } else if (outcome.runDropped === "replay-diverged") {
    console.warn("mazeosaur: the saved run did not replay cleanly; starting a fresh run on the same profile.");
  }
  void startGame(outcome.doc, new IndexedDbSaveStore());
}

function startGame(save: SaveDocument, saves: PlatformServices["saves"]): void {
  const game = mountGame({
    parent: "game",
    save,
    services: { saves, audio: NULL_AUDIO_PORT },
    build,
    nextSeed,
  });

  // Dev only: poke the running sim from the console (`mazeosaur.phaser.scene.keys.board.sim`).
  if (import.meta.env.DEV) (window as unknown as { mazeosaur: unknown }).mazeosaur = game;
}

void boot();

// Web only (this file is never imported by apps/mobile or packages/game):
// cache the app shell so a dropped connection mid-migration changes nothing.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration just means no offline cache this session;
      // the game itself needs no network once the page has loaded.
    });
  });
}
