# Mazeosaur v1: art, HUD, audio and onboarding

*Status: spec. Supersedes nothing; section 9 item 4 of
[the proposal](00-proposal.md) is still the open question and section 2
below is what the board is being asked to settle.*

This document is what a client engineer builds from. Every number in it is
a logical pixel on the 720x1280 canvas unless it says `pt`, and every
layout number in it is also a constant in
[`tools/art/layout.ts`](../tools/art/layout.ts), which is what draws the
sample frames. The spec and the picture read the same constants on purpose:
if they disagree, one of them is lying, and there is no way to tell which.
The timings in sections 5.4 and 6 are the exception — they are behaviour,
not layout, and the mock does not animate.

Regenerate everything this document refers to:

```
npx tsx tools/art/build.ts frames        # the sample frames in docs/art
npx tsx tools/art/build.ts check         # colour, contrast, hit targets, bytes
npx tsx tools/art/build.ts atlas <id>    # the shipping atlases for one direction
```

---

## 1. The reference device, and why every number is two numbers

The logical canvas is **720 x 1280**, 20 x up to 28 cells of **36px**, the
HUD the bottom **272px** and the board area the 720 x 1008 above it. Phaser
scales that canvas uniformly (FIT) onto whatever screen mounts it.

The reference phone is **390 x 844pt at dpr 3** — an iPhone 12 through 16
and the middle of the Android range. At 720 wide into 390 wide the width
binds, so the scale is **0.5417** and the canvas renders 390 x 693pt,
leaving the rest of the screen as letterbox.

That scale is the reason every size appears twice. A 36px cell is
**19.5pt**. A 42px button — which is what M2 shipped — is **22.8pt**, which
is barely half the 44pt floor that both Apple and Google publish. The
smallest number in this document is therefore `MIN_HIT = 82`, which is 44
divided back through the scale and rounded up. **82 logical pixels is the
floor for anything a thumb touches.** It is the single most load-bearing
constant here.

`npx tsx tools/art/build.ts check` prints every control against it. Nothing
tappable is allowed to print under 44.0pt.

### Type scale

Four sizes and no more. The HUD says less rather than smaller.

| role | logical | on the phone | used for |
| --- | --- | --- | --- |
| `vital` | 34px | 18.4pt | the meat and egg counts |
| `title` | 26px | 14.1pt | a dinosaur's genus, a result headline |
| `body` | 22px | 11.9pt | the migration line, stat lines, button labels |
| `label` | 19px | 10.3pt | dim secondary labels **only** |

There is nothing below `label` because 19px is already 10.3pt, and 10.3pt
of dim grey is the smallest thing a person reads on a bus. Anything that
wants to be smaller than `label` should instead not be on the screen.

---

## 2. The art direction: Toy Box

**Mazeosaur is drawn in blocks. The direction is `toy-box`, it is the only
one with a shipped atlas, and the other three below are the record of how it
was chosen rather than live options.** Section 9 item 4 of the proposal is
closed; the dated entry is in section 10 there.

The proposal left two axes open: pixel versus hand-drawn vector, and
cute-round versus fierce-realistic. Three points on that grid were rendered
as the actual board at the actual size, so the choice could be made by
looking rather than by imagining. The board rejected all three and asked for
a fourth off that grid: blocks, in the Crossy Road register, "steer away from
2d". **Toy Box** is that brief, built the same way and rendered into the same
frames, and it is what the board then chose — with the instruction to keep
working the models, which is why `blocks.ts` has had a second pass and why
the anchor in 5.0 exists at all.

| direction | axes | authored | ink | atlas | the pitch |
| --- | --- | --- | --- | --- | --- |
| **Fossil Pixel** | pixel, fierce | 36px | 1px | **23 kB** | Hard edges, four shade bands, one ink pixel. One art pixel is one canvas pixel. Smallest atlas by a factor of five. |
| **Clay Pack** | vector, cute-round | 48px | 2px | 126 kB | Sticker-weight line, heads a third too big, an eye you can still see at 20px. Friendliest read, easiest to animate. |
| **Valley Naturalist** | vector, fierce | 48px | 1px | 121 kB | Skeletal proportions, hairline edge, deep belly shadow, cold rim light. Reads as an animal, not a mascot. |
| **Toy Box** | blocks, cute-round | 64px | 2px | 68 kB | Six to fourteen boxes an animal under one fixed isometric camera, three flat tones a face. Reads as a solid toy rather than a drawing of one. |

### What Toy Box is, and what it is not

It is **pre-rendered** 3D: the models in
[`tools/art/blocks.ts`](../tools/art/blocks.ts) are projected once by
[`tools/art/voxel.ts`](../tools/art/voxel.ts) into ordinary sprites. The
engine sees a texture atlas like any other — no runtime 3D, no depth
buffer, no new dependency — and the atlas is *smaller* than either vector
direction, because flat faces compress well.

It is **not** a change of camera. The board is still a square top-down grid
of 20x28 cells. Tilting the board — the other half of what makes the
reference game look the way it does — changes how much of the maze is
visible at once and therefore how the maze plays, so it is a gameplay
decision rather than an art one and it is not taken here.

That distinction is the honest caveat, and the frames show it: at the
19.5pt cell, a solid and a drawing of a solid are nearly the same handful
of pixels. **The block treatment reads in the shop tray, the dinosaur sheet
and the boss, and barely reads in a wall cell.** The cell is the binding
constraint, not the artwork.

Each is a record of about fifteen numbers in
[`tools/art/directions.ts`](../tools/art/directions.ts) — authored
resolution, edge sampling, outline weight, shade depth, rim light, and four
proportion knobs — applied over **one shared bestiary**. The silhouette of
a kind is a fact about the kind, not about the treatment, so all three
directions draw the same shapes and choosing one does not mean redrawing
anything.

**The frames** (in [`docs/art/`](art/), `<direction>-*.png`):

- `*-board-phone.png` — migration 49, a `fast` migration strung through two
  corridors, at the exact pixel size the reference phone shows.
- `*-sheet-phone.png` — migration 50, the Spinosaurus boss, a dinosaur
  selected so the sheet tray is up, and a refusal toast.
- `*-legibility.png` — every dinosaur and every invader at 20px (the real
  cell) beside 36px (the logical cell), with the tell to look for.
- `*-effects.png` — hit, kill, leak, blocked and slow at board scale.
- `toy-box-strikes.png` — the six attack strikes, three steps each, on the
  cell of the adult that throws them (section 5.4.1). Only the shipped
  direction has one, because only it has strikes.
- `kind-hues.png` — the six hues under normal, protan, deutan and tritan
  vision.
- `directions-compared.png` — all three in one picture: eight subjects at
  20px, 36px and 96px side by side, then the same crop of the same board in
  each. The per-direction frames answer "is this legible"; this one is the
  only frame that answers "which of these do I want", because that question
  needs the three held against each other.

**Which frame answers which question.** The board and sheet frames are the
honest record of the product at true size, and at true size the three
directions are much closer than a direction deck usually implies. The
numbers, differencing the committed frames pairwise at a per-channel delta
above 8: the board area disagrees across 6.6-8.2% of its pixels, the sheet
frame's HUD tray across 0.25-0.39% — antialiasing on glyph edges, because no
direction draws the tray — and the legibility sheet's 36px column across
11.3-14.8%, its widest margin, with the note column beside it
byte-identical. So the board and sheet plates are the wrong frames to
*choose* from even though they are the right frames to *ship* against.
Choose from `directions-compared.png`, or from the 36px column of
`*-legibility.png`. The column figures are measured over a box twice the
sprite size centred on the column; the comment on `legibilitySheet` in
`tools/art/build.ts` says why the box is part of the claim.

One pixel in twelve at the real cell is not a rounding error — the choice
is real — but it is small enough that the right instruction is to decide on
taste and quickly.

**One honest caveat on Fossil Pixel.** True pixel-perfect rendering needs
the canvas-to-device scale to be a whole number. FIT onto arbitrary phone
widths gives 0.5417 on the reference device, so this is pixel-art *style* —
hard edges, limited palette, banded shading — resampled once by the
display. It reads well. It will not satisfy someone who wants to count
uniform square pixels.

Nothing downstream of this document depended on which one won. The HUD, the
manifest shape, the audio and the onboarding are all written against the
silhouettes, not the treatment, and none of them changed when Toy Box was
picked. The one thing that did change is 5.0, and it changed because blocks
are the direction that has something to lose by being cropped to its tile.

---

## 3. Colour: six families, and never only colour

### The kind hues

Six kinds need six colours that are still six colours in a 19.5pt cell and
to the roughly 8% of men who cannot separate red from green. These were not
picked by eye. `art:check` simulates all six hues under protanopia,
deuteranopia and tritanopia and measures all 60 pairs; a pair passes only if
hue distance clears 120 **or** lightness contrast clears 1.5, so that
lightness alone can carry it. The current set clears with 23% to spare.

