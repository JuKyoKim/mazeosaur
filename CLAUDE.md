# volundr: orientation for a fresh agent

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
4. **Content is data.** Tower, creep, wave and map changes are JSON edits
   validated by schema. Do not hardcode a number in the sim that belongs
   in content.
5. **No Nintendo IP.** The reference is Pokemon Maul's *mechanics*. No
   Pokemon names, sprites, or the Pokemon type chart.

## Working here

- `npm run check` is the gate. Keep sim tests under a second.
- This repo deploys separately from arbor. Nothing here touches the fleet
  until `apps/web` and `apps/server` exist (M1 and M4).
- Decisions go in `docs/00-proposal.md` section 10 with a date, or in a
  new numbered doc when they outgrow a line.
