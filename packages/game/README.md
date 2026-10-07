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
  says why. `showResults()` is the single place the
  `board ──won / lost / abandoned──▶ results` transition is written. All
  three outcomes go through it, the menu's `endRun()` included: a run the
  player quits ends on the same screen a won or lost one does, and differs
  only in what that screen says and in what the run was paid. Which run a
  later `create()` plays comes from `src/entry.ts`'s mode, and from nothing
  else.
- `src/entry.ts` — `BoardEntry`: the three ways into `board` (`FRESH`,
  `RESUME`, `again(seed)`) and `boardEntry()`, which narrows what Phaser
  handed `init()` and throws on anything else. Section 5.3's contract — the
  entry intent is data on the transition — so `fresh` and `again` never read
  the document's run and no caller has to clear it first to avoid resuming
  by accident. Imports nothing, exported through the package's `./entry`
  subpath, so the client harness and `title` narrow against the same code
  the scene does.
- `src/ResultsScene.ts` — the end-of-run screen (section 9 of
  [docs/01-art-hud-and-audio.md](../../docs/01-art-hud-and-audio.md)): the
  headline, the four statistics, the pack row, and "Again". It owns no
  `Game`; everything it draws arrives through `init()` as a `RunSummary`,
  so the screen that describes a finished run cannot resurrect it.
- `src/summary.ts` — `RunSummary` and the `runSummary()`/`packFrom()` that
  build it. Pure and Phaser-free, so what the results screen is *told* is
  unit tested while what it draws stays a browser spec. The fossil figure
  is *handed in*, not computed: section 5.4 pays the run in `BoardScene`,
  so `runSummary()` has no access to `fossilWeights` and a second award
  calculation is a type error rather than a thing to remember.
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
- `src/row1.ts` — the two authored strings in the HUD's vitals row:
  `MIGRATION_LABEL` and `migrationCounter`. Pure and Phaser-free, exported
  through the package's `./row1` subpath, so the client and the frame
  generator draw the same characters. They are here rather than inline at
  two call sites because section 4 of
  [docs/01-art-hud-and-audio.md](../../docs/01-art-hud-and-audio.md) sets
  Send's origin from the label's measured width, and `test/layout.test.ts`
  holds both to the character count that width was taken at — the one guard
  on that table needing neither a font nor a browser.
- `src/sheet.ts` — what the dinosaur sheet says, as four strings: the
  genus, the family and stage, the comparable numbers, the modifiers. Pure
  and Phaser-free, exported through the package's `./sheet` subpath, so the
  client and the frame generator in `tools/art` build the same four lines
  rather than two copies. Four lines and not one is the design decision the
  file argues for; `tests/client/dino-sheet.spec.ts` measures all four of
  them for all 18 defs in a running client.
- `src/atlas.ts` — the toy-box art's load path: `loadToyBox()`, which
  queues all three atlases in one call, the `ATLAS` texture keys,
  `TOY_BOX_SCALE` and the `STRIKE_FRAMES` table. The PNGs are imported as
  `?url` so the bundler emits them content-hashed under `/assets/`, and the
  JSON is imported by value and handed straight to Phaser's loader; nothing
  is copied into `apps/web/public/`, which `sw.js` would not cache.
  [Decision 0005](../../docs/decisions/0005-atlases-reach-the-client-through-the-bundler.md)
  is why. `TOY_BOX_SCALE` is read off the atlas's own `meta` rather than
  retyped, which is what makes section 5.5's two traps survivable: a strike
  frame is two authored squares wide, and the denominator is still the
  authored 64. `test/atlas.test.ts` pins the geometry and both directions
  of the frame table.
- `src/assets.d.ts` — the ambient `*.png?url` module. This package sets
  `"types": []` and so cannot take this from `vite/client`; `src/atlas.ts`
  pulls the file in with a triple-slash reference, which is what makes one
  declaration serve the `packages/game`, `apps/web` and `tests/client`
  typechecks rather than only the first.
- `src/theme.ts` — colours and text styles, and nothing geometric.

`mountGame` registers `board` and `results` and starts the first of them;
the save the shell already loaded and migrated goes to `BoardScene`, and a
shell with nowhere to write injects `NULL_SAVE_STORE`. One more file is
specified and not yet written — `src/TitleScene.ts`, the third v1 screen
(section 5), owned by [ARB-217](/ARB/issues/ARB-217) — plus `src/ui.ts`,
the button primitive the screens would share. Write them against the doc
rather than against this list, and extend this list when they land.

§5.3's `results ──▶ title` exit is not built, because `title` is not: it
lands with the scene it targets, and section 9's element table specifies
one control on the results screen, not two.

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
