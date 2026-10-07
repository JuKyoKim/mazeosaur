import { expect, test } from "@playwright/test";
import { COLORS } from "@mazeosaur/game/theme";
import { ROW1 } from "@mazeosaur/game/layout";
import { SEND_BUTTON, canvasPixel, openGame, rgbOf, simSnapshot, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * The build timer bar is the one readout in the HUD with no label on it, so
 * WCAG 1.4.11's 3:1 against its track is the whole of its legibility. It
 * shipped as `buttonActive` on a `hudPanel` track — 2.94:1, and 2.34:1 once
 * ARB-364 darkened `buttonActive` to fix a *labelled* control.
 *
 * `tools/art/test/graphical-pairs.test.ts` gates the ratio. This asserts the
 * renderer actually reaches for the token that ratio was computed from,
 * which is the half a palette check structurally cannot see: ARB-377's other
 * finding was that `tools/art/frame.ts` had been drawing this same bar from
 * two different tokens for its whole life, and every contrast check stayed
 * green throughout.
 *
 * Sampled rather than read off the scene graph deliberately. A
 * `GameObjects.Rectangle`'s `fillColor` would pass whether or not one pixel
 * of it reached the canvas, and the bar is 8px tall on the board/HUD seam —
 * the exact place a compositing mistake hides. The harness viewport is
 * `CANVAS_W`x`CANVAS_H`, so this sample is 1:1 and reads the pixel's own
 * colour rather than a neighbourhood average.
 */
test("the build timer bar is drawn in meat, the token its contrast was measured on", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 377);

  // Mid-bar vertically, and far from either end horizontally: the fill
  // drains right-to-left from full, so x=100 is inside it for the whole
  // build phase, and y+4 is clear of both 1px edges.
  const x = 100;
  const y = ROW1.timerBar.y + Math.floor(ROW1.timerBar.h / 2);

  expect((await simSnapshot(page)).phase).toBe("build");
  expect(await canvasPixel(page, x, y)).toEqual(rgbOf(COLORS.meatFill));

  // The regression, named: this is what the pixel was, and it is 2.34:1 on
  // the track behind it.
  expect(await canvasPixel(page, x, y)).not.toEqual(rgbOf(COLORS.buttonActive));

  // The bar is hidden in a migration, so the assertion above is about the
  // phase it is actually drawn in rather than about a bar that is always up.
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).phase).toBe("migration");
  expect(await canvasPixel(page, x, y)).not.toEqual(rgbOf(COLORS.meatFill));

  expect(errors.messages).toEqual([]);
});
