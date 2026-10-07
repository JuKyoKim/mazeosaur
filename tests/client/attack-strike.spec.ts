import { expect, test, type Page } from "@playwright/test";
import { hatchlings } from "@mazeosaur/content";
import { again } from "@mazeosaur/game/entry";
import { TICKS_PER_SECOND } from "@mazeosaur/sim";
import { CELL_PX, SEND_BUTTON, cellCenter, openGame, paletteButtonCenter, setMigration, simSnapshot, startBoard, trackPageErrors, waitAFrame } from "./helpers.js";

/**
 * Section 5.4.1 of `docs/01-art-hud-and-audio.md`: an attack is two
 * layers, and the second one is what this file is about. The tracer says
 * *which invader* is being hit, and on its own it is one shape for all six
 * kinds with the colour doing all the work — which is the gap the owner
 * named on the demo. The strike says *which kind* is hitting.
 *
 * So the thing worth testing is not that a sprite appeared. It is that the
 * six are six, and that each is drawn where the spec says: on the
 * thrower's own cell, at the animal's own world scale, visible.
 *
 * `packages/game/test/atlas.test.ts` is the other half and needs no
 * browser: it holds the frame-name table against the shipped atlas in both
 * directions, so a kind with no art is caught there in milliseconds. What
 * it cannot see is a renderer that names the right frame on a sprite it
 * never shows, that scales by the strike frame's own 128 instead of the
 * authored 64 — section 5.5's trap — or that anchors the strike anywhere
 * but the thrower's cell. That is what `strikeLayerDrawn` is read for
 * here, the same way `hud-hit-targets.spec.ts` reads `hudTargets`.
 */

const SEED = 123;
const KINDS = ["tyrant", "longneck", "horned", "raptor", "flier", "armored"] as const;
/**
 * Diagonally adjacent to the lane's spawn at (0,0), so the post is inside
 * every hatchling's range — the shortest is 1600, or 1.6 cells — however
 * the one placement bends the route.
 */
const POST = { x: 1, y: 1 };
/**
 * Migration 1 is six slow Parasaurolophus at eight hit points *by design*
 * (section 8), so one hatchling kills the lot by the spawn and the board
 * empties under the capture. A later migration keeps invaders walking
 * while these tests watch a clip out.
 */
const BUSY_MIGRATION = 12;

type Drawn = { frame: string; x: number; y: number; scale: number; alpha: number };

/** One hatchling of `kind` at `POST`, placed with the two taps a player uses, then sent. */
async function postOneAndSend(page: Page, kind: string): Promise<void> {
  // Meat, so the test is about the strike and not about affording the
  // dinosaur: the starting 60 does not cover all six kinds. The same shape
  // as `loseOnNextLeak` — set the condition up, then let the real code
  // path run into it.
  await page.evaluate(() => {
    window.mazeosaurBoard!().sim.state.meat = 500;
  });
  // The tray is `hatchlings` in order, because `buildHud` iterates exactly
  // that list — so the card index comes from the content the client reads
  // rather than from a position written out here.
  const index = hatchlings.findIndex((def) => def.kind === kind);
  expect(index, `no tray card for ${kind}`).toBeGreaterThanOrEqual(0);
  const card = paletteButtonCenter(index);
  await page.mouse.click(card.x, card.y);
  await waitAFrame(page);
  const cell = cellCenter(POST.x, POST.y);
  await page.mouse.click(cell.x, cell.y);
  await waitAFrame(page);
  expect((await simSnapshot(page)).dinos, `${kind} did not place`).toBe(1);
  await setMigration(page, BUSY_MIGRATION);
  await page.mouse.click(SEND_BUTTON.x, SEND_BUTTON.y);
  await waitAFrame(page);
}

/**
 * Ticks the real pipeline until a dinosaur attacks, then samples what the
 * strike layer draws on every animation frame until it goes away.
 *
 * All of it inside the page, which is not an optimisation. A strike lives
 * 260ms and one `page.evaluate` round trip costs a good fraction of that,
 * so sampling from Node watched the clip through a shutter slower than the
 * clip: the first read of a freshly thrown strike came back on step 3, and
 * a loop of reads came back empty and called it a pass.
 *
 * `advanceTicks` rather than the accumulator for `fastForwardUntil`'s
 * reason — an attack is seconds of wall clock away at 1x, and that wait
 * measures the runner. It drives the same per-tick pipeline, so the
 * `attack` event and the `handleEvents` that draws it are the real ones;
 * it just does not age the clip, which starts on the first frame below.
 */