| kind | v1 | M2 was | why it moved |
| --- | --- | --- | --- |
| raptor | `#f4a82a` | `#e0a83a` | brighter, to sit a clear step above longneck |
| tyrant | `#bd2b1d` | `#c0392b` | less orange, so it reads red and not amber |
| armored | `#dbe4e6` | `#95a5a6` | much lighter; it was lost against the board |
| horned | `#8a44c4` | `#8e44ad` | more blue, to clear tyrant under protanopia |
| longneck | `#52a87e` | `#27ae60` | lighter and cooler — the biggest single change |
| flier | `#3ab1ea` | `#3498db` | brighter, to clear armored under deuteranopia |

longneck and flier end up adjacent in hue (151 and 199). That is allowed,
because they are the two most distinct silhouettes on the board — the only
tall one and the only wide one — and the measured pair still passes. For
those two, colour is the second channel and not the first.

This table is a proposed replacement for `KIND_COLOR` in
`packages/game/src/theme.ts`.

**The hues are not what every direction draws.** Those six values are what
the HUD chips and the kind buttons use. Each direction then repaints them —
Clay Pack lightens 14%, Valley Naturalist mixes 22% toward an olive neutral
— and both of those transforms spend the separation margin the search was
run to produce:

| direction | body colours | what fails |
| --- | --- | --- |
| Fossil Pixel | the raw hue | nothing |
| Clay Pack | hue +14% lightness | longneck/flier under tritanopia, d93 |
| Valley Naturalist | hue mixed 22% olive | raptor/longneck under protanopia (d117, just under the 120 line), and longneck/flier under tritanopia, d85 |

`art:check` reports this but does not fail on it, because until a direction
is chosen there is nothing to grade. **It is not a reason to prefer Fossil
Pixel.** The fix is to re-run the same constrained search against the
winning direction's transform and give that direction its own hue table —
roughly an afternoon, mechanical, and much better than flattening all three
palettes toward the one that happens to pass. Whichever vector direction
wins, that task comes with it; this is what it costs.

Dialling the transforms back until they pass was tried and rejected: Clay
Pack needs its lift cut from 14% to 4% and Valley Naturalist its mix from
22% to 8%, which is most of the way to deleting the thing that makes each
one itself.

### The second channel, per axis

| what the player must tell apart | first channel | second channel |
| --- | --- | --- |
| kind | silhouette | hue |
| growth stage | size and added detail | the stage pip count on the sheet |
| archetype | the archetype tell (section 5) | the name in the migration line |
| ownership (mine vs invader) | dinosaurs sit still on a cell; invaders move | invaders carry a hp bar, dinosaurs never do |
| threat (low hp) | bar length | bar colour `#2ecc71` → `#e74c3c` |

### HUD contrast

Every text-on-panel pair the HUD can produce is measured against WCAG AA
body text (4.5:1) by `art:check`. All ten pass. One of them had to move:
M2's `buttonActive` `#3f7a55` put `#ecf0f1` at **4.44:1** — just under. It
is now `#37694b` at 5.57:1. The Send button is the one control a player
reads under time pressure and is not the place to be borderline.

---

## 4. The HUD

Portrait, one-handed, thumb-reachable. The HUD is the bottom **272px** and
the board area is the 1008px above it, which keeps every control in the
bottom third and keeps the grid out from under the thumb.

The direction of that derivation matters. `HUD_H = 272` is the primitive —
three rows that cost 96 + 40 + 136 because of the 82px hit floor — so
`HUD_Y = CANVAS_H - HUD_H` and the HUD does not move to meet a short map.
The grid is centred inside the board area, `GRID_W = 20` is fixed in v1
(the cell every sprite is authored at is `CANVAS_W / GRID_W = 36`), and a
valley may be up to 28 tall.

```
y=0     ┌─────────────────────────────────────┐
        │                                     │
        │   board: 20 x <=28 cells of 36px    │   area 720 x 1008
        │                                     │
        │   toast lives here, y=932, 56 tall  │
y=1008  ├━━━━━━━━━ build timer bar ━━━━━━━━━━━┤   8px, full width
        │ 🍖 214   🥚 14   MIGRATION   SEND  1x│   row 1, 96 tall
        │                  49 / 50             │
y=1104  ├─────────────────────────────────────┤
        │ ▪ NOW  12x Dakotaraptor   fast·raptor│   row 2, 40 tall
y=1144  ├─────────────────────────────────────┤
        │ [raptor][tyrant][armored][horned]... │   row 3, 136 tall
y=1280  └─────────────────────────────────────┘      (the tray)
```

### Row 1 — the vitals, y=1008, 96 tall

| element | box | on the phone |
| --- | --- | --- |
| build timer bar | `0, 1008, 720 x 8` | full width, 4.3pt tall |
| meat icon | `16, 1038, 34 x 34` | — |
| meat value | `60, 1038`, `vital` | four digits before it reaches the egg icon |
| egg icon | `192, 1038, 30 x 34` | — |
| egg value | `230, 1038`, `vital` | — |
| migration label / value | `320, 1034` / `320, 1058` | `label` over `body` |
| **Send** | `444, 1019, 164 x 82` | **88.8 x 44.4pt** |
| **speed toggle** | `622, 1019, 82 x 82` | **44.4 x 44.4pt** |

**The timer is a draining bar, not digits.** A full-width bar across the
seam between board and HUD is legible without being read, which is the
point — during a build phase the player is looking at the grid, not at the
HUD. The digits are not shown at all. The bar is also the early-send
affordance: the amount left *is* the bonus.

Meat and eggs are an icon plus a count rather than a labelled field, for
the same reason. 214 and 14 are read as shapes.

**Every x in the table above is the previous field's widest value, not a
gap that looked right.** Row 1 is five variable-length fields on 720px and
it is the one row in the HUD that can over-subscribe itself silently: a
field grows by a digit, lands on its neighbour, and the HUD renders two
strings on top of each other rather than failing. Measured in the shipping
font at the sizes above:

| field | widest value | width | ends at | next origin |
| --- | --- | --- | --- | --- |
| meat | `9999` at `vital` | 88 | 148 | 192, the egg icon |
| eggs | `20` at `vital` | 44 | 274 | 320 |
| migration | `MIGRATION` at `label` | 108 | 428 | 444, **Send** |

The migration readout is `label` over `body` — two lines at one x — and not
one line, and that is what buys the 16px it clears Send by: on one line
`MIGRATION 49 / 50` is 108 + 77 = 185 before the space between the two
parts, so from x=320 it ends at 505 against Send's origin at 444 — **61px
into the button**. Stacking it is the reason row 1 is 96 tall rather than
the 82 the hit floor asks for.

This is also why there are no timer digits competing for the same band. A
digit field between the migration readout and Send does not fit at any
value: the band from the readout at 320 to Send at 444 is 124px, and the
readout's own widest value takes 108 of it, so the 16 that are left are the
clearance in the table above and not room for a second field. The bar is the
design, and the arithmetic is the second reason for it.

### Row 2 — the next migration, y=1104, 40 tall

