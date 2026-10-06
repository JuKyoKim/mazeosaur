# Mazeosaur v1 baseline

*Status: decided, 2026-10-05, per [ARB-201](/ARB/issues/ARB-201)
and the owner decision it routes. Confirmed against the repo at `181e8f6`
(tap-to-place, ARB-169/ARB-166, merged into `main`).*

**Owner decision (2026-10-05): nothing blocks a merge on `main` until the
v1 production release.** Before then, a test may fail and must not block
merging. What the release needs instead is a defined baseline: the MVP
features and playability a v1 player depends on, named as their own test
set, so the release has a real bar independent of whatever else is red.

## The eight lines

One line each, in the repo's vocabulary, per the owner's list.

1. Start a run.
2. Tap-to-select then tap-to-place, one-shot, PvZ-style ([ARB-166](/ARB/issues/ARB-166)).
3. Migrations spawn and path through the maze.
4. Dinos attack.
5. The meat and eggs economy.
6. The win screen and the lose screen.
7. Restart.
8. Save and resume.

## The mapping

Every test below is tagged `[@baseline]` in its title and runs under
`npm run test:baseline` (see below). "Sim" is a `vitest` test under
`packages/*/test` or `apps/web/test`; "client" is a Playwright spec under
`tests/client`, driving the real client in a headless browser.

| # | line | test | level | state |
| - | --- | --- | --- | --- |
| 1 | start a run | `tests/client/smoke.spec.ts` "full run: four select+tap pairs, grow, sell, send, leak, lose, play again" | client | existing |
| 2 | tap-to-select then tap-to-place | the same smoke test — four select-then-tap pairs, each asserting the card is spent by its placement, per the one-shot model ([ARB-166](/ARB/issues/ARB-166) #43/#44) | client | existing |
| 3 | migrations spawn and path | `packages/sim/test/flowfield.test.ts` "routes around a wall and marks sealed cells unreachable", "nextStep walks a creep to the target along non-increasing distances"; `packages/sim/test/lane.test.ts` "still routes an invader through both legs with a dinosaur on the checkpoint" | sim | existing |
| 4 | dinos attack | `packages/sim/test/mechanics.test.ts` "hits the N furthest-along invaders per cooldown"; `packages/sim/test/game.test.ts` "ground-only dinosaurs ignore fliers" | sim | existing |
| 5 | meat and eggs economy | `packages/sim/test/game.test.ts` "charges meat, blocks the cell, and refuses when broke", "leaks eat eggs and an empty nest loses the game", "kills pay bounty, clearing pays the bonus, and clearing the last migration wins" | sim | existing |
| 6a | the lose screen | the same smoke test — drives `loseOnNextLeak`, waits for the overlay, clicks "Play again" | client | existing |
| 6b | the win screen | `tests/client/win-screen.spec.ts` "win screen: clearing the last migration shows it, and Play again starts a fresh run" | client | **added** |
| 7 | restart | `tests/client/restart-regression.spec.ts` "scene.restart() leaves the canvas rendering with no renderer errors" | client | existing |
| 8 | save and resume | `packages/sim/test/save.test.ts` (hash/replay/resumed-object round trips), `packages/game/test/resume.test.ts` (reuses the resumed `Game`, never replays twice), `apps/web/test/save-store.test.ts` (IndexedDB put/read/coalesce); `tests/client/resume.spec.ts` "save and resume: a reload picks the stored run back up, not a fresh one" | sim + client | sim existing, client **added** |

### Corrections to the routing issue's evidence

[ARB-201](/ARB/issues/ARB-201) read the repo at `7c08e61`
and said to confirm rather than trust its table. Two things did not check
out:

- **Line 2 is not a gap.** ARB-169/[ARB-166](/ARB/issues/ARB-166) (`#36`)
  merged into `main` at `181e8f6`, before this issue was opened, and
  rewrote `smoke.spec.ts` to drive tap-to-select/tap-to-place already — the
  drag-paint version the issue quoted is gone. The two constraints the
  issue named (wait for the merge, or land a spec that is red until it) do
  not apply; there was nothing left to do here but tag what already exists
  and passes. One real gap did exist alongside this: `#36` shipped
  **sticky** selection (a placement does not clear the armed card), which
  the owner's own line 2 wording — "one-shot, PvZ-style" — never actually
  matched. `#43`/`#44` landed one-shot mid-review on this issue and
  rewrote the smoke test accordingly; the mapping above is the post-`#44`
  state.
- **The economy and attack tests live in `game.test.ts`, not
  `mechanics.test.ts`.** The issue's evidence table cited
  `mechanics.test.ts` for "charges meat, blocks the cell, and refuses when
  broke", "leaks eat eggs...", "kills pay bounty...", and "ground-only
  dinosaurs ignore fliers". All four are in `packages/sim/test/game.test.ts`;
  `mechanics.test.ts` only has the multi-target hit test. Fixed above.

### Correction: `lane.test.ts` had the tag and this table did not know

[ARB-264](/ARB/issues/ARB-264) found that `packages/sim/test/lane.test.ts`
picked up `[@baseline]` when the checkpoint work landed (`#53`) without
this table's row 3 learning about it — the exact "unlisted tag" failure
mode the guard below exists to catch. Added above; see that doc section
for the guard itself.

## Idle and attack animations, answered

The owner's list (routed through [ARB-199](/ARB/issues/ARB-199) and
[ARB-201](/ARB/issues/ARB-201)) names this line as **"dinos attack, with
the Toy Box idle and attack animations."** Splitting it in two:

