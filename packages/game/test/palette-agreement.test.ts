// The HUD palette exists twice and only one copy was ever checked.
//
// `npm run art:check` measures §1's 4.5:1 contrast floor against `BOARD` in
// `tools/art/directions.ts`. It cannot reach `COLORS` in
// `packages/game/src/theme.ts`, which is the palette the player is actually
// shown, so for the whole of M2 the floor was enforced against the art tool
// and not against the client. `buttonActive` drifted: the art tool darkened
// 0x3f7a55 to 0x37694b to clear the floor, §3 of
// docs/01-art-hud-and-audio.md wrote the new value down in the present
// tense, and the client kept shipping Send at 4.44:1 until a human compared
// the two files by eye (ARB-364).
//
// This file is the seam. It does not re-measure contrast -- it pins the two
// copies equal, so `art:check`'s measurement is a measurement of the client's
// palette as well. The chain is: art:check grades BOARD; this test says
// COLORS is BOARD; therefore §1's floor reaches the renderer.
//
// Why a test and not one shared constant: `tools` has no Phaser in its
// typecheck program (`types: ["node"]`, and `tsc -p tools` is a `npm run
// check` step), while `theme.ts` annotates `text()` and `wrapped()` with the
// global `Phaser.Types.GameObjects.Text.TextStyle`. Importing `theme.ts` from
// `tools/art` therefore fails with two `TS2503: Cannot find namespace
// 'Phaser'`, which is why `directions.ts` restates the colours instead of
// importing them. One shared constant becomes available the day the colour
// values move to a module that names no Phaser type; until then this is what
// holds them together. The test lives here, under `packages/game`, and not in
// `tools/art/test` for the same reason -- this is the one program where both
// palettes typecheck.
//
// The two key lists below are the part that has to be maintained, and that is
// deliberate: a new colour on either side fails this file until somebody says
// which side it belongs to, which is the decision that was never forced
// before.

import { describe, expect, it } from "vitest";
import { BOARD, CARD_TINT as ART_CARD_TINT, KINDS, KIND_HUE } from "../../../tools/art/directions.js";
import { contrastRatio, mix, rgb, type Rgb } from "../../../tools/art/raster.js";
import { CARD_TINT, COLORS, KIND_COLOR, PIP_INK, hexCss } from "../src/theme.js";

/**
 * `BOARD` keys with no counterpart in `COLORS`, and why. These are colours
 * the frame generator needs and the renderer does not have -- either because
 * it draws the thing a different way or because it does not draw it yet.
 */
const ART_ONLY: Record<string, string> = {
  rock: "terrain the renderer draws from the atlas, not from a fill",
  slow: "the status rings and the slow aura, drawn per-effect in the client",
  stun: "ditto",
  shield: "ditto",
};

/**
 * `COLORS` keys with no counterpart in `BOARD`, and why. The four `*Fill` /
 * `*Text` / `selection` entries are a second *form* of a colour that is
 * already shared -- Phaser wants `#rrggbb` for text and a number for a
 * shape -- so the value they carry is pinned by the twin assertions below,
 * not by a `BOARD` entry of their own.
 */
const CLIENT_ONLY: Record<string, string> = {
  meatFill: "COLORS.meat as a number; pinned as a twin below",
  eggsFill: "COLORS.eggs as a number; pinned as a twin below",
  refusalText: "COLORS.refusal as a CSS string; pinned as a twin below",
  selection: "COLORS.text as a number; pinned as a twin below",
  attack: "the attack flash, a board effect the frame generator does not draw",
  ghost: "the placement ghost, which is an input affordance and not in a frame",
};

/** `#rrggbb` or 0xrrggbb, as one 24-bit number. */
function hexOf(v: number | string): number {
  return typeof v === "number" ? v : Number.parseInt(v.slice(1), 16);
}

function boardHexOf(c: Rgb): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

const colorKeys = Object.keys(COLORS);
const boardKeys = Object.keys(BOARD);
const shared = colorKeys.filter((k) => boardKeys.includes(k));