One line: a 28px kind chip (hue plus the kind's silhouette), then the count
and the genus in `body`, then the archetype and kind as dim `label`,
right-aligned. This is the only place the kind chart appears mid-run.

It is information, never tappable, so 40px is allowed to sit under the hit
floor. Nothing in this row responds to touch.

### Row 3 — the tray, y=1144, 136 tall

**One tray at a time.** The six hatchling buttons while nothing is
selected; the dinosaur sheet while something is. Swapping rather than
stacking is what buys the hit targets — there is not room for both at 44pt.

It is also the onboarding (section 8): tapping a dinosaur and watching the
shop visibly become a sheet with a **Grow** button is how a player learns
that growing exists, without being told.

**The shop tray.** Six kind buttons, `109 x 120` each with a 6px gap:
`(688 − 5·6) / 6 = 109.6`, floored. That is **59 x 65pt**, comfortably over
the floor. Each carries the kind's silhouette in its hue, the kind name in
`label`, and the hatchling's cost with a meat pip. A button the player
cannot currently afford dims its cost to `textDim` and keeps the
silhouette at full strength — it is still a label, just not yet a purchase.

**The sheet tray.**

| element | box | note |
| --- | --- | --- |
| genus | `20, 1154, 272 wide`, `title` | **never truncated** — see below |
| kind + stage | `20, 1182`, `label` | e.g. `tyrant adult` |
| stat line | `20, 1204`, `body` | damage per second |
| range line | `20, 1232`, `label` | in cells, one decimal |
| **Grow** | `300, 1171, 228 x 82` | **123.5 x 44.4pt** |
| **Sell** | `540, 1171, 164 x 82` | **88.8 x 44.4pt** |

The name column is 272px because that is 15 characters of `title`, and the
two longest genus names in the content — *Argentinosaurus* and
*Rhamphorhynchus* — are both exactly 15. The genus is the collectible; it
is not allowed to be truncated. The buttons moved right until it fit.

**Grow** shows the cost when affordable, dims to `FULLY GROWN` at stage 3,
and dims to the cost when it is not affordable — the player should be able
to read the price of the thing they cannot buy yet. **Sell** always shows
the refund in meat, which is different during a build phase (80%) and
during a migration (60%), so the number itself teaches that juggling costs
something.

### The toast, y=932, 688 x 56

Refusals and events appear **over the bottom of the board**, not in a HUD
row. It costs no layout height, and it puts the message where the eye and
the thumb already are. Left-aligned `body` on a 78%-opaque panel with a
3px `refusal` bar down the left edge for a refusal and no bar for an
event. 1.6 seconds, then a 200ms fade.

Messages are short and say what, not why-not: `That would seal the maze`,
`Not enough meat`, `Solid rock`, `+96 meat`.

### Why the tray is a bottom row, and what the references actually do

The layout above was derived from `MIN_HIT = 82`, not from a reference. That
is worth checking rather than asserting, so here are the four games the genre
points at:

| game | orientation | the buy control | after a place | preview before the tap | an illegal target |
| --- | --- | --- | --- | --- | --- |
| PvZ 1 | landscape | seed bank along the top, fixed, never scrolls | one-shot: the packet greys and recharges | none on touch | the packet refuses; the plant never leaves it |
| PvZ 2 | landscape | seed bank top, boosts along the bottom | one-shot | none on touch | the packet refuses; no mark on the lawn |
| Kingdom Rush | landscape | no tray — a build site is a plus on the map, tapped open into a four-tower radial | the site is consumed | the radial carries cost and range, at the site | the tower greys inside the radial, so the refusal is on the control |
| Bloons TD 6 | landscape | side rail, scrolls and pages by category | one-shot | the tower follows the finger with a range circle, red where illegal | red ghost, drop refused |

**The finding is the orientation column.** Not one of the four is a portrait
phone game. The maul is a PC and landscape genre and its mobile descendants
kept the landscape with it, so there is no portrait precedent to copy — which
is why this layout is derived from the hit floor instead, and why none of the
four has anything to say about one-handed reach. Treat the four right-hand
columns as play notes rather than a teardown; the numbers that bind us are the
ones `tools/art/build.ts check` prints.

Where ours differs, and why:

- **Bottom row, not a top bank.** A top bank is nearly free in landscape,
  where the short axis is short. In portrait the top of 1280 is the least
  reachable part of the screen and the bottom third is the thumb's arc. The
  bank moves to the bottom or the player re-grips on every purchase.
- **It fits; it never scrolls or pages.** BTD6 pages because it has over
  twenty towers. We have exactly six kinds, and six 109px cards with 5 gaps
  of 6 come to 684 — 4px inside the 688 of `CONTENT_W`, which is the width
  the tray actually gets once the 16px gutters are taken off, and 36px inside
  the full 720. The card width is derived from that and not chosen:
  `(688 - 5*6) / 6 = 109.6`, floored — the `ROW3.kindButton` entry in
  `packages/game/src/layout.ts`, whose doc comment is that derivation.
  Fitting is worth more than being able to grow: a scrolling bottom row
  competes with the system's own edge gestures, and a paged tray hides part
  of the kind chart, which is six facts the player is in the middle of
  learning.
- **The gesture bar is cleared by the letterbox, and that is load-bearing.**
  At 390 x 693pt inside a 390 x 844pt screen there is 151pt of letterbox, and
  `Phaser.Scale.CENTER_BOTH` — the `autoCenter` of the game's Phaser config in
  `packages/game/src/index.ts` — splits it 75.5 above and 75.5 below. 75.5pt
  clears the 34pt home indicator, so the tray's bottom edge is not under the
  system swipe. A bottom-aligned canvas would put the lower 34pt of the tray
  — a quarter of a 136px row — inside the gesture area. The centring is a
  requirement, not a default we happen to have.
- **One tray at a time, where Kingdom Rush uses a radial.** A radial at the
  tapped cell is the one idea here that beats a tray on reach, because the
  control arrives where the finger already is. It loses on our cell size: at
  19.5pt a radial anchored to a cell covers the four cells the decision is
  about, and within two cells of any board edge it has nowhere to open. KR
  affords it because a build site is a fixed landmark with space around it,
  and because it shows four towers rather than six kinds with a cost and a
  silhouette each.
- **The sheet swaps into row 3; it is not a bottom sheet.** A sheet over the
  tray is the Material default and it costs exactly what row 3 was bought
  for: 44pt of controls plus a sheet puts the HUD over 400px and the board
  loses three rows of cells. Swapping is also the onboarding (section 8,
  step 7).

The two tray states, in the same idiom as the sketch above:

```
         nothing selected
y=1144  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    row 3 starts
y=1152  ┌─────┬─────┬─────┬─────┬─────┬─────┐   six cards, 109 x 120,
        │ rap │ tyr │ arm │ hor │ lon │ fli │   6px gaps, inset 8 in the row
        │  10 │  25 │  20 │  20 │  30 │  15 │   hatchling cost in meat
y=1272  └─────┴─────┴─────┴─────┴─────┴─────┘

         raptor selected
y=1144  ┏━━━━━┓─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    the border stops exactly on
y=1147  ┃ rap ┃─────┬─────┬─────┬─────┬─────┐   the row line: the card lifts
        ┃  10 ┃ tyr │ arm │ hor │ lon │ fli │   5, the border is 3, and the
        ┗━━━━━┛─────┴─────┴─────┴─────┴─────┘   card was 8 inside the row
```

That is drawn, not described: `docs/art/toy-box-board-phone.png` is the frame
at 390 x 693pt with the raptor selected, and `art:verify` holds it to the
generator.

### The interaction model: tap to select, tap to place

Settled by the owner on 2026-10-05: **a tap selects a kind, a tap on a cell
places it, and dragging does nothing.** Drag-to-paint is gone because it
mis-places on a phone — a fast finger skips cells and the interpolation that
covers for it places dinosaurs the player did not aim at. Section 10 of
`docs/00-proposal.md` carries the reversal and the three lines it corrected.

Everything below is a number or a state, so that it can be built from without
a follow-up question.

**The two selections are different things and are mutually exclusive.**
`selectedDef` is *a kind to place*; `selectedDino` is *a placed dinosaur being
inspected*. Tapping a card sets the first and clears the second; tapping a
placed dinosaur sets the second and clears the first. Row 3 shows the shop
while `selectedDino` is null and the sheet while it is not — so selecting a
card does **not** swap the tray, and dismissing the sheet does **not** restore
a kind selection the sheet replaced.

**A run starts with nothing selected.** Pre-selecting a kind — `buildHud`
ending in a `selectDef` call — contradicts onboarding step 2, where the player
taps the lit raptor *because it is the only thing that looks tappable*, and it
means a first stray tap on the board spends 10 meat the player did not mean to
spend. Both selections start null and both are reset in `create()`, because
`scene.restart()` re-runs it.

**The selected card.** Three channels, none of them hue:

| channel | rest | selected |
| --- | --- | --- |
| position | `y = 1152` (`ROW3.kindButton.y`) | `y = 1147` — a 5px lift |
| outline | none | 3px `#ecf0f1`, the whole card |
| silhouette | 56px | 60px — 1.08 |

Both numbers are derived rather than picked, and they are `SELECT_LIFT` and
`SELECT_BORDER` in `tools/art/layout.ts`. The border is 3 because that is the
weight of the ring a selected *dinosaur* already takes on the board. The lift
is 5 because the card sits 8px inside its row and 5 + 3 is 8, so the border
stops exactly on `ROW3.y` instead of crossing into the migration line.

The border is the HUD's lightest token on `hud` `#0f1712`, which is
**15.9:1** — `#ecf0f1` in `theme.ts` and its Toy Box equivalent `0xf6f3ea` in
the frame generator. Matching the board's selection ring — the outline
`drawDynamic` strokes around the selected dinosaur's cell — is deliberate: a
player should learn one selection convention, not two. The card's interior
does not change at all, which is also deliberate — every text-on-panel pair in
section 3's contrast table stays exactly as measured.
Under `prefers-reduced-motion` the lift is a static offset and not an
animation: it is state, not feedback (section 7).

**The selection does not survive the placement.** Settled by the owner on
2026-10-05: **one-shot, the PvZ-exact behaviour.** A successful place returns
the card to rest, so every dinosaur is two taps — tap the card, tap the cell —
and a stray tap on the board after a place costs nothing, which is the reason
the owner gave. It is also what every reference in the table above does.

The cost was modelled before the answer, and the model is kept here because it
is the record of what one-shot is priced at. Against the 30-second build timer,
with Fitts's law in the Shannon form, `MT = a + b·log₂(D/W + 1)` (`a = 0.2s`,
`b = 0.15 s/bit`), over 381pt between the tray and mid-board. The form is worth
naming because it changes the answer: the older `log₂(2D/W)` gives 25.9s for
one-shot rather than 22.1s. The targets are measured along the direction of
travel, which is vertical: a card is 65pt tall and a cell 19.5pt.

