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
import { BOARD } from "../../../tools/art/directions.js";
import { type Rgb } from "../../../tools/art/raster.js";
import { COLORS, hexCss } from "../src/theme.js";

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