describe("theme.ts and tools/art/directions.ts hold the same palette", () => {
  it("agrees on every colour both of them name", () => {
    const drift = shared
      .map((k) => {
        const mine = hexOf(COLORS[k as keyof typeof COLORS]);
        const theirs = boardHexOf(BOARD[k as keyof typeof BOARD]);
        return mine === theirs ? "" : `${k}: theme ${hexCss(mine)} vs art ${hexCss(theirs)}`;
      })
      .filter(Boolean);
    expect(drift.join("\n")).toBe("");
  });

  // Send at 4.44:1 is the defect this file was written for, so it gets an
  // assertion of its own rather than only riding on the loop above: the loop
  // would still pass if both copies were edited to the old value together,
  // and this says which value is correct.
  it("ships Send at the value §3 says it ships", () => {
    expect(hexCss(COLORS.buttonActive)).toBe("#37694b");
  });

  it("classifies every key on both sides", () => {
    const unclassifiedArt = boardKeys.filter((k) => !shared.includes(k) && !(k in ART_ONLY));
    const unclassifiedClient = colorKeys.filter((k) => !shared.includes(k) && !(k in CLIENT_ONLY));
    // A new HUD colour in theme.ts that the frame generator should also have
    // lands here, which is the whole point: say so in CLIENT_ONLY or add it
    // to BOARD, but do not let it be neither.
    expect({ unclassifiedArt, unclassifiedClient }).toEqual({ unclassifiedArt: [], unclassifiedClient: [] });
    // And a stale exemption is as bad as a missing one.
    expect(Object.keys(ART_ONLY).filter((k) => shared.includes(k))).toEqual([]);
    expect(Object.keys(CLIENT_ONLY).filter((k) => shared.includes(k))).toEqual([]);
  });

  it("keeps each colour's number and CSS forms equal", () => {
    expect(hexCss(COLORS.meatFill)).toBe(COLORS.meat);
    expect(hexCss(COLORS.eggsFill)).toBe(COLORS.eggs);
    expect(hexCss(COLORS.refusal)).toBe(COLORS.refusalText);
    expect(hexCss(COLORS.selection)).toBe(COLORS.text);
  });
});

/** The composite a mark is really drawn on: `fg` over `bg` at `alpha`. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  // `mix(a, b, t)` walks from `a` to `b`, so the background is the start.
  return mix(bg, fg, alpha);
}

/** `#rrggbb` as an `Rgb`, for the four `COLORS` entries that are CSS strings. */
function cssRgb(css: string): Rgb {
  return rgb(Number.parseInt(css.slice(1), 16));
}

/** A contrast ratio to two decimals, which is how every figure here is quoted. */
function ratio(fg: Rgb, bg: Rgb): number {
  return Number(contrastRatio(fg, bg).toFixed(2));
}

/** A tray card's background: its kind's hue at `CARD_TINT` over `hud`. */
function card(kind: (typeof KINDS)[number]): Rgb {
  return over(rgb(KIND_COLOR[kind]), BOARD.hud, CARD_TINT);
}

/**
 * The kind hues are the palette's second copy and were not covered when this
 * file was written for the HUD colours (ARB-364). They had drifted further:
 * all six differed, for the whole of M2, with `art:check`'s 60-pair
 * colour-blindness measurement and every atlas frame computed from the art
 * tool's set while the renderer drew the other one.
 *
 * That was not only theoretical. The client loads the toy-box atlas, whose
 * sprites are drawn from `KIND_HUE`, and filled its own cells and HUD chips
 * from `KIND_COLOR` — so both palettes were on screen in one glance. And the
 * growth pip's contrast depended on which copy you measured: `art:check`
 * named `tyrant` as the tightest pip pair, the renderer's was `horned`, and
 * the renderer's was under the floor. ARB-386 ruled that the client takes the
 * measured set, and this is where that is held.
 */
