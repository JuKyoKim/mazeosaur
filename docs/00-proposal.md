# Mazeosaur: build proposal

*Status: proposal, 2026-09-20. Theme decided (dinosaurs). Engine and
architecture proposed; see section 9 for what is still open.*

A single-player mazing tower defense in the Warcraft III "maul" tradition
(Pokemon Maul, Wintermaul, Burbenog): the towers **are** the walls, the
player draws the maze, and the maze is most of the skill. One codebase,
three targets: browser (served from our own servers), iOS and Android
(no network, ever).

**The fantasy.** Your pack of dinosaurs guards the nesting grounds. Every
season, migrations of rival dinosaurs stampede through the valley toward
the nest. Your pack hunts them as they wind through the maze you build.
Kills feed the pack; **meat** buys new hatchlings and grows them into
juveniles and adults. Every invader that reaches the nest eats an **egg**.
Lose all twenty and the season is over.

The name is a portmanteau; the App Store, Google Play and the open web
were checked for collisions and none were found. Every
dinosaur is a real genus; genus names are scientific and free to use.
Nothing borrows from Jurassic Park's inventions (no venom-spitting
Dilophosaurus, no "clever girl") or from any Pokemon name, sprite or type
chart.

## 1. What the game is

The loop, per run:

1. An empty valley. A spawn, one or more **checkpoints**, the nest.
   Invaders must visit them in order, so a good maze makes them cross the
   valley several times.
2. A **build phase**: spend meat on hatchlings, place them on the grid.
   Every placement is checked so the maze can never be sealed. Send the
   migration early for a bonus, or let the timer run out.
3. A **migration** (wave): invaders walk the shortest open path. Your
   dinosaurs attack anything in reach. Each leak eats an egg. Kills pay
   meat.
4. Grow dinosaurs in place (hatchling, juvenile, adult), sell and rebuild
   to reshape the maze, repeat for ~50 migrations. Eggs at zero is defeat;
   migration 50 cleared is a win.

What makes it *this* genre rather than Kingdom Rush:

- **The path is the player's, not the map's.** Pathing recomputes on every
  build and sell. Invaders re-route mid-wave.
- **Waves punish a one-dinosaur strategy.** Pterosaur migrations fly over
  the maze entirely; armored waves shrug off splash; a six-way kind chart
  means each migration has dinosaurs that hurt it and dinosaurs that
  don't. "Utilizing specific towers" is the second half of the skill.
- **Meat is tight.** Bounties, wave bonuses and sell refunds are the whole
  economy. Every hatchling placed as a wall is meat not spent on damage.

## 2. The two requirements that shape everything

| requirement | consequence |
| --- | --- |
| Mobile plays with **no network in any form** | The game must be complete on-device: rules, content, saves, progression. The server cannot own anything the game needs. |
| Web plays **off our servers** | The web build is the same game plus optional server features (cloud save, leaderboards). The server is *additive*, never *required*. |

So the architecture is **local-first, server-optional**. The single most
important design rule that follows: the game simulation is a pure,
deterministic library with no I/O. It runs identically in a phone
WebView, in a browser tab, and headless on a server verifying a replay.

## 3. Engine recommendation: Phaser 3 + Capacitor, in TypeScript