The two rows below are that formula applied twice, so a reader can recompute
them: sticky — the rejected alternative, where the card stays selected — is
one trip to the card plus fifteen cell-to-cell hops,
`MT(381,65) + 15·MT(19.5,19.5)`; one-shot is fifteen round trips,
`15·(MT(381,65) + MT(381,19.5))`.

| a 15-cell wall | taps | thumb travel | time | of the build timer |
| --- | --- | --- | --- | --- |
| sticky, rejected | 16 | one trip down | **5.9s** | 20% |
| **one-shot, shipping** | 30 | 15 round trips, ~2.1 m | **22.1s** | 74% |

One-shot does not merely double the taps. It adds fifteen round trips across
the longest distance on the screen, each one re-aiming at a 65pt card and then
at a 19.5pt cell, and it spends three quarters of the build phase on travel.
PvZ can afford it because a level is six plants; a maul wall is fifteen.
Modelled, not measured — the measurement is a drive of the real client at
720 x 1280.

**What one-shot costs the rest of this subsection.** Three things, and nothing
else here moves:

- **The card returns to rest on a successful place** — the lift, the outline
  and the 1.08 silhouette all drop back to the rest column of the table above,
  and the preview stops with them.
- **Cancel is no longer the only way out of a held selection.** It covers the
  window between selecting a kind and spending it, which is a real window — a
  player who taps a card and then changes their mind still needs a way out, and
  the board must not be it. After a place there is nothing to cancel.
- **Nothing replaces "wall fast."** The extra taps are the accepted cost, not
  an oversight; see the end of this section.

**The preview on the target cell, and why touch cannot have the web one.**
`game.placeRefusal(defId, x, y)` is a pure query, so a preview is allowed to
be *truthful* rather than hopeful: the client knows before the commit whether
the cell would refuse and why.

| state | what is drawn |
| --- | --- |
| valid cell | the kind's hue at 0.45 in a rounded rect inset 3px, radius 6, plus a 1px `#ffffff` range ring at 0.35 |
| invalid cell | `refusal` at 0.45 in the same rect, **plus diagonal hatching: 3px stripes of `ink` at alpha 1, stepped 8px**, and no range ring |
| any tap, the instant it lands | a 2px `#ecf0f1` ring at 0.6 from the cell centre out to a **54px radius**, 120ms, then gone — drawn on `pointerdown` before the sim is called |

The hatching is not decoration: it is the second channel for a *state*, which
section 3's rule covers as much as it covers kinds, and section 8 step 5
already promises it by name ("the blocked hatching").

**The three hatching numbers, and why the contrast ratio is the wrong
instrument for two of them.** Hatching in `refusal` makes the stripe and the
fill one hue at two alphas, so the only thing separating them is whatever the
cell already carried — and spawn, both checkpoints and the nest carry a bright
marker that lifts the fill to the stripe's own luminance and erases the
hatching outright. Those four cells always refuse and are the landmarks a new
player tries first, so they would be refusing by hue alone, which is the one
thing this hatching exists to prevent. The stripes are therefore `ink` at
alpha 1: a fixed dark that the cell underneath cannot climb to.

The other two numbers are a stripe width and a spacing, and they do not move
a contrast ratio at all. The window below is **the 30x30 hatched square, the
cell inset by its own 3px** — the rect `hatchCell` is handed, nothing else —
at 720x1280, 10th/90th percentile, driven against the real client. State the
window whenever one of these numbers is quoted: a figure of 1.56:1 for the
same 2px configuration came off a different one, and the two have never been
reconciled. Neither is above 3:1 and neither changes the ranking, because the
ranking does not come from this column at all.

| stripe / step / fill | contrast, plain cell | texture, plain cell |
| --- | --- | --- |
| 2px / 8 / 0.45 | 2.28:1 | 61% |
| **3px / 8 / 0.45** | **2.28:1** | **81%** |
| 2px / 6 / 0.45 | 2.28:1 | 74% |
| 2px / 8 / 0.60 | 2.81:1 | 64% |

Once at least a tenth of the cell is solid ink and a tenth is solid fill, the
percentile ratio is a property of the two colours and nothing else — it is
identical for the first three rows, which differ by a third in how much
texture they actually have. The number that tracks what an eye sees is the
**RMS luminance modulation across the cell interior**, the second column, and
it is what governs the hatching here.

So:

- **3px, not 2.** At the reference device a canvas pixel is 0.5417pt, so a 2px
  stripe is 1.08pt — barely over one device pixel at DPR 1, so most of its
  width is spent on the two antialiased edges and little of the ink lands at
  full strength. 3px is 1.63pt and keeps a covered core. The measurement is
  the claim, not the pixel arithmetic: 57% against 76% at the reference
  device. This is the strongest of the three levers and the only one that is
  free — it changes no colour and no alpha.
- **8px spacing stays.** The gap of fill must stay strictly wider than the
  stripe, or the cell reads as a darker flat tone rather than as stripes; at
  3/8 the gap is 5px to the stripe's 3. Tightening to 6 instead buys less
  texture than widening the stripe does (74% against 81%) while adding a third
  more stripes, and at 1x it reads as noise rather than as hatching.
- **The fill stays at 0.45.** It is the same rect at the same alpha as the
  valid preview, which is what makes the two states a comparison rather than
  two unrelated marks, and it is the only thing still letting the player see
  the terrain they are deciding about. It is also, measured, the weakest of
  the three levers: it moves the ratio the most and the texture the least.

At the reference device the 3px figure holds: 76% at 390x693 DPR 1 and 76% at
DPR 3, against 57% for 2px at either. The hatching is one of three channels on
a refusal — the toast and the cell flash are the other two — but at 3px it is
a channel a player can actually use rather than a supporting one.

**The hover preview is mouse-only, and that is not a gap.** A finger has no
hover — its first contact with a cell is the tap. Gating the placement on
`pointerup` so a preview could be shown in between would re-create the thing
the owner removed: a commit that depends on where the finger *ends*. So on
touch the placement commits on `pointerdown`, inside the 400ms Doherty
threshold, and the committed sprite is the preview. What the ring in the third
row buys is the one thing the committed sprite cannot say: that the tap was
*registered*. Without it, a refused tap and a dropped tap look identical, and
"nothing happened" is the worst feedback the game can give.

**The finger covers the answer, so the answer cannot be in the cell.** A cell
is 19.5pt, which is **3.6mm**; a thumb contact patch is 8 to 10mm. The finger
covers the tapped cell and most of its neighbours, and it stays there for as
long as the player is placing. That is why the tap ring is 54px — 1.5 cells —
rather than drawn inside the cell: a mark the size of the thing being tapped is
invisible by construction, and the ring has to be wider than the hand to be
seen at all. It is also why the confirmation of a *successful* place is not on
the board: the **meat count stepping down in row 1, with its pip**, is the
off-finger truth, and the refusal toast sits at `y=932` for the same reason.
Both are above the thumb in a one-handed grip and both outlive the lift — the
toast by 1.6 seconds.

**A refusal gets three channels, and that is enough. Each one is located at
the cause.** `tryPlace()` flashes the cell and toasts `REFUSAL_TEXT[r]` —
`That would seal the maze`, `Not enough meat`, `Solid rock`. That is the cell
plus the toast plus the hatching, and **the selection always survives a
refusal** — the one case where the card stays selected, because the tap bought
nothing, and a card that cleared itself on a refusal would charge the player
two taps for the game saying no. On `no-meat` the *card's* cost also flashes
`refusal` once, because that refusal is not the cell's fault: the card is where
the problem is and where the fix is. Feedback goes where the cause is,
not where the finger was. The card never flashes for `would-block` or `rock`.

A refusal on a sealed maze is the one refusal the game *wants* the player to
reach — onboarding step 5 is built on it — so it is never pre-empted by
greying cells out. Terrain is the exception, because rock and water already
look unbuildable: a tap on one refuses with `Solid rock` rather than
cancelling.

**Cancel.** Two ways, both of which must exist. Under one-shot they cover the
window between selecting a kind and spending it rather than an indefinitely
held selection, which makes them smaller but not optional: the card is armed
and costs meat the moment a cell is tapped.

