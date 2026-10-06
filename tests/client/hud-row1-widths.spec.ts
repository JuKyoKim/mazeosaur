import { expect, test } from "@playwright/test";
import { content } from "@mazeosaur/content";
import { ROW1, ROW1_WRAP } from "@mazeosaur/game/layout";
import { openGame, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * Row 1 is five variable-length fields on 720px, and §4 of
 * `docs/01-art-hud-and-audio.md` sets every origin in it from the *measured*
 * width of the field to its left: `9999` at `vital` is 88 wide so the egg
 * icon can sit at 192, `MIGRATION` at `label` is 108 wide so Send can sit at
 * 444. Those three numbers are the reason the row fits.
 *
 * Nothing measured them. `tools/art/test/doc-table.test.ts` compares §4's
 * geometry table to `ROW1`/`ROW3`, and `widthDrift` now checks the width
 * table's own arithmetic against those constants — but "is `MIGRATION`
 * really 108px wide?" is a question about font metrics, which neither can
 * answer. It has to be measured in a running client, exactly as
 * `dino-sheet.spec.ts` measures the sheet column.
 *
 * ARB-307 is why this exists. The migration readout was reported as clearing
 * Send by 1px rather than 16, measured off the ink in `docs/art/*-board.png`
 * — but those plates are drawn by `tools/art/font.ts`, a fixed-pitch 5x7
 * bitmap font that is about 1.6x wider than the proportional UI font on a
 * digit run. In the mock `49 / 50` is 123px and the wider of the readout's
 * two lines; in a real client it is 77 and the narrower. The ordering itself
 * flips between the two fonts, so a plate cannot answer this and a browser
 * can.
 *
 * What is asserted is what survives a different font: every field inside its
 * own band, on one line, and the readout's label line still the wider of the
 * two. §4 already records that the exact px are one machine's `system-ui`
 * fallback — a second machine resolves a narrower face — so the numbers are
 * printed rather than pinned.
 */

/** Phaser `Text` as this spec reads it back out of the scene. */
type Line = { text: string; x: number; y: number; width: number; lines: number };

/**
 * Every row-1 text field at its widest value, with the band it must stay
 * inside. The band is the gap to whatever sits to its right, which is what
 * `ROW1_WRAP` already is for the two wrapped fields.
 *
 * `MIGRATION` is listed separately and deliberately: it is drawn with
 * `text()` and not `wrapped()`, so it is the one field in the row with no
 * wrap underneath it. If it ever outgrows 124 it lands on Send silently,
 * which is the failure mode every other field in this row is protected
 * from — and it is the field §4's 428, and therefore Send's origin and the
 * Pause button that was paid for out of Send's width, actually rest on.
 */
const FIELDS = [
  { what: "meat", at: ROW1.meatValue, band: ROW1_WRAP.meat },
  { what: "eggs", at: ROW1.eggValue, band: ROW1_WRAP.eggs },
  { what: "migration label", at: ROW1.migrationLabel, band: ROW1.send.x - ROW1.migrationLabel.x },
  { what: "migration value", at: ROW1.migrationValue, band: ROW1_WRAP.migration },
] as const;

test("every row-1 field clears its neighbour at its widest value", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 70225);

  // The widest value of each field, as §4 defines it. Meat's is a design
  // assertion — "four digits before it reaches the egg icon" — and the other
  // two are content, read from the content package rather than written out
  // here, so a longer campaign or a bigger egg count is covered by the same
  // measurement.
  await page.evaluate(
    ({ eggs, last }) => {
      const b = window.mazeosaurBoard!();
      b.sim.state.meat = 9999;
      b.sim.state.eggs = eggs;
      b.sim.state.migration = last - 1;
    },
    { eggs: content.rules.eggs, last: content.migrations.length },
  );
  await waitAFrame(page);

  const lines = await page.evaluate((wanted) => {
    const scene = window.mazeosaurBoard!() as unknown as Phaser.Scene;
    type T = Phaser.GameObjects.Text;
    const texts = (scene.children.list as unknown[]).filter(
      (o): o is T => typeof (o as T).text === "string" && typeof (o as T).width === "number",
    );
    const out: Record<string, { text: string; x: number; y: number; width: number; lines: number } | null> = {};
    for (const { what, x, y } of wanted) {
      const t = texts.find((o) => o.x === x && o.y === y);
      out[what] = t ? { text: t.text, x: t.x, y: t.y, width: t.width, lines: t.getWrappedText(t.text).length } : null;
    }
    return out;
  }, FIELDS.map((f) => ({ what: f.what, x: f.at.x, y: f.at.y })));

  for (const { what, at, band } of FIELDS) {
    const line = lines[what] as Line | null;
    expect(line, `no row-1 text at ${at.x}, ${at.y} — "${what}" moved or stopped being drawn`).not.toBeNull();
    const l = line!;
    console.log(`${what}: "${l.text}" ${l.width}px of ${band}, ends at ${l.x + l.width}`);
    // One line and not two. A wrapped count still "fits" its band, and §4
    // wraps rather than clips precisely so the failure is visible — but it
    // is a failure, and seeing it in CI beats seeing it on a phone.
    expect(l.lines, `${what} wrapped: "${l.text}" does not fit ${band}px`).toBe(1);
    expect(l.width, `${what} is "${l.text}" at ${l.width}px in a ${band}px band`).toBeLessThanOrEqual(band);
  }

  // §4's width table names `MIGRATION` as the readout's widest value, and
  // every number downstream of it — 428, Send at 444, the 16px of clearance
  // that is the reason no timer digits fit in that band — is that claim. In
  // a proportional font the 9-character label beats the 7-character counter;
  // in a fixed-pitch one it does not. Assert the ordering, not the pixels.
  const label = lines["migration label"] as Line;
  const value = lines["migration value"] as Line;
  expect(
    label.width,
    `§4 says the label is the readout's widest line: "${label.text}" is ${label.width}px, "${value.text}" is ${value.width}px`,
  ).toBeGreaterThan(value.width);

  expect(errors.messages).toEqual([]);
});
