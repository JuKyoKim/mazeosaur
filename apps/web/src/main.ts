import { mountGame } from "@mazeosaur/game";

// The shell decides the seed. `?seed=123` pins a run so a bug can be
// reproduced exactly; otherwise every run is fresh.
const params = new URLSearchParams(location.search);
const fromUrl = Number(params.get("seed"));
const seed = Number.isFinite(fromUrl) && params.has("seed") ? fromUrl >>> 0 : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

const game = mountGame({ parent: "game", seed });

// Dev only: poke the running sim from the console (`mazeosaur.scene.keys.board.sim`).
if (import.meta.env.DEV) (window as unknown as { mazeosaur: unknown }).mazeosaur = game;
