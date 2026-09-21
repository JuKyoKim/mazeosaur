import Phaser from "phaser";
import { BoardScene } from "./BoardScene.js";
import { CANVAS_H, CANVAS_W, COLORS } from "./theme.js";

export interface MountOptions {
  /** element id or element to mount the canvas in */
  parent: string | HTMLElement;
  /** run seed; the shell picks it (a date for daily runs, a random for free play) */
  seed: number;
}

/**
 * Mount the game. This is the only export the app shells use. Platform
 * services (saves, and on web only the network client) will be passed in
 * here; the game package never imports them.
 */
export function mountGame(opts: MountOptions): Phaser.Game {
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
    scene: [new BoardScene(opts.seed)],
  });
}

export { BoardScene } from "./BoardScene.js";
