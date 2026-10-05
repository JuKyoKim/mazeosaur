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
- **A leg ends on a set of cells, not on one cell.** The spawn and the nest
  are reserved and nothing is ever built on them. A checkpoint is a routing
  waypoint and is buildable: while it is open the leg's target is the
  checkpoint alone, and while a dinosaur stands on it the leg's targets are
  the checkpoint's open eight-neighbours, so the leg ends one cell short and
  nothing else about the route moves. A field with several targets is one
  multi-source Dijkstra; the leg is finished at distance zero either way.
  The seal check reads this with no special case: block a checkpoint and all
  of its neighbours and the leg has no targets left, its whole field is
  `UNREACHABLE`, and the placement is refused as `would-block`. `laneIsOpen`
  requires every cell that can *begin* a leg to reach that leg's targets —
  the spawn, then the previous leg's target cells — which is also the
  condition that no invader standing beside an occupied checkpoint can be
  walled into a pocket. `legTargetCells` in `lane.ts` is the whole rule.

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
a phone makes gaps too fiddly to place, and one cell is the smallest piece
of maze a thumb can commit when every cell is placed by hand). Six
**kinds**, each a line of three
growth stages grown in place. Each stage is a real genus, so growing is also
a small collection:

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

**Controls.** Tap a kind in the tray to select it, then tap a cell to
place it; the card returns to rest after a successful place, so every
dinosaur is two taps.
Tap a placed dinosaur for its sheet (grow, sell, range, stats). Pinch to
zoom; free undo of the last placement during a build phase. Dragging does
nothing and there is no long-press: both were dropped on 2026-10-05, see
section 10. Selling is the Sell button on the sheet. Web adds hotkeys and
mouse hover ranges. The full interaction spec — selected-card treatment,
the placement preview, refusals and cancel — is section 4 of
`docs/01-art-hud-and-audio.md`.

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
  docs/               proposals and design documents, numbered
  docs/decisions/     one decision per file, NNNN-slug.md
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

M1 is deliberately small: the whole bet is that tap-to-place mazing feels
good on a touchscreen — that drawing a fifteen-cell wall one deliberate tap
at a time is satisfying rather than laborious. If it does not, M1 is where
we find out.

## 9. Open questions (your call)

1. **Orientation.** Portrait as proposed, or landscape like the WC3
   original? Portrait wins one-handed play; landscape wins a wider maze.
2. **Tower footprint.** 1x1 as proposed, or WC3's 2x2 with 1-cell gaps?
3. **Juggling.** Allowed (proposed), or lock cells near invaders
   mid-wave?
4. ~~**Art direction.**~~ **Settled 2026-10-04: blocks, the `toy-box`
   direction.** See section 10 and `docs/01-art-hud-and-audio.md`.
5. **Web identity.** Anonymous device IDs only, or accounts (email or
   OAuth) from the start?
6. **Monetization.** Assumed none. Say so if that changes; it affects
   the store setup and the no-network rule on mobile.

## 10. Decisions taken so far

**This list is closed. A new decision is a new file in
[decisions/](decisions/README.md).** The entries below are the history and are
left exactly as they were taken; nothing here is reworded. Appending meant
every decision pull request editing the same last line of the same file, so
any two of them conflicted by construction — and a conflicting pull request
gets no merge ref, so GitHub builds it not at all and says nothing. The
reasoning is
[decisions/0001-decisions-live-in-their-own-files.md](decisions/0001-decisions-live-in-their-own-files.md).

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
- 2026-10-03: the HUD layout, sprite manifest, audio list and onboarding
  are specified in [docs/01-art-hud-and-audio.md](01-art-hud-and-audio.md),
  with the numbers shared with `tools/art/layout.ts` so the spec and the
  sample frames cannot disagree. Three candidate directions for item 4
  above are rendered as frames of the real board at real phone size in
  `docs/art/`; the choice is the board's and nothing else waits on it.
  Two findings that are independent of the choice: the M2 kind colours
  fail a dichromat separation check and are replaced, and the M2 42px
  HUD buttons are 22.8pt — half the 44pt floor — so the hit target
  minimum is 82 logical pixels.
