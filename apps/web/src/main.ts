import { mountGame } from "@mazeosaur/game";
import { createWebAudio } from "./audio.js";

// The shell decides the seed, and keeps deciding it: every run asks for a
// new one, play-again included. `?seed=123` pins the lot so a bug can be
// reproduced exactly; otherwise each run is fresh.
const params = new URLSearchParams(location.search);
const fromUrl = Number(params.get("seed"));
const pinned = Number.isFinite(fromUrl) && params.has("seed") ? fromUrl >>> 0 : null;
const nextSeed = () => pinned ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

// `?mute` plays the whole game silently, which is both how a phone is
// usually held and the configuration a drive asserts against. The sink is
// built from oscillators, so nothing here loads or fetches a clip.
const game = mountGame({
  parent: "game",
  seed: nextSeed(),
  nextSeed,
  ...(params.has("mute") ? {} : { audio: createWebAudio() }),
});

// Dev only: poke the running sim from the console (`mazeosaur.scene.keys.board.sim`).
if (import.meta.env.DEV) (window as unknown as { mazeosaur: unknown }).mazeosaur = game;

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
