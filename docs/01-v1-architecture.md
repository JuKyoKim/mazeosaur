# Mazeosaur v1 architecture

*Status: decided, 2026-10-03. This doc settles the contracts that more
than one branch of v1 work needs. [docs/00-proposal.md](00-proposal.md) is
still the design of record for what the game is; this is how the pieces
are shaped so they fit. Where the two disagree, this one is newer and
wins, and section 10 of the proposal records the change.*

The four things decided here are the four that two or more teams would
otherwise each invent: the save format, the ports the app shells inject,
how sim purity is enforced, and what a Phaser scene owns. Section 6 is
the review protocol, which is how all of it stays true.

**The deployment target is an input, not a detail.** The web build is served
as static files from a container with no application server behind it — a
commit-tagged GHCR image, pinned by a Komodo stack that lives in
`JuKyoKim/arbor`, on beelink. Two things in this doc follow from that and
would be different if a server existed: everything v1 persists is local to
the device (section 2), and a release is identified by a commit SHA, which
is why a save says which build wrote it (section 1.2).

## 1. The save format, v1

### 1.1 Where it lives

`packages/sim/src/save.ts`, exported from `@mazeosaur/sim`, with the
migration list beside it in `packages/sim/src/save-migrations.ts`.

The save format belongs in the pure package for three reasons. A save is
`(seed, content version, command log)` plus a profile, and the first three
of those are the sim's own vocabulary. Every consumer — the game package,
both shells, and `apps/server` — already depends on the sim, so nothing
gains a dependency. And putting it behind rule 1 means the save code
cannot quietly acquire a clock, a filesystem or a `Math.random`: reading
and writing bytes is the shell's job, through the port in section 2.

Validation is a hand-written narrowing function in the same file. The sim
takes no dependencies, so there is no schema validator here; the content
package's schema does not apply to saves.

### 1.2 The document

One JSON document per device. Everything below is exhaustive: a field not
listed is not in the format.

```ts
export const SAVE_FORMAT = "mazeosaur.save";

/** 1 + SAVE_MIGRATIONS.length. A test asserts that. */
export const SAVE_VERSION = 1;

export interface SaveDocument {
  /** Discriminator, so a stray JSON file is rejected rather than coerced. */
  readonly format: typeof SAVE_FORMAT;
  /** Save-format version. Integer, >= 1. Not the build version. */
  readonly version: number;
  /** The build that last wrote this document. Diagnostic; never an input. */
  readonly writtenBy: BuildStamp;
  readonly profile: ProfileSave;
  readonly settings: SettingsSave;
  /** The run in progress, or null when there is nothing to resume. */
  readonly run: RunSave | null;
}

export interface BuildStamp {
  /**
   * The commit the build was made from: 40 lowercase hex, or "dev" for a
   * build nobody stamped (`npm run dev`, a test, a local `npm run build`).
   */
  readonly commit: string;
  /** Which shell wrote it. */
  readonly platform: "web" | "ios" | "android" | "node";
}
```

**`writtenBy` identifies the release, because the release is a commit.**
The web target ships as a GHCR image tagged with the commit SHA that built
it (`.github/workflows/check.yml`, and the stack that pins it in
`JuKyoKim/arbor`), so "which build wrote this save" and "which artifact is
running on beelink" are the same string, and a bug report that quotes a
save says exactly what to check out. It is two fields and about sixty bytes
once per document; retrofitting it later means every save already in a
browser is from an unknown build forever.

Three rules keep it from becoming a correctness input:

- **The sim never reads it.** It is not in the hash, not in the replay, and
  not a reason to reject or drop anything. A save whose `writtenBy.commit`
  is unknown, older, newer or `"dev"` loads normally. Only `version` and
  `run.contentVersion` gate loading (sections 1.4 and 1.5).
- **The shell supplies it**, as `MountOptions.build` (section 2), for the
  same reason it supplies `nextSeed()`: reading an env var or a `define` is
  shell work, and neither the sim nor `packages/game` may do it.
- **It is stamped on write, not on read.** `loadSave` leaves the field
  alone, so between loading and the first save it still names the build
  that wrote the bytes — which is the one you want when the bytes look
  wrong. `freshSave(build)` takes the stamp for the same reason.

`RunSave.startedBy` carries the stamp the run *began* under, so a resume
that diverges tells you whether the build changed underneath it. That is
the first question to ask about a divergence and the save is the only place
the answer could have been recorded.

`profile` and `settings` are separate because they sync differently:
`profile` is the thing a signed-in web player wants on their other
device, and `settings` is about the device in their hand. Putting the
music volume inside the synced object means a phone's haptics preference
arrives on a desktop. M4 uploads `profile` and never `settings`.

