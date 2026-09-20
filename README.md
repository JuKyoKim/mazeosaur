# Völundr

A single-player mazing tower defense in the Warcraft III maul tradition:
the towers are the walls, the player draws the maze, waves punish anyone
who leans on one tower type.

One codebase, three targets:

- **Web**: served from our own servers, with cloud saves and leaderboards
  on top of a game that is complete without them.
- **iOS and Android**: the same game, fully offline. No network code ships
  in the mobile binaries, and CI proves it.

Read [docs/00-proposal.md](docs/00-proposal.md) for what is being built,
why Phaser + Capacitor, and the milestone plan.

## Layout

```
packages/sim/       deterministic game simulation, no engine, no I/O
packages/content/   towers, creeps, waves, maps as validated data
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
npm run test:watch
```

Node 22 or newer. The simulation package has no dependencies and its
tests run in about 100 ms; keep it that way.

## Status

M0, scaffold. The simulation core exists and is tested: grid, eight-way
flow-field pathing without corner cutting, lane rules including the exact
"this tower would seal the maze" refusal, and a seeded RNG. Nothing
renders yet.
