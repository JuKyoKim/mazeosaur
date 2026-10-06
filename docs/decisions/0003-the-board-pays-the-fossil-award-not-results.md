---
date: 2026-10-06
status: decided
---

# The board pays the fossil award at the won/lost save; `results` only shows it

Section 5.1 of [01-v1-architecture.md](../01-v1-architecture.md) gave the
`results` scene "the end-of-run summary and the fossil award", and the client
that exists gives it to `BoardScene.flush()` instead, by way of `runFinished`
and the `finishedAccounted` latch. The code is right and the contract is now
worded to match it: `board` computes and persists the award in the won/lost
flush, and `results` is handed `fossilsAwarded` in its `RunSummary` and draws
it. Section 5.4 is the contract; this file is why it reads that way.

**Why.** Three things break if the award moves to the screen that shows it.

The write stops being one write. Section 1.7 makes the terminal save a single
atomic document — `run: null` and the new `profile.best` in the same
transaction — so an award written by `results` is a second write from a second
scene, and a tab closed between the two leaves a run that is over beside an
award that never happened.

The latch stops being one latch. `won` and `lost` are terminal phases: nothing
re-ticks them, and `GameHandle.suspend()` calls `flush()` unconditionally on
every tab-hide for as long as one of them is current — which, once `results`
exists, includes the entire time `results` is on screen. Moving the award does
not move that `flush()`. It adds a second idempotence problem on a second
singleton scene and leaves the first one where it was, which is the hazard the
restart rule in section 5.2 exists for, carried across a scene boundary.

And accounting would start depending on navigation. A player who closes the
tab on the win screen would keep nothing, because the run's pay-out would be
waiting on a transition they never took. The run ends in `board`; that is
where it is paid.

**Rejected.**

- *Move the award to `results`, as section 5.1 originally said.* The three
  reasons above. The sentence was written before any of `flush()`,
  `finishedAccounted` or `suspend()` existed, and it described a tidy
  ownership split rather than a durable one.
- *Compute the award in both places — persist it in `board`, recompute it in
  `results` from the summary's numbers.* `fossilAward` is pure, so the two
  agree today. They are still two call sites on the same inputs that have to
  be kept in step by hand, and the one that is wrong is the one nobody reads,
  because the persisted number is the one the player keeps and the displayed
  number is the one they see.
- *Have `results` read the award back out of `profile.best`.* Wrong source: a
  run that was not a best never appears in `profile.best`, so every run after
  a good one would show the good one's number or nothing.
