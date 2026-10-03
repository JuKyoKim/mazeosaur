import type Phaser from "phaser";
import type { LoggedCommand } from "@mazeosaur/sim";
import type { AudioService } from "./audio.js";

/**
 * An interrupted run. The sim is deterministic, so (seed, command log) is
 * the whole of it: replaying the log lands on exactly the state the player
 * left behind.
 */
export interface ResumableRun {
  readonly seed: number;
  readonly log: readonly LoggedCommand[];
}

/**
 * Save storage, injected by the app shell — Capacitor's filesystem on
 * mobile, IndexedDB on web. The game package never imports a store, it
 * only asks this. Writing saves is the shell's job; until a shell injects
 * a service, `resumableRun()` is unavailable and the title screen keeps
 * Resume dark.
 */
export interface SaveService {
  /** The run in progress, or null when there is nothing to resume. */
  resumableRun(): ResumableRun | null;
}

/** Everything the scenes get from the shell. Held in the Phaser registry. */
export interface Services {
  /**
   * The seed for the next run. Seed policy belongs to the shell: the web
   * shell pins it from `?seed=` and otherwise draws a fresh one per run.
   */
  nextSeed(): number;
  saves: SaveService | null;
  /**
   * Something that can make a noise, or null. Null is a supported
   * configuration: the game is fully playable on mute, so no scene may
   * treat a missing sink as an error or wait on one.
   */
  audio: AudioService | null;
}

export const SERVICES_KEY = "services";

export function services(scene: Phaser.Scene): Services {
  return scene.registry.get(SERVICES_KEY) as Services;
}
