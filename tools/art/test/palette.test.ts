// `BOARD` says what it is in its own doc comment: "the board and HUD colours a
// frame needs, from theme.ts where they exist." Nothing checked the second
// half of that sentence. `buttonActive` was darkened here for contrast and the
// client's copy never followed, so every plate in `docs/art/` and §3 of
// docs/01-art-hud-and-audio.md were on `37694b` at 5.57:1 while the button a
// player actually touches shipped `3f7a55` at 4.44:1 — under the 4.5 floor §1
// sets. `art:check` could not see it: it measures `BOARD`'s own value, so it
// reported the passing number while the failing one shipped.
//
// Same seam as ARB-186 (renderer vs. doc) and ARB-292 (constants vs. doc), one
// level further out: the art tool's palette vs. the client's. Vitest and not
// only `art:check`, for the reason `doc-table.test.ts` gives — `npm run check`
// does not run `art:check`.
//
// Imports `@mazeosaur/game/colors` and not `/theme`: `theme.ts` types its text
// helpers with the Phaser namespace, and `tools` has no Phaser types, so the
// palette was split into a Phaser-free `colors.ts` to make this comparison
// possible at all.

import { COLORS } from "@mazeosaur/game/colors";
import { describe, expect, it } from "vitest";
import { BOARD } from "../directions.js";

/**
 * Both palettes to one comparable form. `BOARD` holds `Rgb` triples;
 * `COLORS` holds a number for anything Phaser draws as a shape and a
 * `#rrggbb` string for anything it draws as text, and a few colours appear in
 * both forms under different keys. Returns null for a value that is neither,
 * so a shape change shows up as a failure rather than as a silent skip.
 */
function toHex(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") return /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : null;
  if (Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === "number")) {
    return ((value[0] as number) << 16) | ((value[1] as number) << 8) | (value[2] as number);
  }
  return null;
}

const board = BOARD as unknown as Record<string, unknown>;
const client = COLORS as unknown as Record<string, unknown>;

/** The keys `BOARD` claims to take from `theme.ts`: the ones it shares. */
const shared = Object.keys(board)
  .filter((key) => key in client)
  .sort();

const hex = (n: number | null) => (n === null ? "not a colour" : `#${n.toString(16).padStart(6, "0")}`);

describe("tools/art BOARD against packages/game COLORS", () => {
  it("agrees on every colour the two share", () => {
    // Deliberately no exemption list. Measured over all 20 shared keys, the
    // only divergence was the `buttonActive` defect — `ink` included, which
    // reads as an exception in `BOARD`'s comment but is `111111` on both
    // sides. An exemption list here would be a place for the next drift to
    // hide, so it stays out until a real divergence earns one.
    const drift = shared
      .filter((key) => toHex(board[key]) !== toHex(client[key]))
      .map((key) => `${key}: art ${hex(toHex(board[key]))}, client ${hex(toHex(client[key]))}`);
    expect(drift.join("\n")).toBe("");
  });

  it("reaches the key it exists for, which is the part that was missing", () => {
    // A comparison over an empty or mis-built key set passes on any drift.
    // `buttonActive` is the key that actually drifted; if the intersection
    // stops containing it, this guard has stopped guarding anything.
    expect(shared).toContain("buttonActive");
    expect(shared.length).toBe(20);
    // And the four `BOARD` holds alone are terrain and status marks with no
    // client counterpart, so the intersection is the right comparison set
    // rather than a sign the import went wrong.
    expect(Object.keys(board).filter((key) => !(key in client)).sort()).toEqual([
      "rock",
      "shield",
      "slow",
      "stun",
    ]);
  });

  it("holds the shipping button fill over the 4.5:1 floor on HUD text", () => {
    // The reason the drift mattered, asserted directly rather than implied by
    // the comparison above: if both palettes were edited to the same failing
    // value, the drift test would pass and the button would still be
    // unreadable. WCAG 2.1 relative luminance.
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: number) =>
      0.2126 * channel((rgb >> 16) & 0xff) + 0.7152 * channel((rgb >> 8) & 0xff) + 0.0722 * channel(rgb & 0xff);
    const contrast = (a: number, b: number) => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const text = toHex(client.text);
    const fill = toHex(client.buttonActive);
    expect(text).not.toBeNull();
    expect(fill).not.toBeNull();
    const ratio = contrast(text as number, fill as number);
    // 5.57 as measured; the assertion is the floor, not the value, so a
    // deliberate re-tint does not have to edit a number here to stay honest.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
