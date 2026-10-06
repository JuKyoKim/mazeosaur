import { expect, test } from "@playwright/test";
import { content } from "@mazeosaur/content";
import { SHEET_COL_W } from "@mazeosaur/game/layout";
import { GROW_BUTTON, HUD_BARE, cellCenter, openGame, paletteButtonCenter, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * The dinosaur sheet has to fit the column it is drawn in, and whether it
 * does is a question about font metrics, so it cannot be answered by the
 * geometry test in `packages/game/test/layout.test.ts`. It has to be
 * measured in a running client, which is what this is.
 *
 * It is the regression test for the defect the owner reported on the demo:
 * `refreshHud` built one line reading
 * `36 dmg every 1.50s (24.0/s) · range 3.0 · hits ground · splash, slow 45%`,
 * with no wrap, and at 15px that string is 558px wide. It ran straight
 * under the Grow and Sell buttons for every adult with two modifiers.
 *
 * Every one of the 18 defs is driven for real: placed as a hatchling and
 * grown through juvenile to adult, the sheet opened on each stage and the
 * four rendered line widths read back off the scene. No string is
 * constructed by the test, so a change to what the sheet *says* is covered
 * by the same measurement as a change to how wide the column is.
 */

/** `hatchlings` order, which is the tray's: raptor, tyrant, armored, horned, longneck, flier. */
const KINDS = 6;
const STAGES = 3;

test("every dinosaur's sheet fits the sheet column", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 70225);

  // The only cheat, and it is the one `tools/art/frame.ts` already takes:
  // reaching 195 meat honestly is several minutes of real migrations, and
  // the sheet's text is a function of the def, not of how it was paid for.
  await page.evaluate(() => {
    window.mazeosaurBoard!().sim.state.meat = 99_999;
  });

  const seen: string[] = [];
  for (let kind = 0; kind < KINDS; kind++) {
    // One column of the valley per kind, well clear of the trail.
    const cell = cellCenter(1 + kind * 3, 3);
    const tray = paletteButtonCenter(kind);
    // Dismiss the previous kind's sheet first. Row 3 is one tray at a time,
    // so while a sheet is open the shop is not on screen at all and a tap
    // at a card's coordinates reaches nothing — it is the sheet that has to
    // go before the next card can be tapped. This is the gesture a player
    // has: a tap on bare HUD clears whatever is selected.
    await page.mouse.click(HUD_BARE.x, HUD_BARE.y);
    await waitAFrame(page);
    await page.mouse.click(tray.x, tray.y);
    await page.mouse.click(cell.x, cell.y);
    await waitAFrame(page);

    // Tap the dinosaur to open its sheet, then grow it in place.
    await page.mouse.click(cell.x, cell.y);
    await waitAFrame(page);

    for (let stage = 1; stage <= STAGES; stage++) {
      const { defId, widths } = await page.evaluate(() => {
        const board = window.mazeosaurBoard!();
        const dino = board.sim.state.dinos.find((d) => d.id === board.selection.dinoId);
        return { defId: dino?.defId ?? null, widths: board.sheetWidths };
      });
      expect(defId, `kind ${kind} should have a sheet open at stage ${stage}`).not.toBeNull();
      seen.push(defId!);

      for (const [line, w] of Object.entries(widths)) {
        if (line === "lines") continue;
        expect(w, `${defId}: the ${line} line is ${w}px in a ${SHEET_COL_W}px column`).toBeLessThanOrEqual(SHEET_COL_W);
      }
      // Four lines and not five: a line wide enough to wrap still "fits"
      // the column, and would still be the single-string defect coming
      // back by another route.
      expect(widths.lines, `${defId} wrapped onto an extra line`).toBe(4);

      if (stage < STAGES) {
        await page.mouse.click(GROW_BUTTON.x, GROW_BUTTON.y);
        await waitAFrame(page);
      }
    }
  }

  // Not "18 measurements" but "the 18 defs": a loop that silently measured
  // the same hatchling eighteen times would otherwise pass.
  expect(new Set(seen).size).toBe(Object.keys(content.dinos).length);
  expect(errors.messages).toEqual([]);
});
