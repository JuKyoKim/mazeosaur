import Phaser from "phaser";
import { BoardScene } from "./BoardScene.js";
import { CANVAS_H, CANVAS_W, COLORS } from "./theme.js";
import { SERVICES_KEY, type GameHandle, type MountOptions } from "./platform.js";

/**
 * Mount the game. This is the only export the app shells use. Platform
 * services (saves, and on web only the network client) are passed in
 * here; the game package never imports an implementation of them.
 */
export function mountGame(opts: MountOptions): GameHandle {
  const scene = new BoardScene(opts.save, opts.resumed, opts.nextSeed, opts.build);
  const phaser = new Phaser.Game({
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
    // preBoot runs before the first scene's create(), so the services are
    // in the registry by the time anything asks for them.
    callbacks: { preBoot: (game) => game.registry.set(SERVICES_KEY, opts.services) },
    scene: [scene],
  });

  return {
    phaser,
    destroy: () => phaser.destroy(true),
    suspend: () => scene.flush(),
  };
}

export { BoardScene } from "./BoardScene.js";
export {
  cloudFeatures,
  services,
  NULL_AUDIO_PORT,
  NULL_SAVE_STORE,
  SERVICES_KEY,
  type AudioPort,
  type CloudFeatures,
  type GameHandle,
  type MountOptions,
  type NetPort,
  type PlatformServices,
  type SaveStore,
} from "./platform.js";
