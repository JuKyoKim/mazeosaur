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

- `src/index.ts` — `mountGame(opts)`, the only export a shell uses. It
  registers the three scenes and puts the injected services in the Phaser
  registry.
- `src/platform.ts` — the injected ports (section 2) and the one accessor
  that reads them back out of the registry.
- `src/TitleScene.ts` — the first screen: start, and a resume that stays
  dark until a shell injects save storage.
- `src/BoardScene.ts` — the board, the HUD and all input. The only scene
  that constructs a `Game`.
- `src/ResultsScene.ts` — how a run ended, and the seed that would run it
  again.
- `src/ui.ts` — the button primitive the three scenes share.
- `src/layout.ts` — the logical canvas and the HUD geometry, as numbers.
  `tools/art/layout.ts` re-exports this file, so the spec's sample frames
  cannot disagree with what the client draws.
- `src/theme.ts` — colours and text styles. Shared constants live here
  rather than on a scene.

That is the whole v1 package: `mountGame` starts `TitleScene`, the title
starts a run on the board, and the board hands a summary to the results
screen. Extend this list when a file lands; `npm run check` fails if it
does not match `src/`.

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

There are no tests here; the client is checked by driving it
(`npm run dev`, then port 5173). Three things have produced false
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