- **Re-tap the selected card.** It returns to rest, the preview stops.
- **Tap empty space,** which means precisely: anywhere in the board area with
  no grid cell under it, or any HUD background that is not a control. The grid
  is centred in the board area, so with a valley shorter than 28 the dead
  bands are `y < gridTop` and `y >= gridTop + height·36` — 72px each for a
  24-tall valley, 0 for a 28-tall one. At `GRID_W = 20` the grid is the full
  720 wide, so there is never a side band. Controls stop propagation and so
  never cancel; the toast strip is not interactive and does.

A cell inside the grid never cancels: it places, or it refuses. Starting a
migration does not cancel — mazing continues during one, and a selection
silently lost at the phase change would be read as a dropped tap.

**Sell, and the end of long-press.** The proposal originally promised
long-press to sell and no longer does — `docs/00-proposal.md` now records it as
dropped, in its Controls paragraph and again in section 10. The reason is not
that drag is gone:

- a long press is 500ms, and a deliberate thumb tap on a 19.5pt cell can
  cross that, so the gesture mis-fires on exactly the careful player;
- it is destructive, unconfirmed and undiscoverable, which is three strikes
  for one hidden gesture;
- Sell already exists as an `88.8 x 44.4pt` button on the sheet, one tap from
  tapping the dinosaur, and it shows the refund — which is the number that
  teaches that juggling costs something.

Nothing replaces it. The board keeps exactly two gestures: tap, and pinch to
zoom.

**Nothing replaces the "wall fast" feel, and that is a priced decision rather
than an oversight.** The owner was shown the arithmetic above and chose
one-shot anyway, accepting **30 taps, ~2.1 m of thumb travel and 22.1
seconds — 74% of the 30-second build timer — for a 15-cell wall**, in exchange
for a board on which a stray tap after a placement costs nothing. That
exchange is the record: a reader who finds the cost surprising is looking at a
number that was on the table when the call was made.

No repeat affordance is proposed to claw it back. Every version of one buys
taps back by letting a single gesture commit several placements, which is the
property the owner rejected, and the cost of drag was never the taps in the
first place: a maul build phase is a slow, deliberate, re-planned thing, and
the only reason drag felt fast was that it let one gesture commit fifteen
decisions. Fifteen decisions is the game.

The 22.1s is modelled. If a drive of the real client at 720 x 1280 shows that
a wall of that length cannot in fact be finished inside the build timer, that
is a measured finding against a priced decision and it earns its own issue —
it is not a licence to re-open this one on the model alone.

---

## 5. The sprite manifest

### What v1 needs

| group | frames | authored size | note |
| --- | --- | --- | --- |
| dinosaurs | **18** | `spritePx` square | 6 kinds x 3 stages |
| invaders | **54** | `spritePx` square | 9 archetypes x 6 kinds |
| bosses | *included above* | `2 x spritePx` | the `boss` archetype row |
| terrain | 5 | 36 square | board, rock, water, spawn, nest |
| checkpoint badges | 2 | 28 square | `1` and `2` |
| effects | 5 | see 5.4 | hit, kill, leak, blocked, slow |
| HUD glyphs | 4 | 34 square | meat, egg, speed, kind chip mask |
| **total** | **88** | | |

`spritePx` is 36 for Fossil Pixel, 48 for the two vector directions and 64
for Toy Box. The atlas is packed at the authored size and the renderer scales
down into the 36px cell, so a swarm invader is small because its *silhouette*
is small, not because its sprite is.

### 5.0 The anchor: a dinosaur occupies one cell and is drawn taller than one

**Footprint and draw box are different things, and only the footprint is the
sim's.** A dinosaur occupies exactly one cell — pathing, the block check,
range and every balance number unchanged — and is *drawn* into a box taller
than that cell.

| | value | why |
| --- | --- | --- |
| footprint | 36 x 36 (1 cell) | the sim's, unchanged |
| draw scale | the **authored square** scaled to **1.25 cells** — a 45px box for Toy Box's 64px square, `DRAW_CELLS` in `tools/art/layout.ts`. Uniform: one scale for every frame in the atlas | room for a solid to stand proud of its tile, capped where twenty adjacent cells stop reading. Uniform because growth stage has to read as *size* — see below |
| anchor | the **ink's** bottom edge on the **bottom edge of the cell**, the ink centred horizontally on the cell | feet on the floor of the cell the sim thinks it is in |
| draw order | **by row, increasing y**, then **increasing x** within a row | the overlap reads as depth rather than as a z-fight, and the same wall rebuilt draws the same picture |
| tiles | every block painted before any animal | a sprite overhangs the cell behind it, so a tile painted later erases the feet of the one in front |

**The anchor is on the ink, not on the authored square**, and that is not a
detail. The camera centres its subject in the square, so the gap below the
feet is a function of growth stage: measured on Toy Box, 18px under a
hatchling raptor against 2px under an adult longneck, out of 64. Anchoring
the square would float the hatchling half a cell above the floor of the cell
it is standing in. The shipped atlas is trimmed to the ink for exactly this
reason — see 5.5, where it turns into one line of client code.

**Why 1.25 and not 1.5.** 1.5 was the first answer and it was argued rather
than rendered. The argument was about vertical occlusion only: every kind's
tell is in its upper half, so losing the feet to the animal in front is
survivable. That is true, and it is silent about the sideways case. At 1.5
the widest adults — `flier-3` is 60px of ink in a 64px square — also reach
about 7px into each horizontal neighbour, and a 5x4 block of occupied cells
at the phone's true 19.5pt cell reads as one pile instead of as twenty
dinosaurs. Rendered at 1.0, 1.15, 1.25, 1.35 and 1.5 and chosen by looking:
**1.25 is the largest value where that block stays separable.** At 1.25 the
widest adult draws 42.2px into a 36px cell, so the horizontal reach is 3.1px
a side; at 1.35 it is 4.8px and at 1.5 it is 7.3px.

**The binding constraint is sideways, not upwards**, and the measurements
below are why. 1.25 buys very little height — two frames of eighteen clear
their own cell — while costing 3.1px a side on the widest. 1.0 would be a
different game only in that nothing stands proud at all, and 1.5 is a pile.
A later proposal to raise it has to answer the horizontal column, because
that is the one that moves.

**Why at all.** Standing taller than the tile is part of how the reference
game reads as blocks, and without it a block dinosaur is cropped to a 19.5pt
square on a phone — solidity is the first thing that cell takes away, which
is the finding in section 2. Be honest about how much of the work it does
here, though: at 1.25 it is the *tall* genera that gain, and the rest of the
read comes from the fixed isometric camera and the three flat face tones.
Enlarging the *cell* instead would buy more of it, for a re-tune of all 50
migrations against a quarter of the board; this costs nothing the sim can see.

**`DRAW_CELLS` is a scale denominator, not a drawn height.** 1.25 cells is
the size of the *box* the authored square is scaled into. The ink does not
fill that square — **in height** it is 42 to 60 pixels of 64 across the six
adults and 28 to 40 across the hatchlings, because the camera leaves room for
the tallest model — so the drawn animal is always shorter than 45px, and by
how much is a property of the genus and the stage. The width range is a
different pair of numbers — 44 to 60 of 64 for the adults — and it is the one
that binds, as the paragraph above says. Measured through the shipping draw
path at Toy Box, adults in a 36px cell:

| adult | drawn | past the cell top |
| --- | --- | --- |
| longneck-3 | 30.9 x 42.2 | **+6.2** |
| flier-3 | 42.2 x 38.0 | **+2.0** |
| tyrant-3 | 35.2 x 35.2 | −0.8 |
| armored-3 | 38.0 x 35.2 | −0.8 |
| horned-3 | 33.8 x 32.3 | −3.7 |
| raptor-3 | 36.6 x 29.5 | −6.5 |

Hatchlings draw 19.7 to 28.1px tall in the same 36px cell. **That spread is
the point and it is why the scale is uniform**: a hatchling has to read as a
smaller animal than an adult, and normalising each frame to its own ink would
delete the one channel that carries growth. The cost is that the two numbers
it is tempting to quote are both wrong — *every* dinosaur is not drawn 1.25
cells tall, and four of the six adults are not drawn proud of their tile at
all.

**So the occlusion is much smaller than the box suggests.** Only
`longneck-3` and `flier-3` cross their own cell's top edge, by 6.2px and
2.0px — not the 9px of the box — and nothing else in the eighteen frames
crosses it. Where it happens, what is covered is the *lower* part of the cell
behind, where the dinosaur behind is standing.

That is survivable, and not by luck: every one of the six silhouettes is
identified by its *top* — the tyrant's oversized head, the longneck's
vertical neck, the horned frill, the armoured hump, the flier's span, the
raptor's forward-carried head. Section 5.1's tells were written against the
upper half of the animal before this question was asked. A direction wanting
more height has to justify it against the row behind **and** against its
horizontal neighbours, which is the half that 1.5 failed.

