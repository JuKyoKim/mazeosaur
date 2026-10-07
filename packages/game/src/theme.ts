// Colour and type styles. The geometry is not here: the canvas, the cell, the
// HUD boxes and the hit floor are `./layout.ts`, which is the one place they
// are declared and the file `tools/art` re-exports. A constant that lives in
// two files agrees only until somebody edits one of them.

import { COLORS, KIND_COLOR } from "./colors.js";

/**
 * Re-exported so `COLORS` and `KIND_COLOR` have one import site for the
 * client. They are declared in `./colors.js` because that file is
 * Phaser-free and this one is not; see the comment there.
 */
export { COLORS, KIND_COLOR };

export const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export function text(size: number, color: string = COLORS.text): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color };
}

/**
 * `COLORS` holds hues as numbers, which is what the renderer wants for a
 * shape; `Text` wants `#rrggbb`. This is the one conversion between the
 * two, and it lives here rather than beside a scene so that a spec checking
 * "§9's checkpoint yellow" asks the same question the scene answered.
 */
export function hexCss(hue: number): string {
  return `#${hue.toString(16).padStart(6, "0")}`;
}

/**
 * `text()` with a hard wrap at `width`.
 *
 * Every variable-length string in the HUD gets one, and the width is always
 * a `layout.ts` number. The strings are content — a genus, a count, a
 * modifier line — so their pixel widths are not knowable from the layout,
 * and a field with no wrap over-subscribes its row *silently*: Phaser draws
 * it over its neighbour rather than failing. A wrap turns that into a
 * visibly broken line, which is the failure mode that gets fixed.
 */
export function wrapped(
  size: number,
  width: number,
  color: string = COLORS.text,
): Phaser.Types.GameObjects.Text.TextStyle {
  return { ...text(size, color), wordWrap: { width } };
}
