# Mazeosaur

A single-player mazing tower defense in the Warcraft III maul tradition,
with dinosaurs. Your pack guards the nesting grounds; migrations of rival
dinosaurs stampede toward the nest; the maze you build with your own
dinosaurs is most of the skill. Kills pay meat, meat grows hatchlings
into adults, every leak eats an egg.

One codebase, three targets:

- **Web**: served from our own servers, with cloud saves and leaderboards
  on top of a game that is complete without them.
- **iOS and Android**: the same game, fully offline. No network code ships
  in the mobile binaries, and CI proves it.

Read [docs/00-proposal.md](docs/00-proposal.md) for what is being built,
why Phaser + Capacitor, the v1 design, and the milestone plan.

## Layout

```
packages/sim/       deterministic game simulation, no engine, no I/O
packages/content/   dinosaurs, invaders, waves, maps as validated data
packages/game/      Phaser client
apps/web/           Vite site + web-only network client
apps/mobile/        Capacitor shell for iOS and Android
apps/server/        web-only API: saves, leaderboards, replay verification
docs/               proposals and decisions, numbered
```

## Working on it

```bash
npm install
npm run check      # typecheck + tests; the merge gate
npm run dev        # the web prototype on http://localhost:5173
```

Node 22 or newer. The simulation package has no dependencies and its
tests run in well under a second; keep it that way.

## Status

M1 prototype is playable in a browser (`npm run dev`, then open it on a
phone over the LAN to feel the mazing). One valley, three kinds with three
growth stages, ten migrations, meat, eggs, build timer with early-send
bonus, drag-to-paint walls, grow and sell. Placeholder shapes, no audio.
The sim is fully tested; the client is verified by hand so far.
