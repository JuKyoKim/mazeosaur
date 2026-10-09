import { expect, test } from "@playwright/test";
import { content, hatchlings } from "@mazeosaur/content";
import { CONTENT_RIGHT, HUD_Y, MIN_HIT, ROW1, ROW3, SCALE, pt } from "@mazeosaur/game/layout";
import { growLabel } from "@mazeosaur/game/sheet";
import { cellCenter, type HudLabel, hudLabels, hudTargets, openGame, paletteButtonCenter, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * Every control a finger is supposed to be able to hit clears 44 CSS points
 * on the reference phone — measured on the live display objects, not on the
 * constants.
 *
 * `packages/game/test/layout.test.ts` already proves the constants clear
 * the floor, and that test was green for the whole period in which all five
 * controls on screen were under it: `buildHud` wrote its own numbers and
 * nothing compared the two sets. Send and the speed toggle were 22.8pt, the
 * kind cards 33.6pt, Grow and Sell 28.2pt, against a floor of 44.4. That is
 * the defect ARB-186 fixed, and the only test that could have caught it is
 * one that reads the renderer.
 *
 * It also pins the boxes to `layout.ts` exactly rather than merely to the
 * floor. A control that cleared 44pt at numbers of its own would pass a
 * floor check and still be the same class of drift.
 */

/** The reference phone is 390pt wide; `SCALE` is how 720 logical px fit it. */
const FLOOR_PT = 44;

test("every HUD control clears the 44pt hit floor on the rendered canvas", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 123);

  // The shop tray is up at the start of a run, so the kind cards and row 1
  // are on screen; Grow and Sell belong to the other tray and are built
  // with their geometry whether or not they are visible. Open a sheet
  // anyway, so this measures them in the state a player sees them in.
  const cell = { x: 1, y: 3 };
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);

  const targets = await hudTargets(page);
  // The list, not just its length: a control that stopped being reported
  // would otherwise drop silently out of every assertion below. The kind
  // cards are counted from the content, because how many there are is a
  // content edit.
  expect(targets.map((t) => t.name)).toEqual([
    "Send",
    "Pause",
    "speed toggle",
    ...hatchlings.map((_, i) => `kind card ${i}`),
    "Grow",
    "Sell",
  ]);

  for (const t of targets) {
    expect(t.w, `${t.name} is ${pt(t.w)}pt wide (${t.w}px)`).toBeGreaterThanOrEqual(MIN_HIT);
    expect(t.h, `${t.name} is ${pt(t.h)}pt tall (${t.h}px)`).toBeGreaterThanOrEqual(MIN_HIT);
    expect(pt(t.w), `${t.name} is ${pt(t.w)}pt wide`).toBeGreaterThanOrEqual(FLOOR_PT);
    expect(pt(t.h), `${t.name} is ${pt(t.h)}pt tall`).toBeGreaterThanOrEqual(FLOOR_PT);
    // Inside the HUD and inside the content column, which is the other half
    // of the failure the spec'd geometry prevents: a 164x82 Sell placed at
    // the old origin overflowed the canvas by 28px.
    expect(t.y, `${t.name} starts above the HUD`).toBeGreaterThanOrEqual(HUD_Y);
    expect(t.x + t.w, `${t.name} passes the content column's right edge`).toBeLessThanOrEqual(CONTENT_RIGHT);
  }

  // The boxes are `layout.ts`'s, not merely big enough.
  const byName = new Map(targets.map((t) => [t.name, t]));
  expect(byName.get("Send")).toMatchObject({ x: ROW1.send.x, y: ROW1.send.y, w: ROW1.send.w, h: ROW1.send.h });
  expect(byName.get("Pause")).toMatchObject({ x: ROW1.pause.x, y: ROW1.pause.y, w: ROW1.pause.w, h: ROW1.pause.h });
  expect(byName.get("speed toggle")).toMatchObject({ x: ROW1.speed.x, y: ROW1.speed.y, w: ROW1.speed.w, h: ROW1.speed.h });
  expect(byName.get("Grow")).toMatchObject({ x: ROW3.grow.x, y: ROW3.grow.y, w: ROW3.grow.w, h: ROW3.grow.h });
  expect(byName.get("Sell")).toMatchObject({ x: ROW3.sell.x, y: ROW3.sell.y, w: ROW3.sell.w, h: ROW3.sell.h });

  // `SCALE` is the conversion the whole floor rests on: if it is not the
  // reference phone's, every pt above is measuring something else.
  expect(SCALE).toBeCloseTo(390 / 720, 10);
  expect(errors.messages).toEqual([]);
});