```ts
export interface ProfileSave {
  /** Fossils ever earned. Monotonic; unlocks never subtract from it. */
  readonly fossilsEarned: number;
  /** Fossils spent on unlocks. The balance is earned - spent, derived, never stored. */
  readonly fossilsSpent: number;
  /** Unlocked dinosaur kinds as content kind ids, ascending, no duplicates. */
  readonly unlockedKinds: readonly string[];
  /** Best *finished* run per valley id. A valley with no finished run is absent. */
  readonly best: { readonly [valleyId: string]: BestRunSave };
  readonly runsStarted: number;
  readonly runsFinished: number;
}

export interface BestRunSave {
  /** How many migrations the run cleared. A win stores content.migrations.length. */
  readonly migrationsCleared: number;
  readonly eggsLeft: number;
  readonly fossils: number;
  /** The seed, so the run can be replayed or shared. */
  readonly seed: number;
  /** The content version it was played against, so the table can say so. */
  readonly contentVersion: string;
}

export interface SettingsSave {
  /** 0..100, integers. Integers because tests compare them for equality. */
  readonly musicVolume: number;
  readonly sfxVolume: number;
  /** The speed a migration starts at. */
  readonly speed: 1 | 2 | 3;
  /** Draw range rings on the selected dinosaur. */
  readonly showRanges: boolean;
  /** Haptics on placement. Mobile only; the web shell ignores it. */
  readonly haptics: boolean;
}

export interface RunSave {
  /** Valley id from @mazeosaur/content. */
  readonly valleyId: string;
  /** The sim seed. Unsigned 32-bit integer; `Rng` takes exactly this. */
  readonly seed: number;
  /** content.version when the run *started*. Exact match required to resume. */
  readonly contentVersion: string;
  /** The build the run started under. Diagnostic only; a resume on a different build is allowed. */
  readonly startedBy: BuildStamp;
  /** Every accepted command, ascending by tick. This is also the replay. */
  readonly log: readonly LoggedCommand[];
  /** The tick reached when this was written. >= the last log entry's tick. */
  readonly tick: number;
  /** Game.hash() after replaying to `tick`. An integrity check, not a secret. */
  readonly hash: number;
  /**
   * Milliseconds of wall clock the run has taken, for the results screen.
   * The shell accumulates it; it is never an input to the sim, and the
   * sim never reads it. It is the only field here that touches a clock.
   */
  readonly playedMs: number;
}
```

`fossilsEarned` and `fossilsSpent` are stored instead of a balance so the
invariant is checkable: a balance that drifts is a bug you cannot see,
while `earned - spent < 0` is one you can assert. The fossil *formula*
(eggs kept, migrations cleared, meat unspent) is balance, so it is a
weight table in `@mazeosaur/content`, not a number in the sim or here —
rule 4. The save stores only the awarded total.

**`Command` is part of the save format.** `LoggedCommand` is the sim's own
type, used directly. Adding a new `Command` variant is backward
compatible, because no existing save contains it. Changing or removing one
is not, and needs a version bump and a migration entry.

### 1.3 Replaying a run, exactly

`tick()` increments `state.tick` at the top, so after N calls
`state.tick === N`, and `apply()` stamps a command with the value of
`state.tick` at the moment it was accepted. The replay that follows from
that is the only correct one:

```ts
export function replay(content: Content, run: RunSave): Game;
```

```
g = new Game(content, run.seed)        // g.state.tick === 0
i = 0
forever:
  while i < run.log.length and run.log[i].tick === g.state.tick:
     refusal = g.apply(run.log[i].command)
     if refusal !== null: diverged
     i = i + 1
  if g.state.tick === run.tick: break
  g.tick()
require i === run.log.length
require g.hash() === run.hash
```

Two assertions carry the weight. **A refusal during replay is a
divergence**, never something to skip: the log holds only commands the sim
already accepted, so a refusal means the content, the sim or the file
changed underneath it. And the hash must match. Both failures drop the run
(section 1.5) rather than resuming into a state nobody can explain.

`Game.hash()` folds `defId.length` rather than the id itself, so two
definitions with equal-length ids are indistinguishable in it. That is
good enough for "did my own replay land where I left it", and not good
enough for M4's replay verification against a player who wants to cheat.
Before M4 the hash must fold the id bytes. Changing it is not a save
migration — `run.hash` is written fresh on every save — but it is a
server/client version coupling, so it lands in one commit with the server.

### 1.4 Versions and migrations

```ts
// packages/sim/src/save-migrations.ts

export interface SaveMigration {
  /** The version this entry produces. Entry at index n produces version n + 2. */
  readonly to: number;
  /** Why the format changed. One line; it is the changelog. */
  readonly because: string;
  /** Rewrite a document at version `to - 1` into one at version `to`. */
  readonly up: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Numbered, append-only, ascending by `to`. Never edit a landed entry:
 * somebody's phone holds a save that already went through it.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  // Version 1 is the first format. There is nothing to migrate from.
];
```

