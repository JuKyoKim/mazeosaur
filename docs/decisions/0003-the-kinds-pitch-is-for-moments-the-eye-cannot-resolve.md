---
date: 2026-10-06
status: decided
---

# The kind's pitch is for the moments the eye cannot resolve

Three SFX are pitched by the dinosaur's kind — `place`, `grow` and `hit` —
and the other thirteen are flat. The rule that picks the three is that the
pitch is only worth spending where the player cannot see which kind acted.
`place` lands while the eye is on the grid rather than the tray, `grow` is a
stage change that the call dropping a fifth *is*, and under a working maze
nothing on screen reports which of six dinosaurs is firing, so `hit` is the
only channel that says the whole maze is engaged. Section 6 of
[01-art-hud-and-audio.md](../01-art-hud-and-audio.md) holds the table and
states the rule above it.

**Why.** The spec named the kind in three rows and not in the other
thirteen, which read as an omission rather than a decision — the client had
in fact been pitching `select` by passing it the kind's hue, and the sink
pitches whatever hue it is handed. Resolving that needed a reason, not a
preference, or the next person to read the table would flip it back. The
reason generalises: pitch is a channel, channels cost attention, and a
channel spent on a fact already on screen is noise. It also explains the two
rows people ask about. `select` fires on the tap that opens the dinosaur
sheet, a panel naming that one dinosaur's kind, stage and stats with its hue
on it; there is no eyes-free version of that interaction, so a pitched tick
is a fourth copy of the same fact, and `select` is the quietest sound in the
table because it is chrome. A tap tone that moves teaches the player to hear
the interface as an instrument. `kill` is flat because the kill belongs to
the invader, several dinosaurs may have paid for it, and the eye is already
on the ring.

**Rejected.** *Pitching `select` by kind*, which is what the code did before
this was settled: it is redundant against the sheet, it makes the quietest
and most frequent sound in the game the most variable one, and it would have
to be argued for per-sound rather than from a rule. *Pitching every sound by
kind*, for the same reason at larger scale — uniform juice is noise, and six
hues times sixteen sounds is an instrument nobody asked to play. *Leaving
the table silent on the question* and letting each call site choose, which is
the state that produced the ambiguity: the sink applies the offset to any hue
it receives, so "which sounds are pitched" is decided by what a scene passes,
and that is not a decision anyone can review by reading the spec.
