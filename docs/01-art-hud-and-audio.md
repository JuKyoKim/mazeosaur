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
`Not enough meat`, `Rock`, `+96 meat`.

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
| draw scale | the authored square scaled to **1.25 cells** (45 of 64 for Toy Box, `DRAW_CELLS` in `tools/art/layout.ts`) | tall enough for a solid to stand proud of its tile, capped where twenty adjacent cells stop reading |
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
**1.25 is the largest value where that block stays separable**, and an adult
still stands a quarter of a cell proud of its tile. At 1.25 the widest adult
draws 42px wide into a 36px cell, so the horizontal reach is about 3px a
side.

**Why.** This is the mechanism by which the reference game reads as blocks:
its subjects are taller than the tile they stand on. Without it a block
dinosaur is a 19.5pt square on a phone, and solidity is the first thing that
cell takes away — the finding in section 2. Enlarging the *cell* instead
would buy the same look for a re-tune of all 50 migrations against a quarter
of the board; this costs nothing the sim can see.

**The real cost is occlusion, and it is bounded.** A 1.25-cell sprite reaches
9px — a quarter of a cell — into the row behind it, and what it covers there
is the *lower* quarter of that cell, where the dinosaur behind is standing.
In a solid wall each dinosaur's feet are partly covered by the one in front.

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
overhang, and that the drag-to-place line reads while the finger is over the
board. Neither is a property of the atlas, so neither can be settled here.

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

### 5.5 The atlas

Two atlases, Phaser JSON Hash format, shelf-packed by descending height into
a 512px width with 1px padding. **Only the chosen direction is shipped**;
`npm run art:atlas` writes it, and `tools/art/build.ts atlas <direction>`
will write any of the four for a comparison. Which one is chosen is `CHOSEN`
in `tools/art/directions.ts` and nowhere else, so the atlas command and the
border check below cannot disagree about it.

```
packages/game/assets/toy-box/dinos.png    + dinos.json
packages/game/assets/toy-box/invaders.png + invaders.json
```

Frame names are `<kind>-<stage>` and `<archetype>-<kind>`, both lowercase,
so the client can build a frame name from sim state without a lookup table.

**Frames are trimmed to the ink**, and are declared as untrimmed frames whose
`sourceSize` is the trimmed size. That is deliberate, and it is the whole
reason 5.0's anchor costs the client one line: Phaser resolves `setOrigin`
against `sourceSize`, so a frame that claims to have been authored at its own
ink size puts `setOrigin(0.5, 1)` exactly on the animal's feet. Declaring
`trimmed: true` and carrying the offset would be the same pixels and would
move the origin back off them.

The scale's denominator therefore cannot come from the frame, so it is in
`meta`, per atlas rather than per frame:

| `meta` key | Toy Box | what it is |
| --- | --- | --- |
| `authored` | 64 | the square the sprites were drawn at, before trimming |
| `cell` | 36 | the logical cell, `CELL_PX` |
| `drawCells` | 1.25 | 5.0's draw height, in cells |

**Placing a dinosaur, in full**, with no other input than the atlas and the
cell the sim gives you:

```ts
const { authored, cell, drawCells } = atlas.meta;
sprite.setOrigin(0.5, 1);                       // feet, horizontally centred
sprite.setScale((cell * drawCells) / authored); // 45/64 for Toy Box
sprite.setPosition(cellX * cell + cell / 2, cellY * cell + cell);
sprite.setDepth(cellY * GRID_W + cellX);        // row, then x within the row
```

Invaders are not anchored: they are not in a cell, they move continuously,
and they are drawn centred on their interpolated position at one cell (the
`boss` archetype at two, `swarm` at 0.8), as the board frames do.

**Nothing may touch the edge of its authored square.** `art:check` measures
every one of the 72 frames in a direction against its own border and fails
the build for the shipped direction. Trimming is not a safety net: `pack`
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
| **Toy Box** (shipped, gated) | 0 of 72 | 0 | — |
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
| **Toy Box** (shipped) | 64px | 72 | **57.7 kB** |
| Fossil Pixel | 36px | 72 | 23.0 kB |
| Clay Pack | 48px | 72 | 124.9 kB |
| Valley Naturalist | 48px | 72 | 119.7 kB |

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
3. **Animation.** v1 is static sprites plus the five effects. Idle breath
   and a two-frame walk are the obvious next thing and are not specified
   here. In blocks they are cheap in a way they would not have been in the
   flat directions — a frame is a camera pass over a model, so a bob is a
   translation of a few boxes rather than a redrawn sprite — but they are
   still frames in the atlas, and 57.7 kB is the number they multiply.
4. **The fifth boss** is *Spinosaurus* at migration 50 in the content as
   it stands. The proposal says "a final one to be designed", so this is a
   placeholder the content can change without touching this document.
