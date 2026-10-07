---
date: 2026-10-07
status: decided
---

# The growth pip takes the better ink, and the client takes the measured hues

Two rulings on the same palette, raised together by ARB-386 because measuring
one needed the other.

**The growth pip's colour is a rule.** It is whichever of `COLORS.ink` and
`COLORS.selection` contrasts more with the kind fill the pip is drawn on —
`PIP_INK` in `packages/game/src/theme.ts` — and it is drawn opaque.

**`KIND_COLOR` is §3's v1 table**, the six hues the colour-blindness search
produced and `tools/art` has drawn from since M2. `CARD_TINT` is one constant
at 0.14, and a tray card's affordable cost is `text` rather than `meat`.

**Why the pip.** Growth stage on the board is carried by a count of pips and
by nothing else until the atlas gives each stage its own silhouette, so a pip
is a graphical object carrying information and owes WCAG 1.4.11's 3:1 against
what it sits on. `drawTowers` drew a fixed `ink` at **alpha 0.85**, which
composites to **2.88:1** on `horned` — under the floor, on screen, while the
pair `art:check` measures passed at 3.22:1 because it measures the opaque
value against the other palette. A 6px dot is 3.3pt on the reference phone;
there is no margin to spend there on softening an edge.

The rule is better than a number because a pip is not the refusal hatching,
although `ink`'s comment had them doing the same job. Hatching lands on a cell
nobody chose — any terrain, any lane mark — so it needs one value that beats
all of them. A pip lands on its own dinosaur's fill, one of six, known at the
call site. Taking the better of two values gives a floor of **4.94:1** today
(`horned`), and **4.01:1** against any fill a future hue revision could
produce, because the worst case the better-of rule can be handed is the mid
grey where the two values meet. A literal has no such floor, which is how this
one got to 2.88.

**Why the hues.** `KIND_COLOR` and `tools/art`'s `KIND_HUE` differed on all
six kinds for the whole of M2. §3 published the v1 column in the present tense
and called it "a proposed replacement"; `art:check`'s 60-pair colour-blindness
measurement, every plate, and every atlas frame used it; the renderer kept the
six the search was run *because they fail*. Since the client loads the toy-box
atlas, a player saw both palettes in one glance — a strike sprite in one hue
over a cell fill in the other. It is also why the pip ratio depended on which
file you measured: `art:check` named `tyrant` as the tightest pair, the
renderer's tightest was `horned`, and only the renderer's was failing.

Adopting the column is not one line. A tray card's background is its kind's
hue at a tint, which makes it the one background in the HUD that is a
variable, and §3's ten measured text pairs are all fixed panels — so the cards
were never measured. `armored`'s v1 value `#dbe4e6` is much lighter by design
("it was lost against the board"), and at the client's 0.22 tint it held
`textDim` at **3.92:1** and the cost's `meat` at **3.52:1**. Hence the other
two edits, and six new pairs in `art:check`.

**Rejected.**

- **Darkening `ink`.** `#111111` to `#000000` moves the tightest pip pair from
  3.22:1 to 3.58:1 — 11%, still thin, and nothing after it. It also moves all
  six pairs to fix two.
- **Lifting `tyrant` and `horned`.** Re-opens the constrained search over all
  60 pairs for the sake of a 3.3pt dot, and the v1 table has the same problem
  one kind over (`tyrant` at 3.17:1 opaque) — so the search would have to be
  re-run against a constraint it was not run with, to keep a value the pip
  does not need.
- **Alpha 1.0 and nothing else**, which is what ARB-386 proposed. It clears
  3:1 and only just: 3.22:1 on today's palette, 3.17:1 on the v1 one. Both
  land where `buttonActive` was at 4.44:1 — passing until somebody measured
  it — and this document already refused that once.
- **A plinth under the pips**, dark strip and light dots, which is how
  `tools/art`'s mock draws them. It fixes the pair permanently, costs a
  quarter of a 36px cell, and is the atlas's answer rather than the
  placeholder's: when the board's dinosaur cell becomes `darken(hue, 0.72)`
  with a sprite on it, the better-of rule returns the light value for all six
  on its own.
- **A seventh near-white for the light pips.** §4 allows exactly one near-white
  for marks on the board and says why. `selection` is that one, and a filled
  dot is not a selection mark: §4 carries selection on weight and geometry — a
  3px stroke, a range ring, a 5px lift.
- **Keeping the cost in `meat` and only lowering the tint.** At 0.14 `meat` is
  4.51:1 on `armored`, which passes by 0.01. `text`/`textDim` is the pair §4
  already names for this state and the pair **Grow** already uses, so the HUD
  ends with one affordability convention instead of two, and the meat pip
  beside the number is the channel that says the price is in meat.

**Left standing, deliberately.** An invader is a shape on `boardBg` in its
kind's hue, and the two dark hues are dark against a dark board: `tyrant` is
2.30:1, where M2's `horned` was 2.34:1. The v1 set neither causes this nor
meaningfully worsens it, and the fix is the same hue search this decision
declined to re-open, so it is its own issue with its own evidence.
`packages/game/test/palette-agreement.test.ts` pins the ratio so it cannot
drift further unnoticed.
