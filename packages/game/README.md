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
  that constructs a `Game`. Resumes a saved run via `src/resume.ts`'s
  `gameForRun()`, and autosaves at phase boundaries through
  `services(this).saves`. It also owns **the clock**: the sim has no
  timers, so the speed toggle and the pause menu are this scene choosing
  how often to call `tick()`, and a pause is it choosing not to. The
  menu's "Restart run" and "End run" abandon the run — written with
  `run: null` because nothing is left to resume, but not counted as
  finished;
  [the pause decision](../../docs/decisions/0004-pause-stops-the-clients-clock.md)
  says why.
- `src/resume.ts` — `gameForRun()`: reuses `MountOptions.resumed`
  (`LoadOutcome.resumed` from the shell's `loadSave`) instead of replaying
  the run a second time, falling back to `@mazeosaur/sim`'s `replay()` only
  when `resumed` is null. Pure and Phaser-free on purpose, so it is unit
  tested directly instead of through `BoardScene`, which cannot be
  constructed outside a running `Phaser.Game`.
- `src/profile.ts` — `runStarted` and `runFinished`, the `ProfileSave`
  accounting `flush()` calls on a fresh run and on a won/lost one. Pure and
  Phaser-free on purpose, so it is unit tested directly; the fossil award
  itself reads `content.rules.fossilWeights` rather than a number here.
- `src/layout.ts` — the logical canvas, the cell, the HUD boxes, the type
  scale and the 82px hit floor, plus `gridTop()`/`rowAt()`/`colAt()`. The
  one place those numbers are declared: `tools/art/layout.ts` re-exports
  this file through the package's `./layout` subpath, so the mock that
  generates [docs/01-art-hud-and-audio.md](../../docs/01-art-hud-and-audio.md)
  cannot disagree with what the client draws. Imports nothing, so it reads
  from Node with no Phaser.
- `src/audio.ts` — section 6's sound table (`SOUNDS`: `ms`, `ducks`,
  `minGapMs`) and `SfxBus`, the policy between a scene and `AudioPort`:
  the `hit`/`kill` cap, the round-robin across hues, and phase-to-music.
  Pure and Phaser-free, with the clock injected, so the limiter is unit
  tested without a browser and without waiting in real time. It names
  sounds and never fetches one; the thing that makes a noise is the
  shell's, injected as `AudioPort`.
- `src/sheet.ts` — what the dinosaur sheet says, as four strings: the
  genus, the family and stage, the comparable numbers, the modifiers. Pure
  and Phaser-free, exported through the package's `./sheet` subpath, so the
  client and the frame generator in `tools/art` build the same four lines
  rather than two copies. Four lines and not one is the design decision the
  file argues for; `tests/client/dino-sheet.spec.ts` measures all four of
  them for all 18 defs in a running client.
- `src/theme.ts` — colours and text styles, and nothing geometric.

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

`test/profile.test.ts` covers the pure accounting in `src/profile.ts`,
`test/resume.test.ts` covers the resume-vs-replay decision in
`src/resume.ts`, `test/audio.test.ts` covers the `hit`/`kill` cap in
`src/audio.ts` — a cap that silently stopped working would fail no other
test and would not look wrong in a screenshot, so it is asserted rather
than listened to — and `test/layout.test.ts` covers the HUD's
*constants*. Everything else here is Phaser: it is checked either by
driving it (`npm run dev`, then port 5173) or by a browser spec under
`tests/client`, which is the only thing that can see what the renderer
actually built — `hud-hit-targets.spec.ts` exists because
`test/layout.test.ts` was green for the whole period in which every
control on screen was under the 44pt floor, and nothing compared the two.
Three things have produced false conclusions:

- **Tap a tray card and check it did not also cancel.** Placement is two
  taps, and a tap on bare HUD clears the selection. The only thing
  keeping a tray card from doing both is the `ev.stopPropagation()` in
  `onTap()`, which suppresses the scene-level `pointerdown`. Drop it and
  every card tap selects and immediately deselects, which looks like a
  card that cannot be selected at all. Everything in the HUD that takes a
  pointer is wired through `onTap()` for exactly that reason.
- **Wait a frame before screenshotting after an input.** The renderer
  draws on the next animation frame, so a capture in the same instant
  shows the state before the click.
- **A console log can outlive a reload.** An error read after a fix may be
  the one from before it. Judge a fix by state and by the canvas still
  updating.
