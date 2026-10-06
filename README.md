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
why Phaser + Capacitor, the v1 design, and the milestone plan. Then
[docs/01-v1-architecture.md](docs/01-v1-architecture.md) for the contracts
v1 is built against: the save format, the ports the app shells inject,
the scene-graph contract, and how pull requests are reviewed here, and
[docs/01-art-hud-and-audio.md](docs/01-art-hud-and-audio.md) for the HUD
layout, the sprite manifest, the audio list and how the first migration
teaches mazing.

## Layout

```
packages/sim/       deterministic game simulation, no engine, no I/O
packages/content/   dinosaurs, invaders, waves, maps as validated data
packages/game/      Phaser client
apps/web/           Vite site + web-only network client
apps/mobile/        Capacitor shell for iOS and Android
apps/server/        web-only API: saves, leaderboards, replay verification
tests/client/       Playwright specs that drive the real client in a browser
docs/               proposals and design documents, numbered
docs/decisions/     one decision per file, NNNN-slug.md
```

## Working on it

```bash
npm install
npm run check      # lint + typecheck + tests; the merge gate
npm run lint       # the sim-purity and scene-restart rules on their own
npm run dev        # the web prototype on http://localhost:5173
npm run test:client  # drive the real client in a headless browser
```

Node 22 or newer. The simulation package has no dependencies and its
tests run in well under a second; keep it that way.

`npm run test:client` is the one gate `npm run check` does not include:
it boots a browser and a dev server, so it belongs outside the
under-a-second budget. It needs `npx playwright install chromium` once.
It starts its own dev server and never reuses one it finds, because a
server already on the port is serving *some* checkout and that is
routinely not the one under test; set `MAZEOSAUR_CLIENT_PORT` to run it
while another worktree holds 5173.

`npm run lint` is where the repo's rules stop being conventions: no
clock, no timers, no DOM, no `Math.random` and no inexact `Math` inside
`packages/sim`, no network import anywhere a mobile build can reach, and
no initialised scene field. It installs its own toolchain into
`tools/lint` the first time it runs, because it needs a TypeScript the
rest of the repo must not see — `tools/lint/package.json` says why.

## Status

Playable in a browser (`npm run dev`, then open it on a phone over the
LAN to feel the mazing). One valley, all six kinds with three growth
stages, the kind chart, eight invader archetypes plus bosses, fifty
migrations, meat, eggs, build timer with early-send bonus, tap-to-place
walls, grow and sell. Placeholder shapes, no audio. The sim is fully
tested and a scripted player in the balance harness must survive at
least 35 migrations; the client is verified by hand.