/**
 * The other half of the same question. The test above says every button is
 * big enough for a finger; this one says every label is small enough for
 * its button.
 *
 * Both are needed, because Grow passed the first one for the whole of M2
 * while failing this one. `ROW3.grow` is 192 wide and is correct; the label
 * was `Grow → Deinonychus` at 202px, and at `Argentinosaurus`, the longest
 * genus the content can grow into, 236px. A button label is *centred*, so
 * that overflow is not a clip and not a run off one edge — it spills out of
 * both, 10px into the sheet column on the left and 10px into Sell on the
 * right.
 *
 * Nothing could see it. `packages/game/test/layout.test.ts` is green
 * because the constants are right, and `tools/art`'s plates are green
 * because `drawButton` calls `fitSize`, which shrinks a label until it fits
 * and so draws a button the client does not have. That is ARB-296, and a
 * measurement in a running client is the only thing that answers it — the
 * string is content, the face is the platform's, and a character count is
 * not a width. The px are printed rather than pinned, because they are one
 * machine's `system-ui` fallback.
 *
 * The sweep is over every grow target in the content and not over the one
 * this test happens to select, because "it fits at Deinonychus" is exactly
 * what was true while it did not fit at nine of the other eleven.
 */
test("every HUD button's label fits its button, at every genus the content can grow into", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, 123);

  const cell = { x: 1, y: 3 };
  await page.mouse.click(paletteButtonCenter(0).x, paletteButtonCenter(0).y);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);
  await page.mouse.click(cellCenter(cell.x, cell.y).x, cellCenter(cell.x, cell.y).y);
  await waitAFrame(page);

  const labels = await hudLabels(page);
  // The list and not its length, for the same reason as the test above: a
  // button that stopped reporting its label would otherwise drop out of
  // every assertion here silently.
  expect(labels.map((l) => l.name)).toEqual(["Send", "Pause", "speed toggle", "Grow", "Sell"]);

  const fits = (l: HudLabel) => {
    const what = JSON.stringify(l.text);
    expect(l.w, `${l.name}'s label ${what} is ${Math.round(l.w)}px in a ${l.box.w}px button`).toBeLessThanOrEqual(l.box.w);
    expect(l.h, `${l.name}'s label ${what} is ${Math.round(l.h)}px tall in a ${l.box.h}px button`).toBeLessThanOrEqual(l.box.h);
  };
  for (const l of labels) fits(l);

  // The client builds the shared string rather than one of its own. Without
  // this, the sweep below would measure `growLabel`'s shape while the HUD
  // drew something else — which is the failure mode `sheet.ts` already
  // exists to prevent for the four sheet lines.
  const placed = hatchlings[0] as (typeof hatchlings)[number];
  expect(labels.find((l) => l.name === "Grow")?.text).toBe(growLabel(content.dinos[placed.growsTo as string]));

  // Every genus a player can ever see on this button. `defId` is the one
  // mutable field on a placed dinosaur, so pointing the selected one at
  // each parent in turn drives `refreshHud` down its real path rather than
  // setting the label text from the outside.
  const parents = Object.values(content.dinos).filter((d) => d.growsTo);
  expect(parents.length).toBe(12);
  let widest: HudLabel | undefined;
  for (const parent of parents) {
    await page.evaluate((defId) => {
      window.mazeosaurBoard!().sim.state.dinos[0]!.defId = defId;
    }, parent.id);
    await waitAFrame(page);
    const grow = (await hudLabels(page)).find((l) => l.name === "Grow") as HudLabel;
    const next = content.dinos[parent.growsTo as string] as (typeof content.dinos)[string];
    expect(grow.text, `the Grow label for a ${parent.name}`).toBe(growLabel(next));
    console.log(`Grow → ${next.name}: ${Math.round(grow.w)}px of ${grow.box.w}, ${grow.lines} lines`);
    fits(grow);
    // Width is not the whole question, because a label that gains a line
    // gets taller rather than wider: three lines is 66px of Grow's 82 and
    // four is 88, out of the button. Three is the shape `growLabel` writes.
    expect(grow.lines, `the Grow label for a ${parent.name} wrapped: ${JSON.stringify(grow.text)}`).toBe(3);
    if (!widest || grow.w > widest.w) widest = grow;
  }
  console.log(`widest Grow label: ${JSON.stringify(widest?.text)} at ${Math.round(widest?.w ?? 0)}px of ${ROW3.grow.w}`);

  expect(errors.messages).toEqual([]);
});
