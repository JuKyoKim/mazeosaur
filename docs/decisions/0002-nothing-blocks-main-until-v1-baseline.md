---
date: 2026-10-05
status: decided
---

# Nothing blocks a main merge until the v1 release; the baseline is the named test set that does

Nothing blocks a merge on Mazeosaur `main` until the v1 production release. A
test may fail and must not block merging before then. What stands in for a
release gate in the meantime is a defined bar: the MVP features and
playability a v1 player depends on, named and tested as their own set,
`npm run test:baseline` ([03-v1-baseline.md](../03-v1-baseline.md) carries the
eight lines, the test proving each, and the `[@baseline]` tag convention).

One of the owner's eight lines splits rather than staying open. "Idle and
attack animations": the attack strike **is** in v1 and is specified
(`docs/01-art-hud-and-audio.md` §5.4.1, shipped as
`packages/game/assets/toy-box/strikes.{png,json}`); only the client wiring is
outstanding (ARB-223), so `test:baseline` covers the mechanical half today by
sequencing, not by scope. Idle breath and walk are not in v1 and stay
unspecified, because nobody has said what a Toy Box dinosaur does standing
still.

`check` and `client-smoke` stay exactly as `docs/02-ci.md` has them until the
v1 release. Only then does the owner get asked to make `test:baseline` itself
a required check on `main`, per the open [ARB-171](/ARB/issues/ARB-171)
question.

**Why.** Most of v1 is not built yet, so a gate demanding full feature
coverage today would block ordinary pull requests on work that has not
happened, not catch a regression. The alternative to that strict gate is not
"no bar at all" — a release still needs a real acceptance bar, and leaving it
as tribal knowledge drifts or gets lost the moment nobody remembers to check
it by hand. Naming the bar as its own tagged, runnable test set keeps it
checkable by a command instead of a memory, and keeps everything outside it
free to be red while v1 is still being built.

**Rejected.**

- *Gate every merge on full feature coverage now.* Most of the eight baseline
  lines had no client-level test when this was decided, and some of the
  features they describe were still being built. A gate that strict would
  have stopped unrelated work rather than catching a regression.
- *Leave the bar as a convention — "the important specs" — noted in a comment
  or an issue, rather than a tagged test set.* Indistinguishable from no bar
  the moment the comment is stale or the issue is closed. A set discoverable
  by `npm run test:baseline` stays true as the suite grows; a comment does
  not.