- 2026-10-03: a dinosaur **occupies one cell and is drawn taller than one** —
  a 36x54 draw box, bottom-anchored on the cell's bottom edge, rows drawn in
  increasing y so a nearer row overlaps the one behind. The footprint stays
  1x1, so the sim, pathing, the block check and all 50 migrations are
  untouched. This is the mechanism by which a block style reads as solid; the
  alternative — enlarging the cell — was measured against the real sim and
  costs the maze its point, taking the mazed-lane multiplier from 13.2x to
  6.8x and the wall count from 237 to 49, which fills the board by migration
  18 of 50. The cost carried instead is occlusion: a sprite covers the lower
  half of the cell behind it, so only the upper half of each silhouette
  survives in a dense wall. That is why 1.5 cells is the cap and why all six
  tells are identified by the top of the animal. Specified in
  [docs/01-art-hud-and-audio.md](01-art-hud-and-audio.md) section 5.0, to be
  confirmed by driving a dense wall at phone scale.
- 2026-10-03: `tools/` joins the `tsc` gate (`tools/tsconfig.json`,
  `types: ["node"]`, appended to `npm run typecheck`). This reverses the
  call made reviewing the generator's own pull request, which was that two
  provable non-bugs did not justify a `@types/node` devDependency. The
  reversal is about what the code does rather than how much it costs:
  `tools/art/layout.ts` is the single source of every layout number the
  spec and the frames both read, so an unchecked edit there can only be
  found by a human noticing a picture changed.
- 2026-10-03: `apps/web` keeps its own `vite@7` while the root resolves
  `vite@8`, and the two are deliberately left un-deduped. The root
  declares no vite of its own, so npm hoists the highest major in vitest
  5's peer range (`^6.4.0 || ^7.0.0 || ^8.0.0`) — nobody chose 8 for the
  root; what is deliberate is leaving it. Aligning means one of two real
  changes: move the shipped web shell to vite 8, a rolldown bundler
  migration with no size or gameplay gain available today, or add a vite
  devDependency to the root that nothing at the root uses, purely to
  steer hoisting, which couples the repo to vitest's current peer floor.
  Vitest 5 supports vite 7 — the same range appears in its peer and its
  dev dependencies — so alignment is available; it is simply not worth
  either cost while the skew has no consequence. Config that both majors
  must typecheck is written to the intersection of their types instead —
  see the comment on `manualChunks` in `apps/web/vite.config.ts`.
  Revisit when `apps/web` moves to vite 8, or when a second field
  diverges.
- 2026-10-03: the committed art frames are guarded by pixel equality, not
  byte equality, and the guard is enforced inside the generator rather
  than in CI. `art:frames` decodes the PNG already on disk and skips the
  write when the pixels match, so CI's existing regenerate-and-diff step
  compares art and not compression. The reason is that PNG bytes are not
  reproducible: `deflateSync(level: 9)` is a call into whichever zlib the
  running Node links, and two builds disagree on the same scanlines —
  measured, 12879 bytes against 12878 for one frame, per-frame rather
  than uniform. Bytes were therefore pinning the toolchain, not the
  pixels, and a `node-version` bump or an arm64 runner would have turned
  the step red with no art change and read as the art having drifted.
  Making the generator idempotent on pixels also disarms the trap without
  a `check.yml` edit, which no agent can push; `art:verify` is the same
  comparison as a read-only command. This retires the "regenerate frames
  on Linux, never on a Mac" rule — the variable was never the OS. See
  `docs/02-ci.md`.
- 2026-10-03: `loadSave` takes a third argument, the platform now running
  (`loadSave(raw, content, platform)`). Section 1.4 of
  `docs/01-v1-architecture.md` specified two arguments and, four bullets
  later, a repair that substitutes `{ commit: "unknown", platform }` for a
  missing `writtenBy`. The sim is one compiled package on every target, so
  neither `raw` nor `content` names the calling shell and nothing in the sim
  may ask its environment — the two-argument signature could not satisfy its
  own bullet. The shell already has the value as `MountOptions.build.platform`
  and passes it. Only the platform, not the whole `BuildStamp`: a repair that
  could reach the running build's *commit* would write the lie that
  `writtenBy` exists to prevent. The doc was wrong and the implementation on
  `maze-server/local-first-saves` was right; the doc now says so.
