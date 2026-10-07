import Phaser from "phaser";
import { BoardScene } from "./BoardScene.js";
import { ResultsScene } from "./ResultsScene.js";
import { FRESH, RESUME } from "./entry.js";
import { CANVAS_H, CANVAS_W } from "./layout.js";
import { COLORS } from "./theme.js";
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
    // Empty, and the scenes are added below instead. Phaser auto-starts
    // the first scene in this list with no data channel — `settings.data`
    // for a config auto-start is `{}` — and §5.3 requires every entry into
    // `board` to carry its mode, the mount's first one included. So the
    // list stays empty and `add()` does the registering, because that is
    // the overload that takes the data.
    scene: [],
  });

  // `results` first, so it is registered before anything can hand it a
  // `RunSummary`, and idle until something does: `autoStart` is false.
  phaser.scene.add("results", new ResultsScene());
  // §5.3: the mount is an entry into `board` like any other, so it says
  // which way it is. Either there is a run to resume or there is not — the
  // shell has already dropped an unresumable one (§1.5), so that is the
  // whole of the question here. `add()` carries the data through both of
  // Phaser's paths: pre-boot it is held and injected into `settings.data`
  // when the scene is created, and post-boot (a game whose boot already
  // finished synchronously) it is assigned before the start. Either way
  // `init()` sees it.
  //
  // §5.1's third scene, `title`, takes this slot when it lands: it becomes
  // the scene the mount starts, with `FRESH`/`RESUME` becoming its
  // decision to make and to pass on. `board` does not change to acquire
  // that caller, which is what the mode being data buys.
  phaser.scene.add("board", scene, true, opts.save.run ? RESUME : FRESH);

  return {
    phaser,
    destroy: () => phaser.destroy(true),
    suspend: () => scene.flush(),
  };
}

export { BoardScene } from "./BoardScene.js";
export { ResultsScene } from "./ResultsScene.js";
// §5.3's entry contract. Exported because the callers of `board` are not
// all in this package: the client harness drives the transitions a finger
// cannot reach, and `title` will be the third producer.
export { FRESH, RESUME, again, boardEntry, type BoardEntry } from "./entry.js";
export { packFrom, runSummary, type PackEntry, type RunSummary } from "./summary.js";
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
// Section 6's sound table, for the shell's sink. The table is the game
// package's because every target must get the same lengths and the same
// ducking rules out of it; the thing that turns a name into a noise is the
// shell's, and it is injected (rule 2).
export {
  MUSIC_CROSSFADE_MS,
  SOUNDS,
  SfxBus,
  type Ducks,
  type MusicLayer,
  type SoundId,
  type SoundSpec,
} from "./audio.js";
