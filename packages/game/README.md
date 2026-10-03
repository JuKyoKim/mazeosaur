# @mazeosaur/game

The Phaser client: rendering, input, HUD, audio. It owns no game rules. It
sends commands to `@mazeosaur/sim` and draws whatever state comes back,
interpolating between the sim's 20 Hz ticks and the display's frame rate.

Both `apps/web` and `apps/mobile` mount this package unchanged. Platform
differences — save storage, audio, and a network client no shell passes
yet — are injected at mount and are never imported here. That injection
point is what lets the mobile shell prove it has no network code. The
ports themselves are section 2 of
[docs/01-v1-architecture.md](../../docs/01-v1-architecture.md).

## What is in here

- `src/index.ts` — `mountGame(opts)`, the only export a shell uses.
- `src/platform.ts` — the injected ports (`SaveStore`, `AudioPort`,
  `NetPort`), `PlatformServices`, `MountOptions`, `GameHandle` and the
  registry accessor, per section 2 of
  [docs/01-v1-architecture.md](../../docs/01-v1-architecture.md).
- `src/BoardScene.ts` — the board, the HUD and all input. The only scene
  that constructs a `Game`. Resumes a saved run by calling `@mazeosaur/sim`'s
  `replay()`, and autosaves at phase boundaries through `services(this).saves`.
- `src/profile.ts` — `runStarted` and `runFinished`, the `ProfileSave`
  accounting `flush()` calls on a fresh run and on a won/lost one. Pure and
  Phaser-free on purpose, so it is unit tested directly; the fossil award
  itself reads `content.rules.fossilWeights` rather than a number here.
- `src/theme.ts` — canvas size, colours, text styles. Shared constants
  live here rather than on a scene.

`mountGame` starts `BoardScene` with the save the shell already loaded
and migrated, and a shell with nowhere to write injects `NULL_SAVE_STORE`.
Two more files are specified and not yet written —
`src/TitleScene.ts` and `src/ResultsScene.ts` (the other two v1 screens,
section 5) — plus `src/ui.ts`, the button primitive they share. Write them
against the doc rather than against this list, and extend this list when
they land.

## The one rule that bites

Phaser scenes are singletons per key, so `scene.restart()` and
`scene.start()` re-run `create()` on the *same* object, with the previous
run's display objects already destroyed. Therefore:

> **An instance field of a scene is declared, not initialised.** It gets
> its first value in `init()` or `create()`, which run on every start.

A value set at the declaration is assigned once ever, so on the second run
the field still holds the first run's — a destroyed object, a renderer
error, and a frozen canvas. That happened once already, in commit
`1ae3419`. `npm run lint` enforces the declaration half; that `create()`
assigns every declared field is still a review item.

The full scene-graph contract — which scenes exist, what each owns, and
the transitions between them — is section 5 of
[docs/01-v1-architecture.md](../../docs/01-v1-architecture.md).

## Verifying a change

`test/profile.test.ts` covers the pure accounting in `src/profile.ts`.
Everything else here is Phaser and has no tests; it is checked by driving
it (`npm run dev`, then port 5173). Three things have produced false
conclusions:

- **Drive drags at speed.** A fast pointer skips cells between move
  events, which is why placement interpolates the line between them. A
  change that drops the interpolation passes a slow drag and fails a real
  finger.
- **Wait a frame before screenshotting after an input.** The renderer
  draws on the next animation frame, so a capture in the same instant
  shows the state before the click.
- **A console log can outlive a reload.** An error read after a fix may be
  the one from before it. Judge a fix by state and by the canvas still
  updating.
