# @mazeosaur/game

The Phaser client: rendering, input, HUD, audio. It owns no game rules. It
sends commands to `@mazeosaur/sim` and draws whatever state comes back,
interpolating between the sim's 20 Hz ticks and the display's frame rate.

Both `apps/web` and `apps/mobile` mount this package unchanged. Platform
differences — save storage, audio, and on web only the network client —
are injected at mount through the ports in `src/platform.ts` and are never
imported here. That injection point is what lets the mobile shell prove it
has no network code.

## What is in here

- `src/index.ts` — `mountGame(opts)`, the only export a shell uses.
- `src/platform.ts` — the ports the shell injects, and the registry
  accessor the scenes read them through.
- `src/BoardScene.ts` — the board, the HUD and all input. The only scene
  that constructs a `Game`.
- `src/TitleScene.ts`, `src/ResultsScene.ts` — the other two v1 screens.
- `src/theme.ts` — canvas size, colours, text styles. Shared constants
  live here rather than on a scene.
- `src/ui.ts` — the button primitive.

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
