import { mountGame } from "@mazeosaur/game";

// The shell decides the seed, and keeps deciding it: every run asks for a
// new one, play-again included. `?seed=123` pins the lot so a bug can be
// reproduced exactly; otherwise each run is fresh.
const params = new URLSearchParams(location.search);
const fromUrl = Number(params.get("seed"));
const pinned = Number.isFinite(fromUrl) && params.has("seed") ? fromUrl >>> 0 : null;
const nextSeed = () => pinned ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

const game = mountGame({ parent: "game", seed: nextSeed(), nextSeed });

// Dev only: poke the running sim from the console (`mazeosaur.scene.keys.board.sim`).
if (import.meta.env.DEV) (window as unknown as { mazeosaur: unknown }).mazeosaur = game;