function sampleAClip(page: Page, { timed = false, maxFrames = 600 } = {}): Promise<Drawn[][]> {
  return page.evaluate(
    async ({ timed, max }) => {
      const board = window.mazeosaurBoard!();
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

      // Ticks until the first attack lands, checking once per frame so the
      // accessor has something to report. In batches, because one frame
      // per tick would spend a wall-clock minute getting invaders into
      // range of the post.
      for (let n = 0; n < 4000; n++) {
        board.advanceTicks(1);
        if (n % 40 === 39) {
          await frame();
          if (board.strikeLayerDrawn.length > 0) break;
        }
      }

      // Those batches are also why a *timed* caller cannot measure the
      // clip they produced. The strike ages on `update()`'s real `delta`,
      // and the frame that follows a batch carries the whole time the
      // batch blocked the thread for — enough to land the first drawn
      // frame on step 2 and lose step 1 entirely. So wait this clip out
      // and catch the next one, which the migration throws on its own at
      // ordinary frame deltas.
      if (timed) {
        for (let i = 0; i < 200 && board.strikeLayerDrawn.length > 0; i++) await frame();
      }

      const samples: Drawn[][] = [];
      for (let i = 0; i < max; i++) {
        await frame();
        const live = board.strikeLayerDrawn;
        if (live.length > 0) samples.push(live);
        else if (samples.length > 0) break;
      }
      return samples;
    },
    { timed, max: maxFrames },
  );
}

const step = (s: Drawn) => Number(s.frame.slice(-1));

/**
 * `STRIKE_STEP_MS` summed, which is `STRIKE_TTL` in `BoardScene.ts`: 50ms of
 * wind-up, 90ms of full extension, 120ms of the mark left behind.
 *
 * Written out here because the multi-victim test below rests on it. At 1x a
 * clip is only shorter than every cooldown by arithmetic, and the moment it
 * is not, a clip opening on step 2 stops being evidence of anything — so
 * that test asserts the gap rather than assuming it.
 */
const CLIP_MS = 50 + 90 + 120;
/** Ticks are 50ms; `TICKS_PER_SECOND` is the sim's, so a content edit moves it. */
const TICK_MS = 1000 / TICKS_PER_SECOND;

/** The `cooldown` in milliseconds at 1x of the hatchling the tray places for `kind`. */
function cooldownMs(kind: string): number {
  const def = hatchlings.find((d) => d.kind === kind);
  expect(def, `no hatchling for ${kind}`).toBeDefined();
  return def!.cooldown * TICK_MS;
}

test("every kind's attack draws its own strike, on its own cell, at the atlas's own scale", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);

  const seen: string[] = [];
  for (const [i, kind] of KINDS.entries()) {
    // `again(SEED)` rather than a reload: the same valley and the same
    // migration every time, so the only thing that differs between the six
    // iterations is which kind is throwing.
    if (i > 0) await startBoard(page, again(SEED), "restart");
    await postOneAndSend(page, kind);
    const samples = await sampleAClip(page);
    expect(samples.length, `${kind} struck nothing`).toBeGreaterThan(0);
    for (const s of samples.flat()) {
      expect(s.frame, `${kind} drew ${s.frame}`).toMatch(new RegExp(`^strike-${kind}-[123]$`));
      // 45/64, and the trap is that it is not 45/128: a strike frame is
      // two authored squares wide to buy the swing its reach at the
      // animal's own world scale, so the frame's own width is never the
      // denominator.
      expect(s.scale).toBeCloseTo(45 / 64, 6);
      // The cell centre, not a pair of feet: the strike is anchored on the
      // thrower's cell and is never pointed at the target.
      expect(s.x).toBeCloseTo(POST.x * CELL_PX + CELL_PX / 2, 6);
      expect(s.y).toBeCloseTo(POST.y * CELL_PX + CELL_PX / 2, 6);
    }
    seen.push(samples[0]![0]!.frame.replace(/-\d$/, ""));
  }
  // Six kinds, six silhouettes. A renderer that drew one shape for all of
  // them passes every assertion above and fails this one, and that is the
  // exact defect the owner reported on the demo.
  expect(new Set(seen).size, `six kinds drew: ${seen.join(", ")}`).toBe(6);
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("the strike draws over the animals, under its own tracer, and under the HUD", async ({ page }) => {
  await openGame(page, SEED);
  // §5.4.1's depth sentence, in the order the renderer resolves it. The
  // tracer on top is the load-bearing half: it is 2px against a full-cell
  // opaque silhouette, so beneath the strike it appears to start at the
  // silhouette's edge rather than at the animal, and with two dinosaurs in
  // adjacent cells firing at one invader the pairing of tracer to attacker
  // is what is lost.
  expect(await page.evaluate(() => window.mazeosaurBoard!().boardLayerOrder)).toEqual(["animals", "strikes", "tracers", "hud"]);
});

