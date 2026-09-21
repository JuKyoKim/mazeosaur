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
- `npm run dev` serves the web prototype; `.claude/launch.json` has the
  same server for the in-app browser preview.
- This repo deploys separately from arbor. Nothing here touches the fleet
  until `apps/web` and `apps/server` exist (M1 and M4).
- Decisions go in `docs/00-proposal.md` section 10 with a date, or in a
  new numbered doc when they outgrow a line.