**Tested at the true cell size, not argued:** a 5x4 block of occupied cells —
twenty adjacent dinosaurs, every kind and every stage — rendered through the
shipping draw path at 1x and downsampled to the reference phone. Kind stays
separable at 1.25 and does not at 1.5. That is what set the cap.

**Still acceptance for the integration, and only testable by driving the
client:** that a *placement preview* stays legible under a neighbour's
overhang, and that the committed sprite reads on the cell the player tapped
while the thumb is still over it — the tap commits under the finger, so the
one cell the player cannot see is the one they just bought. Neither is a
property of the atlas, so neither can be settled here.

### 5.1 Dinosaurs — six silhouettes, learned in one run

Each stage is a different real genus, so growing is also a small
collection. The silhouette is constant within a kind and grows in mass and
detail across stages; the player should recognise the kind at a glance and
the stage on a second look, in that order.

| kind | hatchling → juvenile → adult | the silhouette, at 20px |
| --- | --- | --- |
| raptor | Velociraptor → Deinonychus → Utahraptor | a low horizontal dash: stiff tail out behind, head carried forward |
| tyrant | Tarbosaurus → Daspletosaurus → Tyrannosaurus | top-heavy: the head is a third of the animal, over a deep body |
| armored | Nodosaurus → Euoplocephalus → Ankylosaurus | a wide low hump with a detached-looking ball on the tail |
| horned | Protoceratops → Styracosaurus → Triceratops | a disc broken by one forward spike |
| longneck | Diplodocus → Brachiosaurus → Argentinosaurus | the only tall one: a vertical neck with the head at the cell top |
| flier | Rhamphorhynchus → Pteranodon → Quetzalcoatlus | the only wide one: a swept chevron with a long beak |

Those six descriptions are the acceptance criteria, not flavour. If a
reviewer cannot pick the kind out of `*-legibility.png`'s 20px column using
only the sentence, the sprite is wrong. They live in
[`tools/art/bestiary.ts`](../tools/art/bestiary.ts) as
`KIND_SILHOUETTE_NOTE` and the legibility sheet prints them beside the
sprite they describe.

**On rule 5.** These are paleontological silhouettes. *Deinonychus* and
*Utahraptor* are drawn feathered, because the fossils say feathered, which
also happens to be the clearest way to make them not read as the movie
animal. *Dilophosaurus* is not in v1 at all. No raptor is drawn in a pack
of three stalking anything. The horned line's frill is a disc because
*Protoceratops*' frill is a disc.

### 5.2 Invaders — archetype first, kind second

There can be sixty of them and they are smaller on screen, so they get
simpler shapes than dinosaurs. The archetype owns one unmistakable tell;
the kind is carried by hue and by a reduced version of the kind
silhouette.

| archetype | the tell |
| --- | --- |
| normal | plain bipedal herd animal, no tell — the baseline the others differ from |
| fast | leaning forward past its feet, with three trailing streaks |
| tank | twice as wide as tall, four shoulder plates |
| flying | a chevron, drawn over a ground shadow so height reads |
| swarm | half size, and never alone |
| splitter | a visible seam down the body: it is already two animals |
| regenerator | a bright chevron on the flank that pulses with the regen tick |
| shielded | a bracket plate held in front, drawn in front of the body outline |
| boss | two cells wide, a crown of spines, and its own shadow |

The flying tell is the one that must not fail: a flying migration ignores
the maze entirely, and a player who does not notice loses eggs to a rule
they did not know applied. The ground shadow is drawn **separately and
below** so that height reads even when the chevron is over a dark cell.

### 5.3 Bosses

Five, at migrations 10, 20, 30, 40 and 50: *Giganotosaurus* (tyrant),
*Argentinosaurus* (longneck), *Quetzalcoatlus* (flier), *Tarchia*
(armored), *Spinosaurus* (tyrant). Each is the `boss` silhouette at 2x in
its kind's hue, which is why the boss costs six frames rather than five —
the atlas carries one per kind and the content names it.

A boss leak eats five eggs, so the boss is the one invader allowed its own
ground shadow and its own kill effect.

### 5.4 Effects

Five, and they are deliberately different weights. Feedback that is uniform
is noise.

| effect | what it is | size | duration |
| --- | --- | --- | --- |
| hit | a 2px tapered line from the dinosaur to the target, in the dinosaur's hue | 1–3 cells | 80ms |
| kill | a 24px expanding ring in the kind hue, plus a meat pip that rises 18px and fades | 1 cell | 260ms |
| leak | a 40px ring in `refusal` around the nest, egg count flashes | 1 cell | 420ms |
| blocked | the refused cell fills with 45° `refusal` hatching, no movement | 1 cell | 200ms |
| slow | a `#74b9ff` ring around the slowed invader, held while the debuff lasts | 1 cell | held |

A kill is small and constant. A leak is sharp and the egg count is the
thing that moves. A boss leak is the only effect allowed to touch the whole
screen: a 120ms `refusal` vignette at 30% and five egg pips falling.

Blocked placement does not animate the dinosaur at all, because the
placement did not happen — animating it would say that it nearly did.

### 5.4.1 The attack strike: the hit says which kind is hitting

The `hit` row above is a tracer in the dinosaur's hue and nothing else, and
on a live board that is one shape for all six kinds with the colour doing
all the work. The owner looked at the demo and said so: *"the elemental
factors does get reflected well with the color, but the attack animation
sprite will need to properly reflect this."* Colour is never the only
channel — section 3 holds that line for the dinosaurs themselves and the
attack effect was the place it was not held.

So `hit` is two things, with one job each:

| layer | says | where it is drawn |
| --- | --- | --- |
| the tracer | *which invader* is being hit | from the dinosaur to the target, 1–3 cells |
| the **strike** | *which kind* is hitting | on the dinosaur's own cell, never pointed |

The strike is not pointed at anything, and that is deliberate. An isometric
block render cannot be rotated without reading as a second camera, and the
tracer already carries the direction. Splitting the two is what lets the
strike be a fixed silhouette the player learns once.

**Six strikes, six silhouettes.** Each is the animal's own weapon, taken
from the palaeontology and not from a film — rule 5 — and the shapes were
chosen so that shape alone separates them at a 36px cell with sixty
invaders on the board:

| kind | strike | the silhouette | the motion |
| --- | --- | --- | --- |
| tyrant | bite | two converging wedges | closes along the facing, horizontal |
| longneck | stomp | a slab and a flat ring | drops, then goes out radially |
| horned | horn charge | one long thin spike | thrusts along the facing, the longest reach |
| raptor | leap | a stepped crescent | arcs up over the animal and hooks down |
| flier | dive | a narrow dart | descends steeply from above the cell |
| armored | tail club | a ball on a stalk | sweeps across the facing, laterally |

A V, a ring, a line, an arc, a diagonal and a ball. No two of them are the
same shape at any size, which is the same bar section 3 sets for the kind
hues and the same reason the kinds have six silhouettes of their own.

**Hue stays the kind channel it already is.** A strike is drawn in the
palette of the dinosaur throwing it, so the kind is now carried three ways
at once — hue, the animal's silhouette, and the strike's — and none of them
is doing it alone.

**Three steps, and the third never holds the weapon.**

| step | what it is | why |
| --- | --- | --- |
| 1 | the wind-up | shows where the weapon was, so the strike has somewhere to come from |
| 2 | full extension | the frame that reads; the one a player actually sees at speed |
| 3 | the mark left behind | dust, a lit seam, a ground crack — never the weapon |

Step 3 holding no weapon is the rule that keeps the clip from looking like
it rewinds when the client holds the last frame while the effect fades.

**The client's contract**, in full, with no input but the atlas and the cell
the sim gives you. It is the dinosaur's own rule from 5.5 with one line
changed, because a strike is anchored on the cell rather than on a pair of
feet:

```ts
const { authored, cell, drawCells } = strikes.meta;  // 64, 36, 1.25
sprite.setOrigin(0.5, 0.5);                          // the cell centre
sprite.setScale((cell * drawCells) / authored);      // 45/64, a dinosaur's own scale
sprite.setPosition(cellX * cell + cell / 2, cellY * cell + cell / 2);
```

Frame names are `strike-<kind>-<step>`, so the clip is
`generateFrameNames({ prefix: 'strike-tyrant-', start: 1, end: 3 })` and
nothing is looked up. Play the three steps across the effect's life and
fade on the last; **never gate the hit behind the clip** — the damage has
already happened in the sim, and the strike is drawn over the committed
state exactly as a placement animation is.

Timings, and they are the `hit` row's 80ms spent rather than added to:

| step | held |
| --- | --- |
| 1 | 50ms |
| 2 | 90ms |
| 3 | 120ms, fading to zero alpha |