`SAVE_VERSION === 1 + SAVE_MIGRATIONS.length`, asserted by a test. That
turns the review item "a save-format change bumps the version and adds a
migration entry" into a build failure: you cannot bump one without the
other.

Loading:

```ts
export type LoadFailure = "not-a-save" | "from-the-future" | "corrupt";
export type RunDropReason = "content-version" | "replay-diverged";

export type LoadOutcome =
  | {
      readonly ok: true;
      readonly doc: SaveDocument;
      /** The version it arrived as, when migrations ran. */
      readonly migratedFrom: number | null;
      readonly runDropped: RunDropReason | null;
      /**
       * The `Game` the validating replay already built, at `doc.run.tick`.
       * Null exactly when `doc.run` is null — no run, or one dropped.
       */
      readonly resumed: Game | null;
    }
  | { readonly ok: false; readonly reason: LoadFailure };

export function loadSave(
  raw: unknown,
  content: Content,
  platform: BuildStamp["platform"],
): LoadOutcome;
export function freshSave(build: BuildStamp): SaveDocument;
```

- `version < SAVE_VERSION`: run every entry with `to > version` in
  ascending order, then validate the result.
- `version === SAVE_VERSION`: validate.
- `version > SAVE_VERSION`: `from-the-future`. **The shell must not
  overwrite the file.** A newer build wrote it — the player downgraded, or
  a sync landed ahead of this binary — and clobbering it loses real
  progress. Play from `freshSave()` in memory, tell the player the save
  was written by a newer version, and leave the bytes alone.
- A missing or malformed `writtenBy` or `run.startedBy` is **repaired, not
  rejected**: substitute `{ commit: "unknown", platform }`, the third
  argument. It is a diagnostic, and losing a player's run because the
  diagnostic is unreadable would be the worse bug. It is the only field in
  the format with that treatment, because it is the only one nothing
  depends on.
- Missing `format`, or a `version` that is not a positive integer:
  `not-a-save`. Anything else that fails validation: `corrupt`. In both
  cases the shell moves the file aside to one backup slot
  (`save.corrupt.json`, overwritten each time — one is a diagnostic,
  twenty is a leak) and starts from `freshSave()`.

**Why `platform` is a parameter.** The repair above needs the platform now
running, and `loadSave` cannot work it out: the sim is one compiled package
on every target, so neither `raw` nor `content` names the shell that called
it, and nothing in the sim may ask the environment (rule 1, section 4).
Only the shell knows, and it already has the value — it is
`MountOptions.build.platform`, computed once per section 2.2. So it is
passed, as the narrowest thing that satisfies the repair:
`BuildStamp["platform"]`, not the whole stamp. Passing the stamp would let
a future edit copy the *commit* of the running build onto a document that
some other build wrote, which is exactly the lie `writtenBy` exists to
prevent; `"unknown"` is the honest answer and it is hardcoded here.

**Why the outcome carries a `Game`.** `loadSave` replays the run to check
the hash (section 1.3), so by the time it returns it is holding a live
`Game` at `doc.run.tick` — and then, before `resumed` existed, dropped it.
The scene could not ask for another one later, because section 2 forbids an
`await` in `create()` and the document carries no live object, so it
replayed the same log a second time. That is not free: a full scripted run
is 29,232 ticks, and `packages/content/test/balance.test.ts` simulates one
in 452 ms on a dev box — scripted player included, so a bare replay is
somewhat under that, and a phone WebView is several times over it. Either
way a late-game resume pays it twice, on the main thread, before the first
frame. Returning the object that already exists removes one of the two
replays without putting I/O or an `await` anywhere.

Three rules keep that from becoming a second source of truth:

- **`resumed` is non-null exactly when `doc.run` is non-null.** A dropped
  run (section 1.5) nulls both, in the same assignment. Consumers branch on
  one of them and get the other for free.
