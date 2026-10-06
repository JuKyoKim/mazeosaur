---
date: 2026-10-05
status: decided
---

# The art direction is Toy Box, and the clips outlive the candidate they were built for

Mazeosaur ships `toy-box`: dinosaurs built from six to fourteen boxes under
one fixed isometric camera, three flat tones to a face. It keeps `CHOSEN` in
`tools/art/directions.ts` and it is the only direction with a shipped atlas.
Section 9 item 4 of [../00-proposal.md](../00-proposal.md) is closed.

Separately and durably: **every kind gets an idle loop and an attack cycle.**
Those were asked for in the same breath as a fifth candidate and they are not
a property of any direction — `build.ts anim <id>` is a transform of a
finished sprite, so the blocks breathe with the code that made a pixel sprite
bob. The clips are specified in section 5.6 of
[../01-art-hud-and-audio.md](../01-art-hud-and-audio.md) and generated for
every direction, which is how that claim gets checked rather than believed.

**Why.** The choice was made by looking at the actual board at actual phone
size, five times over, rather than by argument. Toy Box reads as a solid
object rather than a drawing of one, which is what survives a 19.5pt cell;
and its atlas is 68 kB against a 40 MB budget, so nothing about the decision
is a size compromise. Writing it down as a file rather than a section-10 line
is the convention in
[0001-decisions-live-in-their-own-files.md](0001-decisions-live-in-their-own-files.md).

**Rejected.** Four directions were rendered and turned down by looking:
*Fossil Pixel* (pixel, fierce) had the smallest atlas by a factor of five and
lost on register, not on legibility; *Clay Pack* (vector, cute-round) read
friendliest and was the easiest to animate, and lost to the brief to steer
away from 2D; *Valley Naturalist* (vector, fierce) read as an animal rather
than a mascot and lost on the same brief. *Tactics Pixel* (pixel, cute-round,
15px) was briefed by name a day after Toy Box was first chosen — GBA map
sprites, limited palette, clean dark outline — rendered through the same
generator from the same `bestiary.ts` silhouettes, and then turned down with
Toy Box confirmed in its place. Its write-up stays in section 2 of the art
spec because the 15px arithmetic is expensive to rediscover, but it has no
atlas and the client does not reference it.

Tactics Pixel was also the reason the animation machinery exists, which is
why that half of the work shipped while the direction did not. An
`art:anim <id>` run writes APNG clips for any of the five.
