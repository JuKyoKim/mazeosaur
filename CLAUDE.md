# mazeosaur: orientation for a fresh agent

Read [README.md](README.md), then [docs/00-proposal.md](docs/00-proposal.md).
This file carries only what an agent needs before it knows where to look.

## The rules that are not obvious from the code

1. **`packages/sim` is pure.** No DOM, no Phaser, no timers, no I/O, no
   `Math.random`, no `Math.sin`/`pow`/`exp`. Every gameplay outcome is a
   function of (seed, content, command log). If you need randomness, use
   the `Rng` that is passed in. If you need a curve, use a lookup table.
   Breaking this silently breaks replays, saves and server verification.
2. **Mobile has no network. None.** `apps/mobile` must never depend on the
   network package, and `packages/game` must never import it either; the
   web shell injects it. Do not add analytics, crash reporting, remote
   config or an update check to anything the mobile build includes. CI
   will fail the bundle if it references `fetch`, `XMLHttpRequest`,
   `WebSocket`, `EventSource` or `sendBeacon`.
3. **The server is additive.** Anything the game needs to be playable
   lives on the client. The server verifies and syncs; it never owns.
4. **Content is data.** Dinosaur, invader, wave and map changes are data
   edits validated by schema. Do not hardcode a number in the sim that
   belongs in content.
5. **No franchise IP.** The theme is dinosaurs: real genus names, original
   art. The mechanical reference is Pokemon Maul; nothing from Pokemon
   (names, sprites, the type chart) and nothing invented by Jurassic Park
   (venom-spitting Dilophosaurus, the raptor-pack-hunts-humans framing)
   may appear. When in doubt, use the paleontology, not the movie.

## Vocabulary

Towers are **dinosaurs** (a **kind** is a tower line; stages are
hatchling, juvenile, adult; upgrading is **growing**). Creeps are
**invaders**; a wave is a **migration**. Gold is **meat**. Lives are
**eggs**. The exit is the **nest**. Code uses these words too.

## Working here

- `npm run check` is the gate. Keep sim tests under a second.
- **A scratch checkout needs its own real `npm install`.** A copied or
  symlinked `node_modules` loses `apps/web/node_modules`, so
  `tsc -p apps/web` silently resolves the root's hoisted `vite@8` instead
  of the `vite@7` that `apps/web` pins. A typecheck from a hand-assembled
  checkout is not evidence about the code, red or green. Why both vites
  exist: section 10 of `docs/00-proposal.md`.
- CI is `docs/02-ci.md`: every step, how to run it locally, and why agents
  propose workflow changes but cannot push them.
- `npm run dev` serves the web prototype; `.claude/launch.json` has the
  same server for the in-app browser preview.
- This repo deploys separately from arbor. Nothing here touches the fleet
  until `apps/web` and `apps/server` exist (M1 and M4).
- Decisions go in `docs/00-proposal.md` section 10 with a date, or in a
  new numbered doc when they outgrow a line.
- **Session history does not live here.** After-action reports and
  findings go to the Obsidian vault (`ai/aar/`). This repo keeps only
  what is durably true, as a comment beside the code it explains or a
  line in the docs, never as a dated aside.

## Hiring another agent

You may hire, but only for a role the project will need for the long
term: a stream of work that keeps arriving, that no current agent
covers, and that would otherwise sit unowned. Before hiring, check that
no existing agent can take it on.

Do not hire for something short-lived: a one-off task, a burst of extra
work, or anything the current team finishes in time. Queue that work
with an existing agent instead, even if it lands later. Every agent
draws on the same Claude subscription as the owner and the fleet's own
agents, so an idle hire costs the whole board.

When you do hire, say on the issue why the role is long-term and which
work it owns, so the owner can check the reasoning later.

## Verifying the client

The sim is tested; the client is not, so it is checked by driving it.
Two things that produced false conclusions once:

- **Drive drags at speed.** A fast pointer skips cells between move
  events. Placement interpolates the line between events for that
  reason; a change that drops the interpolation will pass a slow drag
  and fail a real finger.
- **Wait a frame before screenshotting after an input.** The renderer
  draws on the next animation frame; a capture in the same instant shows
  the state before the click and looks like a bug that is not there.
- **The in-app browser's console log survives reloads.** An error read
  after a fix may be the one from before it. Judge a fix by state and
  by the canvas still updating, or reopen the pane for a clean log.
- **A frozen canvas with a Phaser renderer error means a destroyed
  display object is still referenced.** `scene.restart()` re-runs
  `create()` on the same instance; every field that holds a display
  object or per-run state is reset there, and any new one must be too.