- 2026-10-03: `LoadOutcome` carries the `Game` its own replay built —
  `resumed: Game | null` on the `ok: true` branch, and a matching field on
  `MountOptions`. `loadSave` replays the run to check the hash and then
  dropped the result; because section 2 forbids an `await` in `create()` and
  a `SaveDocument` holds no live object, the board scene replayed the same
  log a second time. Measured: a full run is 29,232 ticks and
  `packages/content/test/balance.test.ts` simulates one in 452 ms on a dev
  box — scripted player included, so a bare replay is somewhat under that
  and a phone WebView several times over it. A late-game resume paid it
  twice, on the main thread, before the first frame. Handing
  back the object that already exists removes one replay and adds no I/O, no
  promise and no new source of truth: it is non-null exactly when `doc.run`
  is, and the hash check that validated the run is what produced it. It is
  consumed once, by the first `create()`, because a `Game` is mutable and
  `scene.restart()` is a fresh run (sections 1.4, 2 and 5.2).
- 2026-10-04: **the art direction is blocks — the `toy-box` direction —
  which closes section 9 item 4.** The board rejected all three points on
  the pixel/vector x cute/fierce grid and briefed a fourth off it: blocks,
  in the Crossy Road register. Shown that fourth, it chose it with the
  instruction to keep working the models. Only `toy-box` has a shipped
  atlas (`packages/game/assets/toy-box`, 57.7 kB for 72 frames); the other
  three stay in `tools/art/directions.ts` and `docs/art/` as the record of
  how the choice was made, and `tools/art/build.ts atlas <direction>` will
  still emit any of them. The useful finding from the comparison is that
  the atlas is nowhere near the 40 MB budget in any direction, so size was
  rightly not an input.
- 2026-10-04: a dinosaur is **drawn 1.25 cells tall, anchored by its ink to
  the bottom edge of the cell it occupies**; the footprint stays one cell
  and the sim is untouched. Section 5.0 of `docs/01-art-hud-and-audio.md`
  had settled 1.5 and nothing drew it — the board frame still blitted each
  dinosaur centred in a 40px box, so the rule the client was about to
  implement had never been looked at. Rendering it corrected two things.
  The anchor has to be on the ink rather than on the authored square,
  because the camera centres its subject and the gap under the feet runs
  from 18px for a hatchling raptor to 2px for an adult longneck out of 64 —
  anchoring the square floats the hatchling half a cell off the floor of
  its own cell. And 1.5 was argued from vertical occlusion alone; at 1.5
  the widest adults reach ~7px into each *horizontal* neighbour too, and
  twenty adjacent cells at the phone's 19.5pt cell read as one pile.
  Rendered at 1.0, 1.15, 1.25, 1.35 and 1.5 and chosen by looking: 1.25 is
  the largest value where that block stays twenty dinosaurs. The shipped
  atlas is trimmed to the ink so the client's placement is
  `setOrigin(0.5, 1)` plus a scale from `meta.authored`, with no per-frame
  table.
- 2026-10-05: **the art direction is reopened, and animation is part of the
  brief.** The owner turned down all four directions — including `toy-box`,
  chosen the day before — and asked for the GBA tactics idiom: small readable
  map sprites, a limited palette, a clean dark outline, and an idle loop and
  an attack cycle on every kind. `tactics-pixel` is that candidate, authored
  at 15px because 45/15 is exactly 3 and the pixel grid therefore survives
  into the logical canvas. It is an homage built by our own generator from
  the same `bestiary.ts` silhouettes and our own kind hues; nothing is traced
  or copied, which is rule 5. The clips are in section 5.6 of
  `docs/01-art-hud-and-audio.md` and are **not** specific to the direction —
  they transform a finished sprite, so whichever direction wins can breathe.
  `toy-box` keeps `CHOSEN` and the shipped atlas until the owner answers,
  because the client integration is live against it and a half-swapped
  direction would have the game loading an atlas no document describes.
