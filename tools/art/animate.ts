// Idle and attack clips, as pixel transforms of a rendered sprite.
//
// The owner's brief for the GBA tactics direction names the animation as the
// signature of that generation, not the palette: every unit breathes on the
// map and lunges when it fights. Two things follow from how it is done here.
//
// **It is a transform of the finished sprite, not a second drawing.** A GBA
// map-sprite idle is a one-pixel move — the body rises, the feet stay — and an
// attack is a one or two pixel lunge. At 15px that is the whole animation, so
// it can be a function of the raster instead of eighteen more hand-drawn
// frames, and the six silhouettes stay exactly the six silhouettes `art:check`
// already measures.
//
// **It is therefore not specific to one direction.** Every clip here works on
// any sprite any direction produces. If the owner keeps Toy Box after all, the
// blocks breathe and lunge with the same code; only the pixel counts below are
// tuned for a 15px square, and they are expressed in pixels because that is
// what an animator would change.
//
// What this deliberately does not do: open a jaw, swing a tail or plant a
// foot. Those need per-kind authored frames, they are two orders of magnitude
// more work, and nothing at a 19.5pt cell can see them.

import { type Palette } from "./directions.js";
import { Raster } from "./raster.js";
import { inkBox } from "./sprites.js";

export type Clip = "idle" | "attack";

export const CLIPS: readonly Clip[] = ["idle", "attack"];

/**
 * Frame durations in milliseconds, which is also the frame count.
 *
 * The idle is slow on purpose: with up to 560 occupied cells on screen, a
 * fast bob across all of them is noise, and the eye reads a slow collective
 * breath as life rather than as motion. 380ms is about three frames of a
 * 8fps map animation, which is the register the reference generation used.
 *
 * The attack is short and front-loaded — the strike frame is the one the
 * player should see, so the wind-up is the briefest of the three.
 */
export const CLIP_MS: Record<Clip, readonly number[]> = {
  idle: [380, 380],
  attack: [90, 110, 130],
};

/** How many frames a clip has. One source of truth with `CLIP_MS`. */
export const clipLength = (clip: Clip): number => CLIP_MS[clip].length;

/**
 * Resample a sprite through a per-row offset. Reading backwards from the
 * destination — rather than writing forwards — is what makes a band move
 * without leaving a one-pixel hole at its seam: the row below the seam reads
 * the seam's own source row, so a leg stretches by a pixel instead of
 * breaking.
 */
function warp(src: Raster, offset: (y: number) => { dx: number; dy: number }): Raster {
  const out = new Raster(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const { dx, dy } = offset(y);
    for (let x = 0; x < src.w; x++) {
      const [r, g, b, a] = src.get(x - dx, y - dy);
      if (a) out.blend(x, y, [r, g, b], a / 255);
    }
  }
  return out;
}

/**
 * The breath frame: everything above the feet rises one pixel.
 *
 * `feet` is two pixels at 15px — enough that the legs stay planted, which is
 * the difference between a breath and the whole animal hopping. The band
 * below the seam is untouched, so the sprite's contact with the cell floor
 * (section 5.0's anchor) does not move: an idle that changed the ink box
 * would make every dinosaur on the board jitter against its tile.
 */
function breathe(src: Raster, feet = 2): Raster {
  const ink = inkBox(src);
  const seam = ink.y + ink.h - feet;
  return warp(src, (y) => ({ dx: 0, dy: y < seam ? -1 : 0 }));
}

