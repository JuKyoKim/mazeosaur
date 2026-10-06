---
date: 2026-10-05
status: decided
---

# Pause stops the client's clock, and a run the player walks out of is unresumable but not finished

Pause is `BoardScene.update()` declining to call `tick()`. No command enters
the log, `state.tick` does not move, and the hash of the resumed run is the
hash it had when the menu opened — so a replay, a save or a server
verification of a paused run is identical to one of the same run played
straight through. **A pause the sim knew about would be a determinism change
and is not this**, which is also why it needs no save version bump.

The menu's other two entries, restart the run and end the run, both
**abandon** the run. It is written with `run: null` exactly as a won or lost
run is, because there is nothing left to resume — but it earns no fossils,
does not count toward `runsFinished`, and cannot take `profile.best`.
`flush()` therefore keeps `abandoned` separate from `finished` rather than
folding the two together: `accountFinish` still tests only the `won` and
`lost` phases.

The discard is load-bearing rather than tidiness. `create()` resumes
`doc.run` whenever it is non-null and `flush()` has been keeping an in-flight
run on `doc` since the first autosave, so a mid-run restart that skipped
`abandonRun()` would hand back the very run it was asked to throw away. The
won and lost paths get this for free, because their own `flush()` wrote
`run: null` before the overlay offered "Play again"; a mid-run restart is the
first path that does not.

Everything the renderer draws on a clock stops on the same one. The attack
and kill effects stop ageing, the toast stops fading, and the fliers'
air-route lights hold still, because all of them read `playedMs()` rather
than `this.time.now`. `SfxBus`'s limiter is the one deliberate exception: it
is a rate limiter on real time, not an animation.

Until the `title` and `results` scenes exist, ending a run shows the
end-of-run overlay the won and lost paths already draw, rather than inventing
a second shape for it.

**Why.** A decoration that keeps moving over a frozen board reads as the game
still being alive, which is the one thing a pause has to deny — and it is the
only symptom a player ever sees of the two clocks disagreeing, because the
sim's own state is frozen either way. Keeping the sim ignorant of pause is
what makes that free: there is no paused flag to replay, no timer to make
deterministic, and a save taken mid-pause is an ordinary save.

Separating abandoned from finished is the same argument about trust. A run
credited for being quit would let a player farm `profile.best` by ending the
run the moment a good migration cleared, and `profile.best` is the one number
in the save a server could later be asked to verify.

**Rejected.**

- *Teach the sim about pause — a `pause` command in the log, or a `paused`
  phase.* Every gameplay outcome is a function of (seed, content, command
  log), so a pause in the log is a pause that has to replay identically on
  every platform and in the verifier, in exchange for nothing a player can
  see. It also makes the save format carry it, which is a version bump for a
  menu.
- *Let the cosmetic clock keep running while the board is frozen.* Nothing
  desyncs — the effects and the air route are decorations and the sim cannot
  see them — but it is exactly the thing a pause exists to deny, and it was
  visible immediately in the drive: lights marching spawn-to-nest over a
  migration that had stopped dead.
- *Count an ended run as finished, so the player keeps the fossils they
  earned.* Generous, and farmable: end the run after a good migration, bank
  `profile.best`, start again. The stricter rule costs an honest player the
  fossils from a run they chose to abandon, which they can avoid by playing
  it out.
- *Give "End run" its own screen rather than reusing the end-of-run overlay.*
  A second results shape to build and then throw away when the real `results`
  scene lands, for a difference the player would read as a bug — ending a run
  and losing it put you in the same place because they are the same place.