| option | web | iOS/Android | offline by construction | fit for us |
| --- | --- | --- | --- | --- |
| **Phaser 3 + Capacitor** (recommended) | first-class, ~1 MB | WebView shell with bundled assets | yes | One language end to end; the sim runs on the server too; deploys as a static site like every other homelab stack. |
| Godot 4 (GDScript or C#) | export, 30 MB+ wasm, historically fragile on iOS Safari | native exports, good | yes | Real editor, better for particle-heavy visuals. Web is the weakest target and it is our primary one. |
| Defold (Lua) | small web builds | native, good | yes | Solid and small; smaller ecosystem, Lua only, no sim sharing with a TS server. |
| Unity | poor on mobile browsers | excellent | yes | Heavy, licensing churn, web is an afterthought. |
| Flutter + Flame (Dart) | acceptable | excellent | yes | Fine choice; Dart is a second language for everything else we run. |

Why Phaser + Capacitor wins for this project specifically:

- **The web target is not an export, it is the native home.** Everything
  else on that list treats the browser as a secondary output.
- **One language, one sim.** The simulation package is plain TypeScript
  with no engine dependency. The server re-runs it to verify leaderboard
  submissions. A Godot sim could not do that without a second
  implementation.
- **Offline is the default, not a setting.** Capacitor packages the built
  web bundle into the app. Nothing is fetched at runtime unless code asks
  for it, and the mobile app will not contain that code (section 6).
- **It matches the existing toolchain**: Vite, vitest, Docker, one
  container behind cloudflared on beelink. No new build farm.
- **Grid TD does not need an editor.** The content is tables (dinosaurs,
  invaders, waves, maps). A scene editor would be idle.

Known costs, and the mitigation for each:

- *Performance ceiling.* WebGL 2D on a modern phone comfortably handles
  the target (up to ~300 live invaders, ~250 towers, a few hundred
  attack effects). Object pooling, sprite batching, and a fixed sim tick
  keep it there. A profiling gate runs on a mid-range Android before M3
  ends.
- *WebView variance.* iOS uses WKWebView (Safari's engine); Android uses
  the system WebView, updated through Play. Both are current-generation
  browsers. We test on the oldest OS we ship to (proposal: iOS 16+,
  Android 10+).
- *No engine-level scene tooling.* Accepted; see above.

Runner-up if visuals ever outgrow this: Godot 4 for the mobile builds,
keeping the sim and web as they are. The sim/renderer split (section 4)
is what keeps that door open.

## 4. Architecture

```
            commands (build, sell, grow, send migration)
   input ─────────────────────────────────────────────▶ ┌──────────────────┐
                                                        │  @mazeosaur/sim  │  pure TS
   render ◀──────────────────────────────────────────── │  fixed 20 Hz     │  no DOM, no I/O
            state snapshot (plain data), events         │  seeded RNG      │  no Math.random
                                                        └──────────────────┘
                     ▲                                          ▲
        @mazeosaur/game (Phaser)                        @mazeosaur/content (data)
        draws state, interpolates between ticks         dinosaurs, invaders, waves, maps
                     ▲                                  schema-validated at build
        ┌────────────┴─────────────┐
   apps/web                   apps/mobile
   Vite static bundle         Capacitor iOS + Android
   + @mazeosaur/net           (no net package at all)
        │
   apps/server (web only): cloud save, leaderboards, replay verification
```

### 4.1 The simulation (`@mazeosaur/sim`)

- **Fixed tick, 20 Hz** (WC3 ran its game loop at a similar rate). The
  renderer runs at the display's rate and interpolates. Game speed 1x/2x/3x
  is just more ticks per frame.
- **Deterministic by construction.** Seeded PRNG (already in the repo).
  Integer math for anything that accumulates: positions in 1/1000ths of a
  cell, distances in integer step costs, damage as integers. No
  `Math.sin`/`Math.pow` in the sim; lookup tables where needed.
  IEEE-754 `+ - * / sqrt` are exact across engines, transcendental
  functions are not.
- **Commands in, state out.** The only way to change the game is a command
  with a tick number. A run is fully described by `(seed, content version,
  command log)`, which is a few KB. That is the save file *and* the replay
  *and* the anti-cheat.
- **Pathing is a flow field**, one per lane leg, recomputed on every build
  or sell (sub-millisecond on a 20x28 grid). Invaders carry no path; each
  tick they step to the lowest-distance neighbour. Re-routing when the
  maze changes is free. Eight directions, no corner cutting, so two
  dinosaurs touching at a corner form a wall exactly as in WC3. **Already
  implemented and tested** in `packages/sim/src/flowfield.ts` and
  `lane.ts`, including the exact "would this placement seal the maze"
  check.

### 4.2 Content as data (`@mazeosaur/content`)

Dinosaurs, invaders, waves, the kind chart and maps live in data
validated by a schema at build time. Balance changes are data changes. A
headless **balance harness** runs thousands of seeded games against
scripted mazes and reports leak rates per wave, so "wave 23 is a wall" is
a number in CI, not a Reddit thread.

### 4.3 The client (`@mazeosaur/game`)

Phaser 3 scenes for board, HUD, dinosaur sheet, migration preview,
results. It holds no rules. Platform services (save storage, and on web
only the network client) are injected at startup by the app shell, never
imported by the game package. That injection point is what lets the
mobile shell prove it has no network code.

### 4.4 Saves and progression

One versioned JSON save format, identical on every platform: profile
(fossils earned, unlocks, settings), and an in-progress run as `(seed,
command log)` so a phone can be closed mid-wave and resumed exactly.
Migrations of the save format are a numbered list. Mobile stores it
through Capacitor's filesystem API; web stores it in IndexedDB and, when
signed in, syncs it.

## 5. Game design, v1 scope

Enough to answer "is this fun on a phone", not the whole vision.

**Board.** Portrait. A 20-wide by 28-tall build grid fits a phone with the
HUD below. Spawn top, nest bottom, two checkpoints on alternating sides so
the natural maze is a long S. One valley for v1; the map format supports
terrain cells (rock, water) that can never be built on.

**Dinosaurs (towers).** 1x1 cells (touch-friendly; a 2x2 WC3 footprint on
a phone makes gaps too fiddly to place, and drag-to-paint gives the same
"wall fast" feel). Six **kinds**, each a line of three growth stages
grown in place. Each stage is a real genus, so growing is also a small
collection:

| kind | hatchling → juvenile → adult | role |
| --- | --- | --- |
| Raptor | Velociraptor → Deinonychus → Utahraptor | fast single-target, leaps at fliers, cheapest wall |
| Tyrant | Tarbosaurus → Daspletosaurus → Tyrannosaurus | heavy single-target bite, shreds armor |
| Armored | Nodosaurus → Euoplocephalus → Ankylosaurus | tail-club splash damage |
| Horned | Protoceratops → Styracosaurus → Triceratops | charge: stops the target cold for a moment |
| Longneck | Diplodocus → Brachiosaurus → Argentinosaurus | stomp: slows everything in range, long range |
| Flier | Rhamphorhynchus → Pteranodon → Quetzalcoatlus | the anti-air line; dives on two targets |

**The kind chart.** The six kinds form one cycle. Each kind does double
damage to the next and half to the previous:

```
Tyrant ▶ Longneck ▶ Horned ▶ Raptor ▶ Flier ▶ Armored ▶ Tyrant
```

Six facts, learnable in one run, and no line carries alone. Only Raptor
and Flier dinosaurs can attack flying invaders.

**Invaders (creeps).** Every invader has a kind (the same six) and an
archetype: normal, fast (ornithomimids), tank (armored), flying
(pterosaurs, ignore the maze, straight line spawn to nest), swarm
(compsognathids, many and weak), splitter (dies into two), regenerator,
shielded (first N hits do nothing). A boss every tenth migration:
Giganotosaurus, Argentinosaurus, Spinosaurus, Quetzalcoatlus, and a
final one to be designed.

**Economy.** Starting meat; a bounty per kill; a wave-clear bonus; an
early-send bonus that scales with the seconds left on the build timer.
Selling refunds 80% during a build phase and 60% during a wave. No
interest, no passive income: v1 rewards hunting, not banking. Growing a
dinosaur costs roughly 1.5x the previous stage.

**Eggs (lives).** 20. A leak eats 1, a boss leak eats 5.

**Wave flow.** Build phase with a 30-second timer and a "send now"
button. Waves do not overlap in v1. Fifty migrations, the next one
visible ahead of time with its kind and archetype, so the player can
prepare the right dinosaurs.

**Juggling** (selling and rebuilding to bounce invaders back and forth)
is allowed in v1. The block check keeps it honest and the 60% in-wave
refund makes it cost something. It is a classic maul skill and the flow
field makes it work exactly as in WC3. Easy to restrict later by locking
cells within N of an invader during a wave.

**Controls.** Tap a cell with a dinosaur selected to place it; drag to
paint the cheapest hatchling along a line; tap a dinosaur for its sheet
(grow, sell, range, stats); long-press to sell; pinch to zoom; free undo
of the last placement during a build phase. Web adds hotkeys and mouse
hover ranges.

**Meta.** Fossils per run (eggs kept, migrations cleared, meat unspent)
unlock kinds and, later, packs (curated rosters like Pokemon Maul's
starter choice), an endless mode, and a daily seeded run that the web
build can put on a leaderboard.

## 6. Platform contracts

### Mobile: no network, provably

- `apps/mobile` does not depend on `@mazeosaur/net`. The game package
  cannot import it either; the network client is injected by the web
  shell only.
- CI builds the mobile bundle and **fails if the output references**
  `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or
  `navigator.sendBeacon`. Phaser's own loader uses XHR for assets, so the
  mobile build loads assets from a preloaded manifest embedded at build
  time instead, and the check is exact rather than a grep with exceptions.
- No analytics, no crash reporter, no ads, no remote config, no update
  prompts. Capacitor's `server.url` is unset, `allowNavigation` is empty.
  The iOS app declares no network entitlements it does not need.
- Every asset ships in the binary. Target size under 40 MB.

### Web: served from our servers, works without them

- Static bundle, one container behind cloudflared on beelink, deployed by
  the same Komodo path as every other stack. A service worker makes it a
  PWA so a dropped connection mid-run changes nothing.
- `apps/server` (Hono on Node, Postgres): anonymous device identity first,
  accounts later if wanted; cloud save; daily-seed leaderboard; replay
  verification by re-running the sim on the submitted command log and
  comparing the final state hash. The client's claimed score is never
  trusted.

### Store submission

Capacitor generates the Xcode and Android Studio projects; they are
checked in. Signing keys, provisioning profiles and store credentials
live outside the repo. TestFlight and Play's internal track are the M3
exit criteria.

## 7. Repository layout

```
mazeosaur/
  docs/               proposals and design decisions, numbered
  packages/sim/       the deterministic simulation (started, tested)
  packages/content/   game data + schemas
  packages/game/      Phaser client
  apps/web/           Vite site + net client
  apps/mobile/        Capacitor iOS/Android shell
  apps/server/        web-only API
```

npm workspaces, TypeScript strict, vitest. `npm run check` is the gate.

## 8. Milestones

| milestone | done when | proves |
| --- | --- | --- |
| **M0 Scaffold** | repo, sim core (grid, flow field, lane rules, RNG), tests green | the sim can be built and tested with no engine at all |
| **M1 Playable prototype** | one valley, 3 kinds, 10 migrations, meat, eggs, build phase, Phaser render, playable in a phone browser | *is mazing fun at phone size?* Answer this before touching Capacitor |
| **M2 Content and feel** | 6 kinds x 3 stages, 8 archetypes, kind chart, 50 migrations, balance harness (all done, as shapes), then first real art and audio | a full run is worth finishing |
| **M3 Mobile** | Capacitor shells, touch polish, saves, the no-network CI gate, TestFlight + Play internal | ships offline, provably |
| **M4 Web server** | server stack deployed, cloud save, daily seed leaderboard, replay verification | web plays off our servers |
| **M5 Meta** | fossils, unlocks, packs, endless | there is a reason to come back |

M1 is deliberately small: the whole bet is that drag-to-build mazing
feels good on a touchscreen. If it does not, M1 is where we find out.

## 9. Open questions (your call)

1. **Orientation.** Portrait as proposed, or landscape like the WC3
   original? Portrait wins one-handed play; landscape wins a wider maze.
2. **Tower footprint.** 1x1 as proposed, or WC3's 2x2 with 1-cell gaps?
3. **Juggling.** Allowed (proposed), or lock cells near invaders
   mid-wave?
4. **Art direction.** Pixel art keeps assets small and the offline
   binary lean; hand-drawn vector reads better on retina. Either works
   with the plan. Cute-round or fierce-realistic is the bigger choice.
5. **Web identity.** Anonymous device IDs only, or accounts (email or
   OAuth) from the start?
6. **Monetization.** Assumed none. Say so if that changes; it affects
   the store setup and the no-network rule on mobile.

## 10. Decisions taken so far

- 2026-09-20: separate repo from arbor; deploys on its own path.
- 2026-09-20: TypeScript monorepo, npm workspaces (pnpm is a one-line
  swap if preferred; nothing depends on it).
- 2026-09-20: simulation is a pure library; eight-direction pathing with
  no corner cutting; exact block checking; integer costs.
- 2026-09-20: **theme is dinosaurs**, chosen for broad appeal and zero IP
  exposure (real genus names, original art, no franchise inventions).
  Working name **Mazeosaur**. Towers are the player's pack; invaders are
  rival migrations; meat is the currency; eggs are lives.
- 2026-09-21: proceeding on the proposed defaults until overridden:
  portrait, 1x1 footprint, juggling allowed, anonymous web identity, no
  monetization. Art direction still open; M2 content ships as shapes.
- 2026-09-21: invader hp compounds at 10% a migration and bounty at 7%,
  so late meat still buys late dinosaurs. The balance harness (a scripted
  player in `packages/content/test`) must survive at least 35 of 50;
  it reached 46 at this tuning, losing eggs mostly to bosses.
- 2026-10-02: the v1 contracts are written down in
  [01-v1-architecture.md](01-v1-architecture.md) — save format, platform
  ports, sim-purity lint, scene-graph contract, review protocol. The lines
  below are the decisions in it that change or sharpen this proposal.
- 2026-10-02: the save format lives in `packages/sim` (`save.ts` plus a
  numbered, append-only `save-migrations.ts`), so it sits behind rule 1
  and `apps/server` needs nothing but the sim to verify a replay.
  `SAVE_VERSION === 1 + SAVE_MIGRATIONS.length`, asserted by a test, so
  bumping the version without adding a migration fails CI.
- 2026-10-02: profile and settings are separate objects in the save, not
  one. M4 syncs the profile and never the settings; a phone's haptics
  preference has no business arriving on a desktop.
- 2026-10-02: a run whose `content.version` no longer matches the build is
  **dropped**, keeping the profile; the title screen offers a fresh run on
  the same seed. The alternative is shipping every historical content
  version forever. So `content.version` bumps when a sim-visible number
  changes and not for art or copy, and a digest test in
  `packages/content` enforces that.
- 2026-10-02: the command log stays verbose JSON. A full scripted
  50-migration run measures 408 commands and 24.8 KB; §4.4's "a few KB"
  was optimistic but the order of magnitude is harmless. A packed encoding
  is a pure function of this one, so it stays available as save version 2.
- 2026-10-02: audio joins save storage and the network client as an
  injected port, and `mountGame` returns a handle with `suspend()` so the
  shell can flush an interrupted run when the OS backgrounds the app.
  Exactly one function in `packages/game` reads the network port.
- 2026-10-02: §6's bundle grep is demoted to a smoke test. The no-network
  proof becomes four exact layers — a Rollup module-graph assertion, a
  source-level import ban, a checked-in vendor allowlist, and removing
  `fetch`/`WebSocket`/`EventSource`/`sendBeacon` at runtime in the mobile
  entry point while wrapping XHR to same-origin reads only.
- 2026-10-02: rule 1 is now `npm run lint`, which `npm run check` runs
  first, so it fails on CI too rather than being a review habit. The linter carries its own TypeScript 6 in `tools/lint`
  because typescript-eslint will not load against the repo's TypeScript 7;
  holding the compiler back for a linter was the worse trade.
- 2026-10-02: v1 has three scenes — title, board, results. The board draws
  its own HUD. A scene field is declared, never initialised; `create()`
  gives it its first value, and the linter enforces the declaration half.
- 2026-10-03: the board accepted this proposal, and with it the merge gate.
  The architect merges ordinary Mazeosaur pull requests — scenes, sprites,
  sim refactors, content edits, CI, docs — on one review against the bar in
  [01-v1-architecture.md](01-v1-architecture.md) §6.3. The owner stays the
  gate for the homelab, spend, store credentials and anything that becomes
  visible on the public internet, because a review can establish that code
  is correct and cannot establish that somebody agreed to publish it.
- 2026-10-03: the web target is a commit-tagged GHCR image served as static
  files by Caddy, pinned by a Komodo stack in `JuKyoKim/arbor` on beelink.
  There is no application server, so **everything v1 persists is local to
  the device**: `SaveStore` is specified against a local store with no
  `userId`, no `etag` and no failure that can be a network failure, and
  `services.net` is absent on every target in v1, web included. §4.5's
  server is M4 and the game is complete without it.
- 2026-10-03: a save says which build wrote it. `SaveDocument.writtenBy` and
  `RunSave.startedBy` carry `{ commit, platform }`, where `commit` is the
  SHA the image was tagged with, so a bug report that quotes a save names
  the artifact to check out and a divergent resume says whether the build
  changed underneath it. The sim never reads either field, and a malformed
  one is repaired rather than rejected — it is the only field in the format
  with that treatment, because it is the only one nothing depends on.
