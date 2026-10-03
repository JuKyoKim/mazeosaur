import Phaser from "phaser";
import { BoardScene } from "./BoardScene.js";
import { ResultsScene } from "./ResultsScene.js";
import { TitleScene } from "./TitleScene.js";
import { SERVICES_KEY, type SaveService, type Services } from "./platform.js";
import { CANVAS_H, CANVAS_W, COLORS } from "./theme.js";

export interface MountOptions {
  /** element id or element to mount the canvas in */
  parent: string | HTMLElement;
  /** seed for the first run; the shell picks it (`?seed=` pins one) */
  seed: number;
  /**
   * Seed for every run after the first, asked for once per run. The shell
   * owns the policy: a pinned seed repeats, otherwise each run is fresh.
   * Defaults to repeating `seed`, so the game package never needs a
   * source of randomness of its own.
   */
  nextSeed?: () => number;
  /** Save storage. Without one the title screen's Resume stays dark. */
  saves?: SaveService;
}

/**
 * Mount the game. This is the only export the app shells use. Platform
 * services (saves, and on web only the network client) are passed in
 * here; the game package never imports them.
 */
export function mountGame(opts: MountOptions): Phaser.Game {
  const services: Services = {
    nextSeed: opts.nextSeed ?? (() => opts.seed),
    saves: opts.saves ?? null,
  };
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent,
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: COLORS.bg,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 2 },
    render: { antialias: true, pixelArt: false },
    // preBoot runs before the first scene, so the services are in the
    // registry by the time the title screen asks whether Resume is live.
    callbacks: { preBoot: (game) => game.registry.set(SERVICES_KEY, services) },
    scene: [TitleScene, BoardScene, ResultsScene],
  });
}

export { BoardScene } from "./BoardScene.js";
export { TitleScene } from "./TitleScene.js";
export { ResultsScene, type RunSummary } from "./ResultsScene.js";
export { type ResumableRun, type SaveService, type Services } from "./platform.js";