- **It is the replay's own object, not a copy.** `resumed.hash() ===
  doc.run.hash` and `resumed.state.tick === doc.run.tick` hold on return,
  because the hash check that proved them *is* what produced it.
- **It is consumed once.** A `Game` is mutable, and play mutates it. The
  holder uses it for one `create()` and then lets it go — see section 5.2,
  which says what `scene.restart()` must do instead of reusing it.

### 1.5 When the content version no longer matches

Compare `run.contentVersion` with `content.version` using `===`.

If they differ, **the profile and settings are kept and the run is
dropped**: `run` becomes null and `runDropped` is `"content-version"`. The
title screen says the last season was played on an older valley and
offers a fresh run on the same seed. Fossils and unlocks are not affected;
they do not depend on content.

The reason is that the log is not self-contained. Replaying it needs the
hp and bounty curves, the costs and the migration schedule it was played
against, so honouring an old run means shipping every content version
forever. Pinning historical content is the only way to do better and it is
explicitly out of scope for v1 (section 7).

That rule only costs the player something if `content.version` changes
when nothing they can feel changed. So:

> **`content.version` bumps when, and only when, a number the sim reads
> changes.** New art, copy, sound ids and HUD layout do not bump it.

Left as a convention that is a trap. Make it mechanical, in
`packages/content/test/version.test.ts`: hash the sim-visible subset of
the content (dinos, invaders, migrations, rules, valley — canonically
serialised) and assert the pair `{ version, digest }` against a
checked-in literal. Editing a cost then fails the test until the version
is bumped in the same commit, which is exactly the commit where somebody
should be thinking about whose run it ends. Cosmetic edits never touch the
digest and never fail.

#### The difficulty is in the version string

There is no single `content.version` any more. `@mazeosaur/content`
exports `contentFor(difficulty)`, which returns one of three complete
`Content` values, and each carries its own version: `m3.0-easy`,
`m3.0-medium`, `m3.0-hard`. The generation prefix follows the rule above —
it bumps when a sim-visible number changes — and the suffix is the
difficulty the numbers belong to.

That is deliberate, and it is what makes difficulty safe to resume. A run
is `(seed, content, command log)`; difficulty is not a fourth input, it is
*which content*. So the only thing that could silently change a resumed
run's difficulty is a shell handing `loadSave` the wrong one — and because
the difficulty is in the string the `===` above already compares, that run
is **dropped** with `runDropped: "content-version"` instead of replaying
at numbers the player never played. The guarantee is in the format, not in
the shell remembering.

Today that version check is the *whole* of the protection, not a backstop.
`RunSave` has no difficulty field, so a shell resuming a run has nothing to
read and has to guess which `Content` to hand in; the `===` is what catches
it guessing wrong. Giving the save its own `difficulty` field — so the
shell can know rather than guess, and the version check goes back to being
the second line of defence — is [ARB-220](/ARB/issues/ARB-220), which bumps
`SAVE_VERSION` and appends the first migration entry. Nothing above this
paragraph waits on it.

### 1.6 Size, measured

A full run of the scripted player in `packages/content/test/balance.test.ts`
— 46 migrations before it loses, at seed 1 — logs **408 commands** over
29,232 ticks and serialises to **24.8 KB** of `RunSave`. Across five seeds
the spread was 4 bytes.

The scripted player is deliberately dull. A person who mazes properly
places several hundred dinosaurs, grows most of them twice, and juggles,
so budget for roughly ten times the commands:

| part | budget | note |
| --- | --- | --- |
| `profile` + `settings` | 8 KiB | grows with valleys and unlocks, not with play |
| `run` | 512 KiB | ~20x the measured full scripted run |
| whole document | 1 MiB | the cap `apps/server` accepts on a sync or a submission |

The budget is a CI assertion, not a runtime limit. `packages/content`
asserts that a full scripted run stays under 64 KiB, which is 2.5x the
measured number and leaves room for content growth. **At runtime there is
no cap**: refusing to save a long run because it is long would be a worse
bug than a large file, and an IndexedDB origin quota is hundreds of
megabytes.

The log is stored as plain objects rather than packed tuples. A readable
replay is worth a lot while the sim is young and divergence is the bug
class to fear, 24.8 KB is nothing in either store, and a packed encoding
is a pure function of this one — so if real play ever blows the budget,
version 2 is a mechanical migration with no information lost.

### 1.7 Where the bytes go, and when

| target | store | key |
| --- | --- | --- |
| web | IndexedDB, database `mazeosaur`, object store `save` | `"default"` |
| mobile | Capacitor Filesystem, `Directory.Data` | `save.json`, UTF-8 |

IndexedDB rather than `localStorage`: the quota is per-origin and large
rather than 5 MB, writes are a real transaction instead of a synchronous
string assignment, and Safari evicts it less eagerly.

Writes are atomic. One IndexedDB transaction already is; on mobile, write
`save.json.tmp` and rename over `save.json`.

The game package decides *when* to save, because the sim's phase
transitions are the natural save points, and the shell decides when to
*flush*, because only the shell hears the OS:

- end of a build phase (the migration is about to start)
- a migration cleared
- a run won or lost (writes `profile.best`, sets `run` to null)
- a settings change
- `GameHandle.suspend()` — see section 2

At most one write every 2 seconds, coalesced. Nothing in the sim and
nothing on a timer inside the sim: a 20 Hz write loop is the wrong shape,
and `suspend()` covers the gap that a phase-boundary-only policy would
leave mid-migration.

## 2. The platform-service ports

The shells inject; `packages/game` never imports a store, an audio
backend or a network client. All of the following belongs in
`packages/game/src/platform.ts`.

```ts
/** Save storage. Writes only — see below for why there is no load(). */
export interface SaveStore {
  put(doc: SaveDocument): Promise<void>;
  /** "Delete my data" in settings. */
  clear(): Promise<void>;
}