- 2026-10-05: **the frame-border check gates the direction that ships and
  reports the other three, which are formally exempt.** A sprite touching
  the edge of its authored square has lost ink there, and trimming does not
  recover it. The exemption is not a difference of art intent: the three
  flat directions are the record of how the choice was made, their frames
  in `docs/art/` are what the board looked at, and pulling their silhouettes
  in a pixel would edit that evidence while fixing nothing that ships.
  Measured, the contact is also not the per-genus appendage overhang
  `tools/art/bestiary.ts` licenses — it is on the left edge in the same
  amount for every kind of a given archetype, so it comes from the shared
  silhouette reaching x = 0. Fossil Pixel touches on 48 of 72 frames,
  Clay Pack on 57 (the only one losing feet), Valley Naturalist on 42;
  `toy-box` on none. The chosen direction is `CHOSEN` in
  `tools/art/directions.ts`, read by both the gate and `npm run art:atlas`,
  so changing direction is one line rather than three agreeing by luck.
- 2026-10-05: **placement is tap-to-select then tap-to-place, and
  drag-to-paint is dropped** — the owner's call, because a drag mis-places on
  a phone. A fast finger skips cells between pointer events, so placement
  interpolates the line between them; that interpolation is what puts
  dinosaurs on cells the player did not aim at, and it cannot be tuned out
  without reintroducing the skipped cells. This reverses three lines that are
  now corrected rather than left standing: the `drag to paint` clause in
  **Controls** above, the "drag-to-paint gives the same 'wall fast' feel"
  justification for the 1x1 footprint, and M1's bet in section 8, which was
  written as drag-to-build. The 1x1 footprint itself does not change and
  section 9 item 2 stays open; only its reason is restated. **Long-press to
  sell goes with it**, for its own reasons: 500ms is inside the range of a
  deliberate thumb tap on a 19.5pt cell, so the gesture mis-fires on the
  careful player, and it is a destructive unconfirmed action competing with
  a Sell button that is one tap away on the sheet and shows the refund.
  Dropping drag never depended on what replaced it; section 4 of
  `docs/01-art-hud-and-audio.md` carries the interaction spec and the
  reference comparison that produced it.
- 2026-10-05: **a tray card deselects on a successful placement — one-shot,
  the PvZ-exact behaviour** — so every dinosaur is two taps, tap the card then
  tap the cell. The owner's call, and the last open part of the entry above:
  the alternative was a selection that persists across a placement, which
  would have made a fifteen-cell wall sixteen taps and, modelled with Fitts's
  law against the 30-second build timer, 5.9 seconds. One-shot was chosen
  knowing it costs **30 taps, 2.1 metres of thumb travel and 22.1 seconds, 74%
  of the build phase**, because a card that stays armed turns every stray tap
  on the board into a dinosaur the player did not buy, and the owner accepts
  the extra taps on a long wall. Nothing replaces the "wall fast" feel: a
  repeat affordance buys taps back by letting one gesture commit several
  placements, which is the property being rejected. The 22.1s is modelled, not
  measured; a drive of the real client at 720 x 1280 that shows a wall cannot
  be finished inside the timer is a measured finding and earns a new issue.
  Section 4 of `docs/01-art-hud-and-audio.md` carries the model, the table it
  was accepted on and the three client deltas.
- 2026-10-05: the refused preview's hatching is **3px stripes of `ink` at
  alpha 1, stepped 8px, over `refusal` at 0.45**. `ink` because hatching in
  `refusal` is one hue at two alphas, which the bright spawn, checkpoint and
  nest markers erase outright — the four marked cells a new player tries
  first, two of which always refuse. 3px because at the reference device a 2px stripe is
  1.08pt, barely over one device pixel at DPR 1, where it measures 57% texture
  against a 3px stripe's 76%. The spacing and the fill stay where they
  were. Section 4 of
  [01-art-hud-and-audio.md](01-art-hud-and-audio.md) carries the measurements
  and the reason the percentile contrast ratio cannot see two of the three
  numbers: once a tenth of the cell is solid ink and a tenth is solid fill it
  is a property of the two colours, identical across stripe widths that
  differ by a third in actual texture.