/**
 * A lunge: the head leads, the body follows, the feet stay.
 *
 * `lead` is the head band's shift and `follow` the body's, both relative to
 * the feet. **Only the differences between the three are visible** — a frame
 * where all three moved by the same amount is the same picture translated,
 * and at a 19.5pt cell nobody sees the translation. So the shape of the
 * lunge is preserved and the whole figure slides to wherever that shape
 * fits.
 *
 * It does not always fit. A Tactics Pixel adult is 15px of ink in a 15px
 * square — measured, raptor, tyrant and flier adults have **no free column
 * on either side**, and no adult has one behind. Clamping each band into the
 * square independently, which is what this used to do, silently turns that
 * case into no animation at all: the wind-up's `-1` became `0` on all six
 * kinds and the strike's `+2` became `0` on three of them, so three of the
 * six "attacks" were a three-pixel flash on a sprite that never moved.
 *
 * The order of preference when the square is full:
 *
 * 1. **Slide, do not shrink.** Spend the free columns on whichever side has
 *    them before giving up any of the lunge.
 * 2. **Spend the trailing edge, never the leading one.** If the shape still
 *    does not fit, push it as far back as the square allows and let the
 *    *rear* of the lower bands fall off — a tail or a back leg losing a
 *    column. Clipping the snout to buy the same pixel costs the one feature
 *    the strike frame exists to show.
 *
 * At 15px the worst case is two columns off the back of a raptor, and the
 * head still leads the feet by the full two pixels the clip asks for.
 */
function lunge(src: Raster, lead: number, follow: number): Raster {
  const ink = inkBox(src);
  const ahead = src.w - (ink.x + ink.w);
  const head = ink.y + Math.ceil(ink.h / 3);
  const body = ink.y + ink.h - 2;

  // The shape, as the three band offsets, and the span it needs.
  const hi = Math.max(lead, follow, 0);
  const lo = Math.min(lead, follow, 0);
  // A global slide of `g` keeps the shape and moves where it sits. It is
  // clipping-free while `hi + g <= ahead` and `lo + g >= -ink.x`.
  const back = -ink.x - lo;
  const forward = ahead - hi;
  // `back > forward` means the span is wider than the square's free columns:
  // take `forward`, the furthest back the shape goes, which is the choice
  // that clips the trailing edge instead of the leading one.
  const g = back > forward ? forward : Math.min(Math.max(0, back), forward);

  const l = lead + g;
  const f = follow + g;
  const s = g;
  return warp(src, (y) => ({ dx: y < head ? l : y < body ? f : s, dy: 0 }));
}

/**
 * The strike arc: the flash in front of the head that says "this frame is
 * the hit".
 *
 * Three pixels, drawn past the front of the head band. It is here because a
 * one-pixel lunge is invisible at a 19.5pt cell and an attack the player
 * cannot see is not feedback — the arc is what carries the event, and the
 * lunge is what makes it feel like the animal did it. Drawn in `glint` and
 * `accent` rather than in a kind hue, so a bite looks like a bite on all six
 * kinds and cannot be mistaken for a sixth family colour.
 */
function strikeArc(r: Raster, p: Palette, alpha: number): void {
  const ink = inkBox(r);
  const headBottom = ink.y + Math.ceil(ink.h / 3);
  let frontX = ink.x;
  let frontY = ink.y;
  for (let y = ink.y; y < headBottom; y++) {
    for (let x = ink.x; x < ink.x + ink.w; x++) {
      if (r.get(x, y)[3] > 8 && x >= frontX) {
        frontX = x;
        frontY = y;
      }
    }
  }
  const x0 = Math.min(frontX + 1, r.w - 1);
  r.blend(x0, frontY, p.glint, alpha);
  r.blend(x0, frontY - 1, p.accent, alpha * 0.85);
  r.blend(x0 - 1, frontY + 1, p.accent, alpha * 0.7);
}

/**
 * One clip, as the frames it is made of. Frame 0 of every clip is the
 * sprite as authored, so a renderer that ignores animation entirely — or a
 * player who has turned motion off, section 7 — draws the right picture.
 */
export function clipFrames(sprite: Raster, clip: Clip, p: Palette): Raster[] {
  if (clip === "idle") return [sprite, breathe(sprite)];
  const strike = lunge(sprite, 2, 1);
  strikeArc(strike, p, 1);
  const recover = lunge(sprite, 1, 0);
  strikeArc(recover, p, 0.4);
  return [lunge(sprite, -1, 0), strike, recover];
}