test("one swing is one strike, however many victims the sim reports it against", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  // `flier-1` is `targetCount: 2`, so a swing that finds two invaders in
  // range is two `attack` events in the same tick for one swing. Keyed by
  // the event rather than by the dinosaur that is two sprites stacked on
  // one cell at double alpha; keyed by the thrower it is one.
  await postOneAndSend(page, "flier");
  const samples = await sampleAClip(page);
  expect(samples.length, "the flier struck nothing").toBeGreaterThan(0);
  const widest = Math.max(...samples.map((live) => live.length));
  expect(widest, "one dinosaur drew more than one strike at once").toBe(1);

  // ...and that the premise held. A run in which the flier never did hit
  // two at once would pass the line above having tested nothing, and the
  // renderer cannot be the witness because not counting events is the
  // whole change. So ask the sim directly, which means `tick()` and
  // `drainEvents()` rather than `advanceTicks` — the scene's own loop
  // drains the events before a test can see them. It runs the sim past
  // the board, which is why it is the last thing this test does.
  const multi = await page.evaluate(() => {
    const sim = window.mazeosaurBoard!().sim;
    let best = 0;
    for (let n = 0; n < 2000 && best < 2 && (sim.state.phase === "build" || sim.state.phase === "migration"); n++) {
      sim.tick();
      let hits = 0;
      for (const e of sim.drainEvents()) if (e.type === "attack") hits++;
      best = Math.max(best, hits);
    }
    return best;
  });
  expect(multi, "the flier never attacked two invaders in one tick, so the line above proved nothing").toBeGreaterThanOrEqual(2);
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("a multi-victim swing still opens on the wind-up, because its sibling events are not a second swing", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  await postOneAndSend(page, "flier");

  // The discriminator this test rests on, asserted and not assumed: at 1x a
  // flier hatchling's cooldown is 600ms against a 260ms clip, so a clip is
  // always over before the next swing and no *later* attack can sustain one.
  // A clip that opens on step 2 here therefore has one explanation — a
  // same-tick sibling of the swing that started it. If a content edit ever
  // takes `flier-1`'s cooldown under the clip, this line fails rather than
  // the test quietly going on to prove nothing.
  expect(cooldownMs("flier"), "a flier's cooldown no longer outlasts the clip, so this test's premise is gone").toBeGreaterThan(CLIP_MS);

  // `timed` for the same reason the three-step test below uses it: a clip
  // thrown on the frame after a batch of ticks carries the batch's whole
  // blocking time and lands its first drawn frame on step 2 regardless. So
  // wait that one out and measure the next, which the migration throws at
  // ordinary frame deltas.
  const samples = (await sampleAClip(page, { timed: true })).map((live) => live[0]!);
  expect(samples.length, "the flier struck nothing").toBeGreaterThan(2);
  const steps = samples.map(step);
  // The whole clip, wind-up included. `flier-1` is `targetCount: 2`, so a
  // swing that finds two invaders is two `attack` events in one tick, and
  // treating the second as a further attack sustains the strike to 210ms
  // before its first frame is ever drawn: step 1 is dropped, and the opening
  // silhouette then depends on how crowded the lane is — the opposite of a
  // shape a player learns once. Every splash kind does the same.
  expect(new Set(steps), `steps seen: ${steps.join("")}`).toEqual(new Set([1, 2, 3]));
  for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);

  // ...and that the swing measured really could be a multi-victim one. The
  // renderer cannot be the witness, because not counting the siblings is the
  // whole change, so ask the sim: `tick()` and `drainEvents()`, which runs
  // the sim past the board and is why it is the last thing here.
  const multi = await page.evaluate(() => {
    const sim = window.mazeosaurBoard!().sim;
    let best = 0;
    for (let n = 0; n < 2000 && best < 2 && (sim.state.phase === "build" || sim.state.phase === "migration"); n++) {
      sim.tick();
      let hits = 0;
      for (const e of sim.drainEvents()) if (e.type === "attack") hits++;
      best = Math.max(best, hits);
    }
    return best;
  });
  expect(multi, "the flier never attacked two invaders in one tick, so the clip above proved nothing").toBeGreaterThanOrEqual(2);
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("a second attack sustains the strike at step 2 instead of replaying the wind-up", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  await postOneAndSend(page, "raptor");
  // At 3x a raptor hatchling's 10-tick cooldown is about 167ms against a
  // 260ms clip, so it attacks again before the clip ends — which is the
  // case the sustain rule is for.
  await page.evaluate(() => {
    (window.mazeosaurBoard!() as unknown as { speed: number }).speed = 3;
  });
  // A window inside the burst, not a whole clip: under sustain the clip
  // does not end while the raptor keeps firing, so waiting one out is a
  // wait for the migration.
  const samples = (await sampleAClip(page, { maxFrames: 60 })).map((live) => live[0]!);
  expect(samples.length, "the strike never drew").toBeGreaterThan(4);
  const steps = samples.map(step);
  // The wind-up says where the weapon came from, so it belongs at the
  // start of a burst and nowhere else: a weapon already out does not wind
  // up again. Replaying it per attack would alternate two silhouettes at
  // 10Hz and the kind would be the thing that dropped out — which is what
  // this count catches, and the only thing in this file that does.
  expect(steps.filter((n) => n === 1).length, `steps seen: ${steps.join("")}`).toBeLessThanOrEqual(1);
  // Full extension is what holds instead: the frame that carries the kind,
  // getting more screen time exactly when the board is busiest.
  expect(steps.filter((n) => n === 2).length, `steps seen: ${steps.join("")}`).toBeGreaterThan(1);
  // Deliberately *not* monotone, unlike one uninterrupted clip. A strike
  // that has reached step 3 because the burst was ending, and then takes
  // another attack, resumes at step 2 — that is sustain working, not a
  // rewind, and the rule it must obey is only that it never resumes at 1.
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("the clip runs its three steps in order and fades out on the one that holds no weapon", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  await postOneAndSend(page, "tyrant");

  const samples = (await sampleAClip(page, { timed: true })).map((live) => live[0]!);
  expect(samples.length, "the strike never drew").toBeGreaterThan(2);
  const steps = samples.map(step);

  // All three, in order. Which frame falls in which step depends on how
  // long the runner's frames are; that they never go backwards does not.
  // Step 3 is the mark left behind and holds no weapon, so a clip that
  // returned to one would read as a rewind under the fade.
  expect(new Set(steps), `steps seen: ${steps.join("")}`).toEqual(new Set([1, 2, 3]));
  for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
  // Opaque until the last step, fading only on it, and gone at the end.
  for (const s of samples) if (step(s) < 3) expect(s.alpha).toBe(1);
  expect(step(samples.at(-1)!)).toBe(3);
  expect(samples.at(-1)!.alpha).toBeLessThan(1);
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("reduced motion draws step 2 alone, which is the frame that carries the kind", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGame(page, SEED);
  await postOneAndSend(page, "horned");

  const samples = (await sampleAClip(page, { timed: true })).map((live) => live[0]!);
  expect(samples.length, "the strike never drew").toBeGreaterThan(0);
  // Section 7: the clip does not play, and nothing is removed by that.
  // Step 2 is the frame a player actually sees at speed, so the kind still
  // reads; the movement is the only thing that goes.
  for (const s of samples) expect(s.frame).toBe("strike-horned-2");
  expect(samples.at(-1)!.alpha, "reduced motion still fades").toBeLessThan(1);
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});

test("a strike drawn before a restart cannot be drawn through after one", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGame(page, SEED);
  await postOneAndSend(page, "tyrant");
  expect((await sampleAClip(page)).length).toBeGreaterThan(0);

  // `restart-regression.spec.ts` restarts a board that never attacked, so
  // it never allocates a strike sprite and cannot see this: the pool and
  // the container holding it are per-run fields full of display objects
  // that `create()` destroys. A restart inheriting either draws through a
  // destroyed sprite on the restarted board's first attack — a renderer
  // error and a frozen canvas, with the sim ticking on underneath.
  await startBoard(page, again(SEED), "restart");
  expect(await page.evaluate(() => window.mazeosaurBoard!().strikeLayerDrawn), "the restarted board inherited a strike").toEqual([]);

  await postOneAndSend(page, "armored");
  const samples = await sampleAClip(page);
  expect(samples.length, "the restarted board drew no strike").toBeGreaterThan(0);
  expect(samples[0]![0]!.frame).toMatch(/^strike-armored-[123]$/);
  // Liveness, not just the absence of a throw: a stale display object
  // stalls the update loop whether or not Phaser also reports it.
  const before = await simSnapshot(page);
  await page.waitForFunction((t) => window.mazeosaurBoard!().sim.state.tick > t, before.tick, { timeout: 5_000 });
  expect(errors.messages, errors.messages.join("\n")).toEqual([]);
});