- **Dinos attack, mechanically** — a placed dinosaur damages invaders in
  range on cooldown, ground-only kinds ignore fliers, kills pay bounty.
  This is real, tested (line 4 above), and the client already renders an
  effect when it happens (`BoardScene.ts`'s `case "attack"`, a colored line
  flash — see `handleEvents`).
- **Idle and attack animations.** The owner answered this on
  [ARB-216](/ARB/issues/ARB-216) and it splits in two. **The attack effect
  is in v1 and is specified**: `docs/01-art-hud-and-audio.md` §5.4.1, six
  per-kind strikes of three steps each in the shipped Toy Box direction,
  shipped as `packages/game/assets/toy-box/strikes.{png,json}` — a third
  atlas beside `dinos.json`, which still carries one static frame per
  dinosaur with no idle/attack keys of its own ([ARB-222](/ARB/issues/ARB-222),
  [#56](https://github.com/JuKyoKim/mazeosaur/pull/56)). §10 item 3 of that
  document was amended to match. **Idle breath and walk cycles are still
  not in v1** and are still unspecified — what defers them is that nobody
  has said what a Toy Box dinosaur does standing still, not size: the
  strikes measured 18 frames for 12.4 kB against a 40 MB binary.

So line 4's second half now has a specification to test against, but not
yet an implementation: the client wiring is
[ARB-223](/ARB/issues/ARB-223), blocked on
[ARB-222](/ARB/issues/ARB-222). `npm run test:baseline` still covers only
the mechanical half until that lands, which is what keeps it green — and
that is now a *sequencing* statement rather than an unanswered scope
question.

## `npm run test:baseline`

```
"test:baseline": "npm run check:baseline-tags && vitest run -t \"@baseline\" && playwright test --config tests/client/playwright.config.ts --grep \"@baseline\""
```

Tagging is a literal `[@baseline]` suffix on the test's title string, not a
file-naming convention or a comment: `vitest`'s `-t`/`--testNamePattern`
and Playwright's `--grep` both filter on the title, so one marker works
for both runners without a second config file. A test earns the tag by
proving one of the eight lines above; nothing else carries it. The
mapping table above is maintained, not generated — other PRs add the
tag to a new test as they land (row 3's `lane.test.ts` entry arrived
this way), and the table must be updated in the same PR. Tests
outside this set may stay red during v1 work — that is the point of the
owner's decision — and the gate for `main` stays `check` and `client-smoke`
exactly as `docs/02-ci.md` has them, unchanged by this doc.

### How the count stays honest

[ARB-264](/ARB/issues/ARB-264): `vitest run -t "@baseline"` fails **open** --
a `-t` filter that matches zero tests inside files that still load exits 0,
the same as a full pass. `--passWithNoTests` does not help; it governs zero
test *files*, not a title filter matching zero tests within files that did
load. Playwright's `--grep` fails closed only on a *total* wipe of the
client half -- it does not notice the sim half going quietly empty, since
nothing in the Playwright run depends on vitest's count.

`scripts/check-baseline-tags.mjs` runs first and closes both directions: it
scans every `*.test.ts`/`*.spec.ts` file in the repo for `[@baseline]`-tagged
titles and compares the result against a literal `EXPECTED` list in the
script, not against this doc's prose (the mapping table above mixes exact
quotes with paraphrase, so it is for a human, not a parser). A tagged test
that disappears, or a new one that appears without `EXPECTED` learning about
it, exits 1 with the exact file and title at fault. Updating `EXPECTED`
without updating the mapping table above leaves the two out of sync, so keep
both in the same commit -- this is the discipline the "Correction" note above
exists to record one failure of.

Run it the same way `check` and `client-smoke` are run locally
(`docs/02-ci.md`), with Chromium installed once via
`npx playwright install chromium`:

```
$ npm run test:baseline

> npm run check:baseline-tags && vitest run -t "@baseline" && playwright test --config tests/client/playwright.config.ts --grep "@baseline"

baseline tags: 18 tagged tests, matches scripts/check-baseline-tags.mjs

  ✓  restart-regression.spec.ts … scene.restart() leaves the canvas rendering with no renderer errors [@baseline]
  ✓  win-screen.spec.ts … win screen: clearing the last migration shows it, and Play again starts a fresh run [@baseline]
  ✓  resume.spec.ts … save and resume: a reload picks the stored run back up, not a fresh one [@baseline]
  ✓  smoke.spec.ts … full run: four select+tap pairs, grow, sell, send, leak, lose, play again [@baseline]

  4 passed
```

## ARB-171, deferred

This doc does not make `test:baseline` a required check on `main`. At the
v1 production release, the owner will be asked to make this set (and only
this set) required, per [ARB-171](/ARB/issues/ARB-171) — not before, and
not the rest of `check`/`client-smoke`, which stay informational on `main`
until then per the 2026-10-05 decision above.