describe("the kind palette, and the marks drawn on it", () => {
  it("agrees with the art tool on all six kind hues", () => {
    const drift = KINDS.map((k) =>
      KIND_COLOR[k] === KIND_HUE[k] ? "" : `${k}: theme ${hexCss(KIND_COLOR[k])} vs art ${hexCss(KIND_HUE[k])}`,
    ).filter(Boolean);
    expect(drift.join("\n")).toBe("");
  });

  // Same argument as the `buttonActive` assertion above: the loop would still
  // pass if both copies were edited back together, and this is the half that
  // says which set is right. Each value below is one §3 of
  // docs/01-art-hud-and-audio.md lists in its "M2 was" column, with the
  // colour-blindness pair it failed.
  it("ships none of the six values the colour-blindness search replaced", () => {
    const m2 = [0xe0a83a, 0xc0392b, 0x95a5a6, 0x8e44ad, 0x27ae60, 0x3498db];
    expect(KINDS.filter((k) => m2.includes(KIND_COLOR[k]))).toEqual([]);
  });

  it("agrees with the art tool on the tray card's tint", () => {
    expect(CARD_TINT).toBe(ART_CARD_TINT);
  });

  /**
   * The pip rule, re-derived rather than restated: for each kind, `PIP_INK`
   * must hold whichever of `ink` and `selection` has more contrast with the
   * fill the cell is drawn in.
   *
   * That fill is `KIND_COLOR[kind]` because it is what `drawTowers` fills
   * with. If a dinosaur's cell stops being a flat kind fill — the mock
   * already draws it as `darken(hue, 0.72)` with the sprite on top, which
   * would send all six to the light value — then this is measuring the wrong
   * background and the table has to be re-derived against the new one. That
   * is the one way this assertion can be true and useless.
   */
  it("gives every growth pip the better of the two inks", () => {
    const wrong = KINDS.filter((k) => {
      const fill = rgb(KIND_COLOR[k]);
      const better = ratio(rgb(COLORS.ink), fill) >= ratio(rgb(COLORS.selection), fill) ? COLORS.ink : COLORS.selection;
      return PIP_INK[k] !== better;
    });
    expect(wrong).toEqual([]);
  });

  /**
   * And what the rule buys. 1.4.11 asks 3:1 of a graphical object that
   * carries information, and the pip count is the only channel carrying
   * growth stage on the board, so this floor is not negotiable downward.
   *
   * The named figure is the part that would otherwise rot: a hue edit that
   * moves the tightest pair fails here and somebody has to look at the
   * number, which is exactly what nobody did while the pips shipped at
   * 2.88:1. It cannot be satisfied by the pips being absent either — a
   * missing `PIP_INK` entry is a `TypeError` in `rgb`, not a pass.
   */
  it("keeps every growth pip over the 1.4.11 floor, tightest named", () => {
    const measured = KINDS.map((k) => ({ kind: k, ratio: ratio(rgb(PIP_INK[k]), rgb(KIND_COLOR[k])) }));
    expect(measured.filter((m) => m.ratio < 3)).toEqual([]);
    expect([...measured].sort((a, b) => a.ratio - b.ratio)[0]).toEqual({ kind: "horned", ratio: 4.94 });
  });

  /**
   * The tray card is the only place in the HUD where the *background* of a
   * text pair is a variable, which is why §3's ten panel pairs never covered
   * it: there are six more backgrounds, and the lightest kind decides whether
   * the dimmest state passes. At the 0.22 the client shipped, `armored`'s
   * card held `textDim` at 3.92:1.
   */
  it("keeps both of the card's affordability states over 4.5:1", () => {
    const states = [
      ["text", COLORS.text],
      ["textDim", COLORS.textDim],
    ] as const;
    const under = KINDS.flatMap((k) =>
      states
        .map(([what, css]) => ({ what: `${what} on ${k} card`, ratio: ratio(cssRgb(css), card(k)) }))
        .filter((p) => p.ratio < 4.5),
    );
    expect(under).toEqual([]);
  });

  /**
   * Pairs this file measures and deliberately leaves under a floor, each with
   * its reason here rather than in a review thread — the discipline `ART_ONLY`
   * above uses. A *stale* exemption is a failure too, so the ratios are
   * pinned: a pair that moves in either direction comes back to a human.
   */
  const EXEMPT: { what: string; ratio: number; floor: number; why: string }[] = [
    {
      what: "refusal flash on armored card",
      ratio: 3.37,
      floor: 4.5,
      why: "the cost flashing `refusal` on a no-meat tap is a change over time, not a number to read: the digits do not move and the player has already read them. Which card flashed is the information, and the flash carries it at 3.37:1, over 1.4.11's floor. The refusal's own channels are §4's toast and the board hatching.",
    },
    {
      what: "tyrant invader on board",
      ratio: 2.3,
      floor: 3,
      why: "an invader is a shape on `boardBg` in its kind's hue, and the two dark hues are dark against a dark board. This pre-dates ARB-386 and is not made meaningfully worse by it — M2's set was 2.34:1 on `horned`. Fixing it means moving tyrant and horned, which re-opens §3's constrained search, so it is its own decision. An invader is currently carried by its silhouette and its hp bar.",
    },
    {
      what: "tyrant chip on HUD",
      ratio: 3.06,
      floor: 4.5,
      why: "row 2's kind chip is 28px of solid hue with no label on it, so hue is the information and 1.4.11's 3:1 is the applicable floor rather than body text's 4.5. It clears, barely. Named here so a hue edit that takes it under 3 fails instead of shipping.",
    },
  ];

  it("holds each exempt pair at the ratio its reason was written for", () => {
    const measured = {
      "refusal flash on armored card": ratio(rgb(COLORS.refusal), card("armored")),
      "tyrant invader on board": ratio(rgb(KIND_COLOR.tyrant), BOARD.boardBg),
      "tyrant chip on HUD": ratio(rgb(KIND_COLOR.tyrant), BOARD.hud),
    };
    expect(measured).toEqual(Object.fromEntries(EXEMPT.map((e) => [e.what, e.ratio])));
    // Under its own floor is why each is exempt. Under 3:1 is a different
    // conversation, and only the invader pair has that reason on file.
    expect(EXEMPT.filter((e) => e.ratio >= e.floor)).toEqual([]);
    expect(EXEMPT.filter((e) => e.ratio < 3).map((e) => e.what)).toEqual(["tyrant invader on board"]);
  });
});
