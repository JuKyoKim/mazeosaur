import type Phaser from "phaser";
import type { BuildStamp, Game, ProfileSave, RunSave, SaveDocument } from "@mazeosaur/sim";

/**
 * Save storage. Writes only: the shell reads the file, runs `loadSave`,
 * and hands the result to `mountGame` before any scene exists, so the
 * game package never does storage I/O itself and never needs a `load()`.
 * `put` resolves or it throws a storage error — a quota hit, a private
 * browsing context that refuses storage — and that is the whole failure
 * model; there is no field here that can fail for a network reason.
 */
export interface SaveStore {
  put(doc: SaveDocument): Promise<void>;
  /** "Delete my data" in settings. */
  clear(): Promise<void>;
}

/**
 * Something that can make a noise. `available` is false when the device
 * or the player has audio off; a scene branches on this, never on
 * platform, so the mobile build has no special-cased silence.
 */
export interface AudioPort {
  readonly available: boolean;
  play(id: string, volume?: number): void;
  /** null stops the current track. */
  music(id: string | null): void;
  volumes(music: number, sfx: number): void;
}

/** Web only, and nobody passes one in v1. A type here is not a dependency. */
export interface NetPort {
  dailySeed(): Promise<{ seed: number; valleyId: string; contentVersion: string }>;
  syncProfile(local: ProfileSave): Promise<ProfileSave>;
  submitRun(run: RunSave): Promise<{ accepted: boolean; rank: number | null }>;
}

/** Everything the scenes get from the shell. Held in the Phaser registry. */
export interface PlatformServices {
  readonly saves: SaveStore;
  readonly audio: AudioPort;
  /**
   * Absent in v1 on every target, and absent on mobile forever. When it is
   * absent so is every feature behind it: no stub, no offline queue, no
   * retry.
   */
  readonly net?: NetPort;
}

export interface MountOptions {
  readonly parent: string | HTMLElement;
  /** The save, already read and migrated by the shell. */
  readonly save: SaveDocument;
  /**
   * `LoadOutcome.resumed` for that save: the `Game` the load's replay
   * already built, or null. Non-null exactly when `save.run` is non-null.
   * Consumed by the first `create()` of `board` and not reused.
   */
  readonly resumed: Game | null;
  readonly services: PlatformServices;
  /** This build's identity, stamped into every save the game writes. */
  readonly build: BuildStamp;
  /** Seed policy is the shell's: `?seed=` pins one, otherwise fresh per run. */
  nextSeed(): number;
}

export interface GameHandle {
  /** Flush unsaved progress now. The shell calls this when the OS is about to background the app. */
  suspend(): Promise<void>;
  destroy(): void;
  readonly phaser: Phaser.Game;
}

export interface CloudFeatures {
  readonly cloudSave: boolean;
  readonly leaderboard: boolean;
  readonly dailySeed: boolean;
}

/** All false when `net` is absent, which is always on mobile. The one function in this package that reads `services.net`. */
export function cloudFeatures(s: PlatformServices): CloudFeatures {
  const has = s.net !== undefined;
  return { cloudSave: has, leaderboard: has, dailySeed: has };
}

export const SERVICES_KEY = "services";

export function services(scene: Phaser.Scene): PlatformServices {
  return scene.registry.get(SERVICES_KEY) as PlatformServices;
}

/** A store for a shell with nowhere to write. `put` resolves and does nothing. */
export const NULL_SAVE_STORE: SaveStore = {
  put: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

/** A silent sink. The game is fully playable on mute, so no scene may wait on a real one. */
export const NULL_AUDIO_PORT: AudioPort = {
  available: false,
  play: () => {},
  music: () => {},
  volumes: () => {},
};