export interface AudioPort {
  /** False when the device or the player has audio off; scenes branch on this, never on platform. */
  readonly available: boolean;
  play(id: string, volume?: number): void;
  /** null stops the current track. */
  music(id: string | null): void;
  volumes(music: number, sfx: number): void;
}

/** Web only, and nobody passes one in v1. Section 3: a type is not a dependency. */
export interface NetPort {
  dailySeed(): Promise<{ seed: number; valleyId: string; contentVersion: string }>;
  syncProfile(local: ProfileSave): Promise<ProfileSave>;
  submitRun(run: RunSave): Promise<{ accepted: boolean; rank: number | null }>;
}

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
   * Consumed by the first `create()` of `board` and not reused — see
   * sections 1.4 and 5.2.
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

export function mountGame(opts: MountOptions): GameHandle;
```

Five things in that shape are deliberate.

**`SaveStore` is local on every target, including web.** The web build
ships as static files out of a Caddy container with no application server
behind it — `apps/web/Dockerfile`, pinned by tag on beelink — so in v1
there is nowhere for a save to go but the browser. The port is therefore
specified against a local store and nothing in it may assume a backend
appears later: no `userId`, no `etag`, no `lastSyncedAt`, no "pending
upload" flag, no method that can fail for a network reason. `put` resolves
or it throws a storage error, and that is the whole failure model.

M4's cloud save, if it happens, is `NetPort.syncProfile` — a second,
clearly-named port over the *profile*, called by the shell, which is why
`SaveStore` does not need a seam for it. A store that half-anticipates a
server is the shape that gets stuck: every scene learns to handle a
staleness that cannot occur, and the handling is never exercised.

The practical consequence for v1: **`services.net` is absent on every
target, web included.** There is no server to talk to until `apps/server`
exists. `cloudFeatures()` returns all false everywhere, and the three
features behind it are not built. `NetPort` is written down here so the
boundary is decided before anyone needs it, not because v1 calls it.

**`SaveStore` has no `load()`.** The shell reads the file, runs
`loadSave`, and hands the document to `mountGame`. Phaser's `create()` is
synchronous; an `await` in it means a frame drawn against a
half-initialised scene, which is the bug the "wait a frame before
screenshotting" note in `CLAUDE.md` exists to tell apart from a real one.
With the save preloaded, the title screen can light Resume on the first
frame and no scene does I/O.

It hands over `resumed` with it, for the same reason. A document is data
and a `Game` is not, so a scene that is given only the document has to
rebuild the `Game` by replaying the log — a second full replay of the one
`loadSave` just did, 452 ms of blocked main thread at full run length
(section 1.4). The field does not weaken the no-`load()` rule: it carries
no I/O, no promise and nothing the shell computed itself, only the object
the sim produced one call earlier. The shell passes through
`LoadOutcome.resumed` unchanged, or `null` after `freshSave()`.

**`nextSeed()` is injected** rather than computed. The game package has no
source of randomness, for the same reason the sim does not: the shell owns
`Math.random`, so pinning a seed stays a shell concern and the game stays
a function of its inputs.

**Audio is a port, not Phaser's sound manager.** iOS Safari needs a user
gesture before WebAudio will make a sound, and that gesture belongs to the
shell; a mobile build may later want a native plugin. Scenes call
`audio.play("place")` and know nothing else. `available` exists so a scene
never writes `if (isMobile)`.

**Exactly one function in `packages/game` reads `services.net`:**

```ts
export interface CloudFeatures {
  readonly cloudSave: boolean;
  readonly leaderboard: boolean;
  readonly dailySeed: boolean;
}