Under reduced motion (section 7) the clip does not play: step 2 alone is
drawn for 90ms and fades. It is the frame that carries the kind, so the
information survives and the movement does not.

The plate the client implements against is
`docs/art/toy-box-strikes.png`: all eighteen frames at board scale, each on
the cell of the adult that throws it, drawn with the four lines above and
not with a layout invented for the picture. A strike alone cannot be judged
— the question is whether the shape still reads on top of the animal.

**What this does and does not settle.** The attack effect is in v1. Idle
breath and walk cycles are still not — see section 10 item 3, which this
narrows rather than repeals.

### 5.5 The atlas

Three atlases, Phaser JSON Hash format, shelf-packed by descending height
into a 512px width with 1px padding. **Only the chosen direction is
shipped**; `npm run art:atlas` writes it, and
`tools/art/build.ts atlas <direction>` will write any of the four for a
comparison. Which one is chosen is `CHOSEN` in `tools/art/directions.ts` and
nowhere else, so the atlas command and the border check below cannot
disagree about it.

```
packages/game/assets/toy-box/dinos.png    + dinos.json
packages/game/assets/toy-box/invaders.png + invaders.json
packages/game/assets/toy-box/strikes.png  + strikes.json
```

Frame names are `<kind>-<stage>`, `<archetype>-<kind>` and
`strike-<kind>-<step>`, all lowercase, so the client can build a frame name
from sim state without a lookup table.

`strikes` exists only for a `blocks` direction and the three archived ones
have two atlases, not three. They are the record of how the choice was made
and nothing in them is in an atlas, so the honest answer for them is that
they have no strikes rather than a half-converted one.

What keeps those four files current is `tools/art/test/assets.test.ts`, which
`npm run check` runs: the committed PNG's pixels and the committed JSON's text
must be what the generator produces today, and a file under a direction's
asset folder that the generator does not produce fails too. So a change to
`sprites.ts`, to a palette or to `CHOSEN` is red until `npm run art:atlas`
has been run and the result committed. Nothing else would catch it — the
board frames in `docs/art/` blit the in-memory sprite, so they agree with the
code whether or not the atlas does.

**Dinosaur and invader frames are trimmed to the ink**, and are declared as
untrimmed frames whose `sourceSize` is the trimmed size. That is deliberate, and it is the whole
reason 5.0's anchor costs the client one line: Phaser resolves `setOrigin`
against `sourceSize`, so a frame that claims to have been authored at its own
ink size puts `setOrigin(0.5, 1)` exactly on the animal's feet. Declaring
`trimmed: true` and carrying the offset would be the same pixels and would
move the origin back off them.

**Strike frames are the one set packed untrimmed**, and for the opposite
reason. Trimming answers "where is the animal" by throwing away the answer
to "where in the cell was this drawn", and for an attack effect that second
question is the whole content of the frame: the club swings out to one side,
the dive comes down from above, the stomp's ring goes out past the cell on
all four sides. Trimmed, the three steps of a swing would be centred on top
of each other and the swing would be gone. So a strike frame is the full
128px square — `STRIKE_FRAMES` authored squares on a side, exactly as the
boss is — the client's anchor is the square's own centre, and the cost is
transparent pixels, which is what PNG compresses best: 12.4 kB for all 18.

The scale's denominator therefore cannot come from the frame, so it is in
`meta`, per atlas rather than per frame:

| `meta` key | Toy Box | what it is |
| --- | --- | --- |
| `authored` | 64 | the direction's `spritePx` — the square the sprites were drawn at, before trimming |
| `cell` | 36 | the logical cell, `CELL_PX` |
| `drawCells` | 1.25 | 5.0's draw *box*, in cells. Not how tall a dinosaur comes out |

`authored` is the direction's own number, passed in. It must never be derived
from the packed frames: the invaders atlas genuinely mixes two authored
squares, because the boss is rendered at `spritePx * 2`, so a `max` over its
frames reports 128 for an atlas whose other 46 frames were drawn at 64 — and
a client reading that draws every non-boss invader at half size. Before
trimming, a frame's own `w` *was* its authored square, so this could not be
got wrong; trimming removed the only per-frame record of it.

**Placing a dinosaur, in full**, with no other input than the atlas and the
cell the sim gives you:

```ts
const { authored, cell, drawCells } = atlas.meta;
sprite.setOrigin(0.5, 1);                       // feet, horizontally centred
sprite.setScale((cell * drawCells) / authored); // 45/64 for Toy Box
sprite.setPosition(cellX * cell + cell / 2, cellY * cell + cell);
sprite.setDepth(cellY * GRID_W + cellX);        // row, then x within the row
```

**Invaders are not anchored** — they are not in a cell and they move
continuously — so they are drawn centred on their interpolated position, and
the only question is the size:

```ts
const { authored, cell } = atlas.meta;
const cells = archetype === "swarm" ? 0.8 : 1;   // the boss is NOT 2 here
sprite.setOrigin(0.5, 0.5);
sprite.setScale((cell * cells) / authored);
```

**The boss takes no multiplier against this atlas, and that is the one trap
in the file.** Its sprite is authored in a square twice the size and holds an
animal twice the size, so the uniform scale already draws it at two cells —
36/64 and 72/128 are both 0.5625. `swarm` is the real multiplier: authored at
one square like everything else and genuinely drawn smaller. The board frames
in `docs/art/` apply 2x to the boss because they blit the *untrimmed* square,
where the two cancel; copying that rule onto the trimmed atlas draws a boss at
four cells. `INVADER_BOX_CELLS` and `INVADER_FRAMES` in `tools/art/sprites.ts`
carry both halves, and `tools/art/test/atlas.test.ts` asserts that the scale
above reproduces the board frames for all 54 invader frames.

**A strike is the same trap as the boss, in the same direction.** Its frame
is two authored squares wide and `meta.authored` is still 64, because the
double frame buys reach at the dinosaur's own world scale rather than
drawing the effect twice as large. Read the frame's own 128 as the
denominator and every strike comes out at half the size of the animal
swinging it. `strikeFit` in `tools/art/sprites.ts` is what makes the two
world scales equal, and `tools/art/test/atlas.test.ts` asserts it both ways:
that the client's rule gives a strike a dinosaur's scale, and that every
strike frame is still the whole square.

**Nothing may touch the edge of its authored square.** `art:check` measures
every one of the 90 frames in a direction against its own border and fails
the build for the shipped direction. The strikes are the frames most able to
fail it: `project`'s screen `v` is `(x + z)/2 - y`, so height in the model
costs twice what reach does, and the flier's wind-up was authored above
y = 1 and clipped off the top of its own square until the check said so.
Trimming is not a safety net: `pack`
trims to the ink that survived, so the authored square is a working area and
a pixel on its edge is a pixel that was thrown away — usually the outline,
which is why it is nearly invisible and worth asserting rather than looking
for. Toy Box is clear on all 72.

The three archived directions are **formally exempt and reported instead**.
They are the record of how the choice was made; their frames in `docs/art/`
are what the board looked at, and redrawing a silhouette to pull it in a
pixel would edit that evidence while fixing nothing that ships. Measured,
their contact is not the appendage overhang `bestiary.ts` licenses either —
it sits on the left edge in the same amount for every kind of a given
archetype, so it comes from the shared silhouette reaching x = 0:

| direction | frames touching | border pixels | worst frame |
| --- | --- | --- | --- |
| **Toy Box** (shipped, gated) | 0 of 90 | 0 | — |
| Fossil Pixel | 48 of 72 | 133 | `flier-3`, 16 |
| Clay Pack | 57 of 72 | 606 | `longneck-3`, 40 |
| Valley Naturalist | 42 of 72 | 150 | `flier-3`, 21 |

Clay Pack is the only one that loses *feet* as well as outline — cute
proportions inflate mass into the bottom edge — which is the one place the
measurement says something about the art rather than about the geometry.

**The budget.** The offline binary targets under 40 MB with every asset
inside it. Measured by `art:check`:

| direction | authored | frames | atlas bytes |
| --- | --- | --- | --- |
| **Toy Box** (shipped) | 64px | 90 | **70.0 kB** |
| Fossil Pixel | 36px | 72 | 23.0 kB |
| Clay Pack | 48px | 72 | 124.9 kB |
| Valley Naturalist | 48px | 72 | 119.7 kB |

Toy Box carries 18 frames the other three do not: the attack strikes. They
cost 12.4 kB, which is also the measured answer to the question section 10
item 3 asks about animation — a frame in this direction is a camera pass
over a model, and eighteen of them did not move the budget.

All four are irrelevant against 40 MB, which is the useful finding: **the
atlas is not what will blow the budget, and the direction was therefore
rightly not chosen on size.** Audio and the Phaser runtime are the real
consumers. The budget line to hold is section 6's: v1 audio stays under
1.5 MB.

---

## 6. Audio