- 2026-10-05: row 1 of the HUD is laid out against each field's **widest**
  value, and section 4 records the arithmetic. The prototype's row 1 renders
  `Migration 1/5` and `30s` on top of each other because it has no such
  derivation and because it carries timer digits that section 4 does not
  have: the counter plus a `60 left` readout is 245 of the 224 the band
  between the eggs and Send actually has. The fix is section 4's bar, not a
  coordinate.
- 2026-10-05: **difficulty is three `Content` values, not a switch in the
  sim.** `@mazeosaur/content` carries one `DIFFICULTY_TUNING` table —
  invader count, invader hit points, bounty, build-phase seconds — and
  `contentFor(difficulty)` builds a whole `Content` from it. The sim knows
  the three *names* (`Difficulty`, so the save's narrower can check one
  exhaustively and a HUD can print a label) and nothing else: no rule
  branches on a difficulty, and a run stays `(seed, content, command
  log)`. The difficulty is part of `content.version` — `m3.0-easy` — so
  §1.5's `===` check already drops a run resumed against the wrong
  difficulty rather than replaying it at numbers the player never played.
  Easy is today's invaders with a 35-second build phase; medium is 130%
  invaders; hard adds 140% hit points and takes the 3 seconds off. The
  owner tunes the values, per [ARB-216](/ARB/issues/ARB-216); the shape is
  what was decided here. One lever the owner's three columns did not name
  is in the table because the model needs it: at full bounty, 30% more
  invaders is 30% more meat, and the balance harness reached *further* on
  medium than on easy and won the valley. `bountyPercent` holds meat per
  migration flat so "more enemies" means pressure.
- 2026-10-05: **the checkpoints are buildable; the spawn and the nest stay
  reserved.** The owner, on the demo: "the points 1 and 2 needs to not be
  physically blocking? we need to allow players to build on those areas, but
  the mobs need to follow that general pathing which is good." A checkpoint
  is a routing waypoint and nothing else, so it reserves nothing; the spawn
  is where invaders appear and the nest is where they arrive, so a dinosaur
  on either breaks the fiction — and blocking either makes the lane closed by
  definition, so it would be refused as `would-block` anyway and `lane-cell`
  is only the clearer message. The leg therefore ends on a *set* of cells
  (§4.1): the checkpoint while it is open, its open eight-neighbours while a
  dinosaur stands on it. Rejected: targeting the nearest open cell and
  recomputing, because the effective waypoint then drifts arbitrarily far as
  the player builds around it and needs an invented tie-break, which loses
  the routing the owner asked to keep; and a fixed 3x3 region, because it
  shortens every leg even with nothing built, changing the natural route and
  the mazed-lane multiplier for no reason. The chosen rule is byte for byte
  today's field until somebody builds on a checkpoint and moves the leg's end
  by one cell when they do. Sealing stays impossible by the same exact test
  rather than a new rule: no targets left means no reachable cells, which is
  what `laneIsOpen` already reads as closed.
- 2026-10-05: **the docs cite symbols, never a line number.** A line number
  reads as precise, passes review because it once was, and rots on the next
  unrelated edit to the file — and it rots invisibly, because the reader who
  checks it lands a line or two away inside the same object literal and
  believes it. Three fixes in a row were that, one of them pointing into a
  file that had been a bare re-export since the canvas and HUD geometry moved
  into the client package. Name the exported symbol, the
  function or the field instead. The shape to copy is already in section 4 of
  [01-art-hud-and-audio.md](01-art-hud-and-audio.md): the no-pre-selection
  paragraph names `buildHud` and `selectDef`, and the selected-card table
  names `ROW3.kindButton.y` for the rest position. Both have survived every
  edit that rotted a neighbouring line number, because a grep finds a symbol
  wherever it moved to. `npm run check:readmes` now rejects a
  citation of the form path-dot-extension-colon-digits in any markdown prose,
  with fenced blocks exempt so a quoted transcript may keep the numbers it
  actually printed.