/** All false when `net` is absent, which is always on mobile. */
export function cloudFeatures(s: PlatformServices): CloudFeatures;
```

Scenes read booleans from that. The mobile build therefore has one
unreachable branch rather than thirty scattered `if (services.net)`
checks, and "what does mobile not do" is answerable by reading one
function.

### 2.2 Where the commit SHA comes from

`BuildStamp.commit` has to arrive at the shell without the game or the sim
reading its environment, and without a build that is not from CI pretending
to be one.

- `apps/web/vite.config.ts` declares `define: { __BUILD_COMMIT__:
  JSON.stringify(process.env.BUILD_COMMIT ?? "dev") }`. A local `npm run
  dev` or `npm run build` has no such variable and stamps `"dev"`, which is
  honest: that build is not reproducible from a tag.
- `apps/web/Dockerfile` takes `ARG BUILD_COMMIT` and passes it into the
  build step as that env var.
- `.github/workflows/check.yml` already tags the image
  `ghcr.io/jukyokim/mazeosaur:${{ github.sha }}`; the same `github.sha`
  goes in as a build arg, so the tag on the registry and the string inside
  every save written by that image are the same forty characters by
  construction rather than by discipline.
- `apps/web/src/main.ts` passes `{ commit: __BUILD_COMMIT__, platform:
  "web" }` as `MountOptions.build`. Mobile does the same in M3 with its own
  platform and the same variable from the Capacitor build.

That is a three-file change in the web build, which release owns, not the
architecture; it is written down here so the string means one thing.

## 3. Mobile has no network: making the proof exact

A grep for `fetch(` over a minified bundle is not a proof. It has to be
told about Phaser's XHR loader, and once a check has an exception list the
exception list is what grows. Four layers replace it, each exact about a
different thing.

**Layer 1 — the module graph, for our code.** The mobile build asserts on
Rollup's own module list, not on the text of the output. A plugin in
`apps/mobile`'s Vite config reads `chunk.modules` in `generateBundle` and
fails if any module id resolves inside `packages/net` or
`@mazeosaur/net`. That is exact because it is the actual set of modules
emitted, enumerated by the bundler. `apps/mobile/package.json` also does
not depend on `@mazeosaur/net`, which is necessary but not sufficient on
its own: npm workspaces hoist, so a deep relative import would still
resolve.

**Layer 2 — the source, before the bundle.** `no-restricted-imports` over
`packages/game/src/**` and `apps/mobile/**` rejects `@mazeosaur/net` and
any path under a `net/` directory. This landed with section 4 and fails
on the line rather than on the artifact. `NetPort` in `platform.ts` is an
`interface`, which emits nothing, so declaring the shape the web shell
passes in costs the mobile bundle zero bytes and no module.

**Layer 3 — third-party code, by allowlist instead of by grep.** The
remaining network-capable code is somebody else's — Phaser's loader
today, whatever gets added later. The mobile build asserts that the set of
non-workspace modules in its bundle equals a checked-in
`apps/mobile/vendor-allowlist.json`. A new dependency cannot enter the
mobile bundle without a line in that file, in a pull request, with a
reviewer. That converts "did a grep find a string" into "did a person
approve this vendor module", which is the question that actually matters.

**Layer 4 — remove the capability at runtime.** Before importing the game,
the mobile entry point replaces `globalThis.fetch`, `WebSocket`,
`EventSource` and `navigator.sendBeacon` with functions that throw, and
wraps `XMLHttpRequest.prototype.open` so it throws unless the URL is
same-origin — relative, or the app's own `capacitor://localhost`. XHR is
wrapped rather than removed because Phaser legitimately uses it to load
bundled assets off the app's own origin, and that is a local read with no
socket. This is the layer that makes the claim *true* rather than merely
checked: if something ever does try to phone home, it crashes loudly in
QA instead of succeeding quietly in the field.

The existing bundle grep in `.github/workflows/check.yml` stays as a cheap
smoke test. It is now one of five and no longer the argument.

Layers 1, 3 and 4 are M3 work, landing with `apps/mobile`, and belong to
release. Layer 2 is live now.

## 4. Sim purity, mechanically

Rule 1 was a convention enforced by review. It is now `npm run lint`, and
`npm run check` runs it first, so it fails locally and on CI — the workflow
runs `npm run check`, and `scripts/lint.mjs` installs its own toolchain on
first use, so no workflow change was needed to make the gate real.

An explicit `npm ci --prefix tools/lint` plus `npm run lint` step in
`.github/workflows/check.yml` is still worth having, for a cached install
and an honest timing split rather than for the gate. It needs a token with
`workflow` scope, which this branch did not have; it is release's to land.

The rules are in `tools/lint/rules.js` and each one says which repo rule it
serves.

Inside `packages/sim/src/**` and `packages/content/src/**`:

- **`Math.random`** — a run is a function of its seed. Use the injected `Rng`.
- **Inexact `Math`**: `sin cos tan asin acos atan atan2 sinh cosh tanh
  asinh acosh atanh pow exp expm1 log log1p log2 log10 cbrt hypot`, and
  the `**` operator. IEEE-754 pins `+ - * / sqrt` and the integer helpers
  exactly, so every engine agrees on them forever; it says nothing about
  the transcendentals, and V8, JavaScriptCore and the Android WebView have
  differed in the last bits. One differing bit in a damage number is a
  diverged replay. `floor ceil round trunc abs min max sqrt sign imul
  clz32` stay allowed because they are exact.
- **Impure globals**: `Date performance setTimeout setInterval
  setImmediate queueMicrotask requestAnimationFrame window document
  navigator location localStorage sessionStorage indexedDB crypto process
  fetch XMLHttpRequest WebSocket EventSource`.
- **Imports**: `phaser`, `@mazeosaur/game`, `@mazeosaur/net`, and node
  builtins.

`@mazeosaur/content` is held to the same bar because the sim reads its
numbers: a curve computed with `Math.pow` in content diverges a replay
exactly as one in the sim would. `hpCurve` already iterates instead, which
is why adding the rule cost nothing.

**The known gap.** These rules match by name. `Math["ran" + "dom"]`, or
aliasing a banned global through a parameter, walks past them. That is
review's job, and the sim is small enough for review to do it. The rules
catch what people actually type.

**The same move, for READMEs.** A README is a claim about what is in a
directory, and nothing was checking it: the three this document rewrote had
been wrong since M1, and the first draft of the rewrite was wrong the other
way, listing four files that are specified here and not written yet.
`npm run check:readmes` makes the claim checked. Under each
`## What is in here` heading, every `src/…` or `test/…` path in the bullets
must exist, and every file in that package's `src/` must appear in the
bullets — so a described-but-absent file and an added-but-undescribed file
both fail the gate. Only those bullets are read. Prose after the list may
name a file that is coming, which is the honest way to describe a contract
before it lands, and it is why `docs/` is exempt entirely: a design
document's job is to name files that do not exist yet. Relative markdown
links are checked everywhere, this document included, because a dead link
is wrong in either kind of file.

**Why the linter has its own TypeScript.** `typescript-eslint` refuses to
load against TypeScript 7 ([typescript-eslint#10940]) and the repo is on
7.0.2. Holding the compiler back for a linter is the wrong trade, so the
lint toolchain lives in `tools/lint` with its own TypeScript 6 — the
side-by-side arrangement the TypeScript 7 release notes describe.
`scripts/lint.mjs` installs it on first use, so a fresh clone still needs
only one `npm install`, and `eslint.config.js` at the root imports the
rules from there so the file globs stay repo-relative. When upstream
supports TypeScript 7, delete `tools/lint/package.json`'s pinned
`typescript`, move the two dependencies to the root, and the wrapper
becomes `eslint .`.

[typescript-eslint#10940]: https://github.com/typescript-eslint/typescript-eslint/issues/10940

## 5. The scene-graph contract

### 5.1 The scenes in v1

Three, keyed `title`, `board`, `results`.

| scene | owns | does not own |
| --- | --- | --- |
| `title` | the menu, Resume, settings, seed entry on web | any `Game` |
| `board` | **the** `Game` instance, the grid, input, the HUD, the autosave policy | any rule; it asks the `Game` and draws the answer |
| `results` | the end-of-run summary and the fossil award | the `Game`; it receives plain data through `init()` |

`board` draws its own HUD rather than running a fourth `hud` scene. A
separate scene buys a second camera v1 has no use for and costs a
cross-scene event bus that has to be kept in sync with the sim's state —
two moving parts to pay for a layering problem v1 does not have. Revisit
when the HUD needs to survive a board transition.

Exactly one scene constructs a `Game`. `results` takes a `RunSummary` of
plain numbers, so a finished run cannot be resurrected by a screen that
is only meant to describe it.

### 5.2 The restart rule

Phaser scenes are singletons per key. `scene.restart()` and
`scene.start()` re-run `create()` on the *same* object, and the display
objects from the previous run have been destroyed. So:

> **An instance field of a scene is declared, not initialised. It gets its
> first value in `init()` or `create()`, which run on every start.**

A field initialised at its declaration is assigned once ever, at
construction. On the second run it still holds the first run's value, and
if that value is a display object the next draw throws and the canvas
freezes. That happened once already — commit `1ae3419`.

This is the gap-free form of the rule, and it is deliberately stricter
than the bug requires. Before this doc, `BoardScene` had thirteen
initialised fields that were harmless *because* `create()` happened to
reset every one of them — which is precisely how the fourteenth gets
forgotten. One assignment site, no judgement call.

**A resume is start-shaped, not instance-shaped.** `MountOptions.save.run`
and `MountOptions.resumed` describe the *first* `create()` of `board` and
nothing after it. `scene.restart()` is "again (same seed)" in section 5.3 —
a fresh `Game` on `runSeed` — so the second `create()` must not read either
one again. A field that still holds the mount's run on the second pass
resurrects the run that just ended every time Play again is pressed, and
once `resumed` exists it hands back a `Game` that run already played to
its end.

The shape that gets this right is **consume once**: `create()` reads the
resume and clears it in the same block, so the restart path falls through
to the fresh-run branch by construction rather than by a flag somebody has
to remember to check. `BoardScene` does this with `initialDoc`. It is the
same rule as the one above — the second `create()` sees only what
`create()` assigned — applied to the values that come from the mount
rather than from the scene.

`no-restricted-syntax` enforces the declaration rule over
`packages/game/src/**/*Scene.ts`.
Static fields are exempt: they are per class, not per run. Anything that
wants to be a shared constant belongs in `theme.ts`.

The linter cannot check the other half — that `create()` assigns every
declared field — because TypeScript's `!` is exactly the promise that it
does. A headless scene harness that runs `create()` twice and asserts no
field still points at a destroyed object is the mechanical version, and
it belongs with the client smoke harness on `maze-qa/client-smoke-harness`.
Until then that half is a review item.

### 5.3 Transitions

```
title ──start / resume──▶ board ──won / lost──▶ results ──▶ title
                            ▲                                 │
                            └──────── again (same seed) ──────┘
```

`board` asks `nextSeed()` for a fresh run and takes the seed from
`save.run` for a resume. Nothing holds a reference to a scene it is not
currently in.

## 6. The review protocol

### 6.0 Who merges

**The architect merges ordinary Mazeosaur pull requests.** Scenes, sprites,
sim refactors, content edits, tests, CI, docs: one review against the bar in
6.3, and it lands. The board settled this when it accepted the proposal on
2026-10-03; it is not a proposal and does not need re-asking per pull
request.

**The owner stays the gate for four things**, and they are about reach, not
about code quality: the homelab, spend, store credentials, and anything that
becomes visible on the public internet. A pull request that touches one of
those does not merge on an architect's review no matter how good the diff
is — see 6.4. The test is not "is this change risky", it is "does landing
this put something outside the repo", because a review can establish that
code is correct and cannot establish that somebody agreed to pay for it or
to publish it.

Nobody merges their own pull request, the architect included: an architect
change goes to whoever else is competent to read it, and a disagreement that
survives three rounds goes to Odin.

### 6.1 Branches and commits

- Branch from `origin/main` as `<author>/<short-slug>`. Never commit to
  `main`.
- Small commits whose messages say **why**, not what. The diff says what.
- Every commit message ends with exactly
  `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.
- `npm run check` passes before the pull request opens.

### 6.2 What a pull request body must contain

1. The issue it closes.
2. What changed, in a sentence per concern.
3. **What you verified, and how.** Not "tested locally". A test that fails
   without the change. A screenshot of the state, taken a frame after the
   input. A number before and the number after. A command output pasted
   in. The claim has to be verified by the thing it claims, not by the
   thing being merely present.
4. A line for each of the five rules the change touches, saying how it
   stays true.
5. An explicit note if it touches `.github/workflows`, the save format, or
   anything in the proposal's section 9.

### 6.3 The bar

Approve only when all of these hold, and say in the review which ones
were actually checked:

- `npm run check` passes and the sim tests are still under a second.
- Nothing new in `packages/sim` touches the DOM, a timer, `Math.random` or
  an inexact `Math` function. The linter now answers most of this; the
  review answers the name-matching gap in section 4.
- No number that belongs in `@mazeosaur/content` is hardcoded in the sim.
- Nothing the mobile build includes can reach the network.
- A save-format change bumps `SAVE_VERSION` and appends a migration entry.
- A new scene field is declared, not initialised, and `create()` assigns it.
- A document describes what the branch contains, not what it will contain
  once another branch merges. `npm run check:readmes` answers this for the
  file lists; the review answers it for the prose.
- The verification in the PR body is of the kind described in 6.2.3.

Request changes with the specific line and the specific rule. "Looks fine"
is not a review; a review that finds real problems and says so is a
successful one. After three rounds of disagreement on the same point, it
goes to Odin.

### 6.4 What does not get decided in a pull request

The owner's gate from 6.0, spelled out, plus the product choices that were
never the architect's. Everything here goes to Odin with a recommendation;
none of it lands on an architect's approval, however clean the diff is.

| it needs | because |
| --- | --- |
| a container deploy, Komodo, DNS, a certificate, a reverse proxy | homelab hands; Odin routes it to Platform or Edge |
| spend, store credentials, signing keys, provisioning profiles | board decision; never improvise, never commit one |
| anything public-facing — a domain, a store listing, a leaderboard that shows names | board decision |
| a choice the proposal's section 9 lists as open, where the answer changes the product | board decision; put it to Odin with a recommendation rather than deciding it quietly |

Game feel, art direction and balance taste are the designer's. The
architect reviews them for determinism and schema fit, not for taste.

## 7. What v1 does not include

Named so nobody builds them on spec:

- **Pinned historical content.** Resuming a run across a content version
  change. Section 1.5 drops the run instead.
- **A packed command log.** Section 1.6 measured the verbose one and it
  fits.
- **Multiple concurrent runs** or save slots. One `run` field, one device.
- **A server of any kind.** The web target is static files from a container
  (section 2). `apps/server`, `packages/net` and everything behind `NetPort`
  — accounts, cloud save, the leaderboard, the daily seed — are M4, and the
  game is complete without them.
- **Conflict resolution for cloud save.** M4 syncs `profile` only, and
  last-write-wins on a monotonic `fossilsEarned` is enough for it. An
  in-progress run never leaves the device in v1.
- **A `hud` scene.** Section 5.1.
- **Audio.** The port is specified so the art and UX pass can target it;
  there is no backend behind it yet.