### Direction

**Valley, not jungle.** Low wind, far-off calls, dry grass. No orchestral
sting, no rock. The score is two layers that cross-fade on phase: a slow
drone with a low drum during a build phase, the same drone with a pulse and
a higher percussion line during a migration. Phase change is a cross-fade
over 1.2 seconds, not a cut, because the player is usually mid-placement
when it happens.

**Dinosaur voices are made, not sampled.** Nobody knows what these animals
sounded like, and anything that sounds like the films is the films. Each
kind gets a short vocalisation built from a bellow and a resonant body
tone, pitched down a fifth from hatchling to adult so growth is audible.

**The game must be fully playable on mute.** Every sound has a visual
partner in section 5.4. Phones are played silently.

### The SFX list

| sound | fires on | character | ms | ducks |
| --- | --- | --- | --- | --- |
| `place` | a dinosaur is placed | a soft earth thud plus the kind's pitch | 120 | no |
| `blocked` | a refused placement | a dry wooden click, no tone | 90 | no |
| `grow` | a stage increases | the kind's call, a fifth lower, with a swell | 600 | no |
| `sell` | a dinosaur is sold | a short reversed swell | 260 | no |
| `hit` | damage dealt | a tiny dry tick, pitched by the dinosaur's kind | 40 | **yes** |
| `kill` | an invader dies | a wet snap plus a meat chime | 180 | **yes** |
| `kill-boss` | a boss dies | a long descending bellow and a sub drop | 1400 | ducks all |
| `leak` | an invader reaches the nest | a cracked-shell snap, close and dry | 300 | ducks music |
| `leak-boss` | a boss reaches the nest | the same five times, overlapping, plus sub | 900 | ducks all |
| `send-early` | the player sends early | a rising three-note horn | 500 | no |
| `migration-start` | a migration begins | a distant herd call that arrives from the spawn side | 900 | no |
| `migration-clear` | a migration is cleared | a two-note resolve, up | 700 | no |
| `warn-eggs` | eggs drop to 3 | a low two-pulse heartbeat, once | 800 | ducks music |
| `select` | a dinosaur is tapped | a short soft tick | 50 | no |
| `defeat` | eggs reach 0 | the drone collapses to silence over 2s | 2000 | ducks all |
| `victory` | migration 50 cleared | the build-phase theme, full, resolved | 4000 | ducks all |

**`hit` is the one that needs a limiter.** Sixty invaders under six adult
dinosaurs is hundreds of hits a second. Cap it: at most one `hit` per 60ms
across the whole board, round-robin across the hues so it still sounds
distributed, and drop rather than queue. The same cap on `kill` at 90ms.

Fifteen SFX at 48kHz mono, trimmed, as OGG plus M4A for Safari, is under
400 kB. Two music layers at 90 seconds each, looped, is about 1 MB. Total
under 1.5 MB, which is the budget line.

---

## 7. Reduced motion, and playing without the pleasant parts

`prefers-reduced-motion` is respected, and the game must be fully playable
with it on.

| normal | reduced |
| --- | --- |
| kill ring expands | the ring appears at final size for 120ms |
| meat pip rises and fades | the meat count steps, no pip |
| toast fades in and out | the toast appears and disappears |
| boss-leak vignette | the egg count flashes twice, no vignette |
| phase cross-fade | still a cross-fade — it is 1.2s of audio, not motion |
| timer bar drains smoothly | the bar steps once a second |

Nothing in the reduced column removes information. Every one of them is
the same fact delivered without movement. The one thing that does **not**
change is the slow ring, because it is state and not feedback.

---

## 8. Onboarding: the first migration teaches mazing

No modal. No tutorial overlay. No text wall. The first migration is
designed so that a player who taps where the game points learns the one
rule that matters — **the towers are the walls** — by watching it happen.

The sequence, all of it diegetic:

1. **The board opens empty with the path drawn.** A dim dotted line runs
   spawn → checkpoint 1 → checkpoint 2 → nest. It is not decoration: it is
   the live flow-field path, and it is on screen from the first frame.
2. **Only the raptor button is lit.** The other five kinds are present but
   dim. Raptor is the cheapest wall. The player taps it because it is the
   only thing that looks tappable.
3. **The first placement moves the dotted line.** This is the whole lesson,
   and it costs nothing to teach because the path was already being drawn.
   The player places one dinosaur, the line visibly bends around it, and
   the rule is learned. It is not stated anywhere.
4. **The toast says the consequence, once.** The first time a placement
   lengthens the path, one toast: `Longer path`. It never appears again.
5. **A seal is refused, visibly.** The valley is shaped so that the obvious
   greedy wall is one cell from sealing. When the player tries it, the
   blocked hatching plus `That would seal the maze` teaches the block rule
   at the exact moment the player's model predicts something else.
6. **Migration 1 is six slow Parasaurolophus, at eight hit points.** Enough
   to watch a kill, see a meat pip, and see the count go up. Not enough to
   lose an egg even with one dinosaur placed. All three numbers are the
   promise, not flavour: eight hit points is two hits from one Velociraptor
   hatchling, so the strike reads as the cause of the fall, and half speed
   is what keeps the herd inside that hatchling's range long enough to land
   them. They are authored in `OVERRIDES` in `@mazeosaur/content` rather
   than taken from the migration curve, and `content.test.ts` pins the
   promise directly: one hatchling, at least one kill, no egg lost. A
   longneck herd against a raptor is a neutral matchup on purpose —
   migration 1 teaches that the towers are the walls, and nothing else.
7. **The tray swaps on the first tap.** Tapping the placed dinosaur
   replaces the shop with the sheet, which has a **Grow** button on it. The
   swap is the teaching: growing is discovered, not announced.
8. **Migration 5 is the first flying one.** One archetype that ignores the
   maze, while a leak still costs one egg out of twenty. It is deliberately
   not migration 2: at migration 2 the player owns a handful of hatchlings
   and no maze yet, so "it ignores your maze" has nothing to land on.
   By 5 there is a maze on the board to be flown over, and the lesson is
   still cheap. It is ruinous at migration 30.

The only words the first run shows are `Longer path`, `That would seal the
maze` and `Not enough meat`. Everything else is the board.

**What tells us it worked:** a first-time player places a second dinosaur
*adjacent to the first* rather than somewhere else on the grid. That is
the moment the maze becomes a maze. If playtests show players scattering
dinosaurs through migration 3, step 3 failed and the dotted line needs to
be brighter, not louder.

---

## 9. The results screen

Shown on defeat (eggs at 0) and on victory (migration 50 cleared). Full
canvas over a 70% `bg` scrim, the board still visible behind it, because
the board is what the player wants to look at.

| element | position | type |
| --- | --- | --- |
| headline | centred, y=360 | `title` at 2x — `The valley is quiet` / `The nest holds` |
| migrations cleared | centred, y=440 | `vital` — the number first, big |
| eggs kept | y=520, left of centre | `body` with egg pips, not digits |
| meat unspent | y=520, right of centre | `body` with the meat icon |
| fossils earned | centred, y=600 | `vital` in `checkpoint` yellow |
| the pack | y=680, 180 tall | every dinosaur the player grew to adult, as its sprite, in a row — the collection, which is the reason the stages are real genus names |
| **Again** | `196, 1019, 328 x 82` | primary, centred in the HUD band |

The pack row is the one piece of this screen that is not a statistic. A
player who grew three *Utahraptors* and one *Triceratops* sees exactly
that, and the next run's first thought is about what is missing from it.

**Again** sits in the HUD band at the bottom, in the same place the Send
button was, so the thumb does not move.

---

## 10. What this leaves open

1. **The models, not the direction.** The direction is settled — blocks,
   section 2 — and the board's instruction with it was to keep working the
   models. `tools/art/blocks.ts` is where that happens and it does not
   change anything in this document.
2. **The kind-hue change** in section 3 is a proposed replacement for
   `KIND_COLOR` and can land independently of the art — it is measured, and
   it is an improvement on M2 under every eye.
3. **Animation, minus the attack.** The owner has since asked for the
   attack effect by name, so **the attack strike is in v1 and is specified**:
   section 5.4.1, eighteen frames in the atlas. What is still open is
   everything about the *animal*: **idle breath and a two-frame walk are not
   in v1 and are not specified here.** In blocks they are cheap in a way
   they would not have been in the flat directions — a frame is a camera
   pass over a model, so a bob is a translation of a few boxes rather than a
   redrawn sprite — and the strikes are now the measurement of that: 18
   frames for 12.4 kB against a 40 MB binary. Size is not what defers them.
   Nobody has specified what a Toy Box dinosaur does standing still.
4. **The fifth boss** is *Spinosaurus* at migration 50 in the content as
   it stands. The proposal says "a final one to be designed", so this is a
   placeholder the content can change without touching this document.
