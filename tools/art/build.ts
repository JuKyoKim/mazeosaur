// The asset generator. Nothing here ships; it writes what does.
//
//   node tools/art/build.ts frames     the three sample frames the board picks from
//   node tools/art/build.ts verify     the committed frames still match, without writing
//   node tools/art/build.ts compare    all three directions in one picture
//   node tools/art/build.ts atlas <id> the shipping atlases for one direction
//   node tools/art/build.ts check      colour-blindness, contrast and byte budget
//
// Every *pixel* here is a pure function of this directory, so a frame can be
// regenerated from a diff and nobody has to trust a binary. The bytes are
// not: `encodePng` compresses through the zlib the running Node links, and
// two zlib builds disagree on the same scanlines. So every comparison of a
// generated image against a committed one goes through `pngHasPixels`, and
// `png()` below leaves a file alone when only its compression would change.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { content, hatchlings } from "@mazeosaur/content";
import { ARCHETYPE_TELL, KIND_SILHOUETTE_NOTE, type Archetype } from "./bestiary.js";
import {
  BOARD,
  CHOSEN,
  DIRECTIONS,
  KINDS,
  KIND_HUE,
  MIN_DISTANCE,
  MIN_VALUE_RATIO,
  direction,
  kindColourChecks,
  simulate,
  type Direction,
  type Kind,
} from "./directions.js";
import { drawText, effectsPlate, renderBoardFrame } from "./frame.js";
import { CANVAS_H, CANVAS_W, CELL_PX, DRAW_CELLS, SCALE, fontScale, layoutTable, pt, TYPE } from "./layout.js";
import { encodePng, pngHasPixels } from "./png.js";
import { Raster, contrastRatio, darken, rect, rgb, type Rgb } from "./raster.js";
import { atlasJson, dinoSprite, invaderSprite, pack } from "./sprites.js";

const ROOT = join(import.meta.dirname, "..", "..");
const ARCHETYPES: readonly Archetype[] = ["normal", "fast", "tank", "flying", "swarm", "splitter", "regenerator", "shielded", "boss"];

function write(rel: string, data: Buffer | string): void {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  const kb = (statSync(p).size / 1024).toFixed(1);
  console.log(`  ${rel}  ${kb} kB`);
}

/**
 * Write a PNG, unless the file already there holds exactly these pixels.
 *
 * The skip is the whole point. A Node bump can change every byte of every
 * frame without changing a pixel, and a generator that rewrote them anyway
 * would turn CI's regenerate-and-diff red on a change to zlib rather than to
 * the art — a failure that reads as "the art drifted", which is the wrong
 * diagnosis entirely. Skipping makes `frames` idempotent on pixels, which is
 * what the diff is really asking about, and lets a frame be regenerated on
 * any machine. An unreadable file counts as needing a write; `verify` is the
 * command that reports it instead.
 */
function png(rel: string, r: Raster): void {
  const p = join(ROOT, rel);
  let holds = false;
  try {
    holds = existsSync(p) && pngHasPixels(readFileSync(p), r.w, r.h, r.px);
  } catch {
    holds = false;
  }
  if (holds) {
    console.log(`  ${rel}  unchanged`);
    return;
  }
  write(rel, encodePng(r.w, r.h, r.px));
}

/** Box-average resample to an arbitrary size: the honest "how big is it really". */
function resample(src: Raster, w: number, h: number): Raster {
  const out = new Raster(w, h);
  const fx = src.w / w;
  const fy = src.h / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      let n = 0;
      for (let sy = Math.floor(y * fy); sy < Math.max(Math.floor(y * fy) + 1, Math.ceil((y + 1) * fy)); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.max(Math.floor(x * fx) + 1, Math.ceil((x + 1) * fx)); sx++) {
          if (sx >= src.w || sy >= src.h) continue;
          const [pr, pg, pb, pa] = src.get(sx, sy);
          const wt = pa / 255;
          rr += pr * wt;
          gg += pg * wt;
          bb += pb * wt;
          aa += wt;
          n++;
        }
      }
      const i = (y * w + x) * 4;
      if (n && aa > 0) {
        out.px[i] = Math.round(rr / aa);
        out.px[i + 1] = Math.round(gg / aa);
        out.px[i + 2] = Math.round(bb / aa);
        out.px[i + 3] = Math.round((aa / n) * 255);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------- the frames

/** The reference phone's rendered size: what the eye actually subtends. */
const PHONE_W = Math.round(CANVAS_W * SCALE);
const PHONE_H = Math.round(CANVAS_H * SCALE);

/**
 * Break a note into lines that fit `cols` characters without splitting a
 * word. The 5x7 font is fixed-pitch, so a character count is a width; the
 * notes are the one place on this sheet where a reviewer is reading prose
 * rather than looking at a sprite, and a sentence cut off mid-clause is
 * worse than no sentence at all.
 */
function wrap(s: string, cols: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= cols) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

/**
 * The legibility sheet. Every dinosaur and every invader at exactly the size
 * it occupies on the reference phone, next to the same sprite at the logical
 * cell size. The left column is the only one that answers the question the
 * brief asks; the right column is there so a reviewer can see what detail
 * was in the sprite that failed to survive.
 *
 * It is also, measurably, the only plate that separates the directions from
 * each other. Differencing the committed frames pairwise at a per-channel
 * delta above 8, over a box twice the sprite size centred on each column:
 * `colBig` disagrees across 11.3-14.8% of its pixels and `colSmall` across
 * 7.4-8.9% — a consistent 1.5-1.7x per pixel of sprite. The box matters and
 * is part of the claim: `colSmall` and `colBig` are centres, not edges, and
 * measuring the whole span between them dilutes both figures to about 7%,
 * at which point the two columns look equal and the conclusion inverts.
 * Below the 92px header the note column is byte-identical and the label
 * column differs across 0.04% of its pixels — that is the double-size boss
 * sprite overhanging `colSmall - small`, not type. The header is the one
 * part of those columns a direction touches, because it prints the
 * direction's name. So a reviewer comparing
 * directions is sent here, and to `colBig` specifically — not to the sheet
 * frame, whose tray is direction-independent (see `doFrames`).
 */
function legibilitySheet(d: Direction): Raster {
  const small = Math.round(CELL_PX * SCALE); // 20px: the real cell on a 390pt phone
  const big = CELL_PX;
  const rowH = 46;
  const labelX = 16;
  const colSmall = 300;
  const colBig = 400;
  const noteX = 470;
  // The 5x7 font at TYPE.label advances 12px per character, so the note
  // column holds 46 characters per line and the row holds two of them.
  const noteCols = Math.floor((1040 - noteX - 16) / 12);
  const rows = KINDS.length * 3 + ARCHETYPES.length;
  const r = new Raster(1040, rows * rowH + 92);
  r.clear(BOARD.hud, 1);

  drawText(r, labelX, 16, `${d.name} — legibility`, TYPE.title, BOARD.text);
  drawText(r, labelX, 46, `left: ${small}px, the cell on a ${390}pt phone.  right: ${big}px logical.`, TYPE.label, BOARD.textDim);
  drawText(r, colSmall, 68, `${small}px`, TYPE.label, BOARD.textDim, "center");
  drawText(r, colBig, 68, `${big}px`, TYPE.label, BOARD.textDim, "center");

  let y = 92;
  for (const kind of KINDS) {
    for (const stage of [1, 2, 3] as const) {
      const def = Object.values(content.dinos).find((x) => x.kind === kind && x.stage === stage);
      const sprite = dinoSprite(kind, stage, d);
      r.fill(rect(0, y, r.w, rowH - 1), stage === 1 ? BOARD.hudPanel : BOARD.hud, 1, 1);
      drawText(r, labelX, y + 10, def?.name ?? `${kind}-${stage}`, TYPE.label, BOARD.text);
      drawText(r, labelX, y + 28, `${kind} ${["", "hatchling", "juvenile", "adult"][stage]}`, TYPE.label, BOARD.textDim);
      r.blit(resample(sprite, small, small), colSmall - small / 2, y + (rowH - small) / 2);
      r.blit(resample(sprite, big, big), colBig - big / 2, y + (rowH - big) / 2);
      wrap(KIND_SILHOUETTE_NOTE[kind], noteCols, 2).forEach((line, i) => drawText(r, noteX, y + 9 + i * 18, line, TYPE.label, BOARD.textDim));
      y += rowH;
    }
  }
  for (const a of ARCHETYPES) {
    const kind = KINDS[ARCHETYPES.indexOf(a) % KINDS.length] as Kind;
    const sprite = invaderSprite(a, kind, d);
    const sm = a === "boss" ? small * 2 : a === "swarm" ? Math.round(small * 0.8) : small;
    const bg = a === "boss" ? big * 2 : a === "swarm" ? Math.round(big * 0.8) : big;
    r.fill(rect(0, y, r.w, rowH - 1), BOARD.hudPanel, 1, 1);
    drawText(r, labelX, y + 16, a, TYPE.body, BOARD.text);
    if (a === "swarm") {
      // never alone, so never shown alone
      for (let k = -1; k <= 1; k++) {
        r.blit(resample(sprite, sm, sm), colSmall - sm / 2 + k * (sm - 3), y + (rowH - sm) / 2);
        r.blit(resample(sprite, bg, bg), colBig - bg / 2 + k * (bg - 5), y + (rowH - bg) / 2);
      }
    } else {
      r.blit(resample(sprite, sm, sm), colSmall - sm / 2, y + (rowH - sm) / 2);
      r.blit(resample(sprite, bg, bg), colBig - bg / 2, y + (rowH - bg) / 2);
    }
    wrap(ARCHETYPE_TELL[a], noteCols, 2).forEach((line, i) => drawText(r, noteX, y + 9 + i * 18, line, TYPE.label, BOARD.textDim));
    y += rowH;
  }
  return r;
}

/** A rectangle of a raster, copied out. */
function crop(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const out = new Raster(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [r, g, b, a] = src.get(x + i, y + j);
      const k = (j * w + i) * 4;
      out.px[k] = r;
      out.px[k + 1] = g;
      out.px[k + 2] = b;
      out.px[k + 3] = a;
    }
  }
  return out;
}

/**
 * The comparison sheet: all three directions in one picture.
 *
 * The per-direction frames answer "is this direction legible"; none of them
 * answers "which of these three do I want", because that question needs the
 * three held against each other and a reader cannot hold three screenshots
 * in their head. And the two obvious candidates for the job mislead: at
 * phone scale the board area of the frames differs across about one pixel
 * in twelve, and the sheet frame's tray is HUD type, which no direction
 * touches at all. Both of those are measured, beside the plate each is
 * about — see `legibilitySheet` and `doFrames`. A reader sent to compare
 * those compares three pictures that genuinely look alike.
 *
 * What separates them is the drawing: the outline weight, the proportions
 * and the palette. So each subject appears three times per direction — at
 * 20px, which is the true cell on the reference phone; at 36px, the logical
 * cell; and at 96px, where the treatment is actually visible. The 96px
 * column is not a claim about how the game looks. It is there so a reader
 * can see *what* is different before deciding whether they care at 20.
 */
function compareSheet(): Raster {
  const subjects: { label: string; sub: string; sprite: (d: Direction) => Raster }[] = [
    ...KINDS.map((kind) => {
      const def = Object.values(content.dinos).find((x) => x.kind === kind && x.stage === 3);
      return {
        label: def?.name ?? kind,
        sub: `${kind} adult`,
        sprite: (d: Direction) => dinoSprite(kind, 3, d),
      };
    }),
    { label: "boss", sub: "the migration-50 boss", sprite: (d: Direction) => invaderSprite("boss", "tyrant", d) },
    { label: "swarm", sub: "the smallest invader", sprite: (d: Direction) => invaderSprite("swarm", "flier", d) },
  ];

  const labelX = 16;
  const colW = 320;
  const colGap = 12;
  // The label column is sized to the longest genus name at TYPE.body rather
  // than guessed: Argentinosaurus is 15 characters, and a column that fits
  // the average name clips that one into the first sprite.
  const nameAdvance = 6 * fontScale(TYPE.body);
  const labelW = Math.max(...subjects.map((s) => s.label.length)) * nameAdvance + 24;
  const colX = (i: number) => labelX + labelW + i * (colW + colGap);
  const sizes = [Math.round(CELL_PX * SCALE), CELL_PX, 96] as const; // 20, 36, 96
  const slot = [46, 110, 230] as const; // slot centres within a column
  const rowH = 112;
  const rowsY = 196;
  const stripY = rowsY + subjects.length * rowH + 28;
  const stripH = 300;

  const COST = `Fossil Pixel passes the colour-blindness check as drawn. The other three repaint the kind hues before they reach the board, so each needs its own hue table - about an afternoon, and it travels with whichever wins. Toy Box needs the least of that work and Valley Naturalist the most. Toy Box is also the only one that is not a flat drawing: same board, same square grid, but every animal is a solid under one fixed camera. That camera spends pixels on a top face which the others spend on the profile, so judge it on the 20px column rather than the 96px one. Atlas sizes run 23 kB to 126 kB, all irrelevant against a 40 MB binary.`;

  // The surface is sized to the prose, not the other way round: measure the
  // footer's wrapped height before allocating, so adding a sentence can
  // never push it off the bottom edge.
  const width = colX(DIRECTIONS.length - 1) + colW + 10;
  const proseCols = Math.floor((width - labelX * 2) / (6 * fontScale(TYPE.label)));
  const footLines = wrap(COST, proseCols, 99).length;
  const r = new Raster(width, stripY + 24 + stripH + 42 + footLines * 20 + 16);
  r.clear(BOARD.hud, 1);

  // Every run of prose on this sheet is wrapped to the surface rather than
  // trusted to fit. A caption that runs off the right edge is the one defect
  // a reader cannot see is a defect — it reads as a finished sentence.
  // No line cap: `wrap` silently drops everything past `maxLines`, which is
  // the same failure as a caption running off the edge — the text that
  // survives still reads as a finished sentence. Here the surface grows to
  // the prose instead of the prose being cut to the surface.
  const cols = Math.floor((r.w - labelX * 2) / (6 * fontScale(TYPE.label)));
  const proseLines = (s: string): string[] => wrap(s, cols, 99);
  const prose = (y: number, s: string, c = BOARD.textDim): number => {
    const lines = proseLines(s);
    lines.forEach((line, i) => drawText(r, labelX, y + i * 20, line, TYPE.label, c));
    return y + lines.length * 20;
  };

  // The count comes from DIRECTIONS rather than from the sentence. A fourth
  // direction was added after this sheet was written, and every "three" in
  // the prose became a lie that still read as a finished sentence.
  const n = DIRECTIONS.length;
  const many = ["", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
  drawText(r, labelX, 16, `${many[0]?.toUpperCase()}${many.slice(1)} directions, one picture`, TYPE.title, BOARD.text);
  const ruleY =
    prose(
      52,
      `the same dinosaurs, drawn ${many} ways. 20px is the cell on a 390pt phone; 96px is only there to show what differs. all ${many} are already built and read at 20px. this is a taste call.`,
    ) + 12;

  DIRECTIONS.forEach((d, i) => {
    const x = colX(i);
    r.fill(rect(x, ruleY, colW, 3), BOARD.text, 0.5, 1);
    drawText(r, x + 4, ruleY + 12, d.name, TYPE.body, BOARD.text);
    drawText(r, x + 4, ruleY + 42, `${d.axes.render}, ${d.axes.register}`, TYPE.label, BOARD.textDim);
    sizes.forEach((s, j) => drawText(r, x + slot[j]!, ruleY + 68, `${s}px`, TYPE.label, BOARD.textDim, "center"));
  });

  subjects.forEach((subject, row) => {
    const y = rowsY + row * rowH;
    r.fill(rect(0, y, r.w, rowH - 2), row % 2 === 0 ? BOARD.hudPanel : BOARD.hud, 1, 1);
    drawText(r, labelX, y + 38, subject.label, TYPE.body, BOARD.text);
    drawText(r, labelX, y + 62, subject.sub, TYPE.label, BOARD.textDim);
    DIRECTIONS.forEach((d, i) => {
      const sprite = subject.sprite(d);
      sizes.forEach((s, j) => {
        const px = Math.round(s * (subject.label === "boss" ? 1.6 : subject.label === "swarm" ? 0.8 : 1));
        const cx = colX(i) + slot[j]!;
        const cy = y + (rowH - px) / 2;
        // "half size, and never alone" is the swarm's whole tell, so it is
        // never shown alone here either — legibilitySheet already draws three.
        if (subject.label === "swarm") {
          // Tight enough that the three read as one cluster at every size:
          // a gap proportional to the sprite, not a constant.
          for (let k = -1; k <= 1; k++) r.blit(resample(sprite, px, px), cx - px / 2 + k * px * 0.42, cy);
        } else {
          r.blit(resample(sprite, px, px), cx - px / 2, cy);
        }
      });
    });
  });

  // The same crop of the same board in each direction, side by side. At
  // logical scale, so the cell is 36px: the true-size board is the job of
  // the *-board-phone.png frames and this strip would be unreadable there.
  drawText(r, labelX, stripY, "the same corner of the same board, at logical scale (36px cell; the phone shows 20px)", TYPE.label, BOARD.textDim);
  DIRECTIONS.forEach((d, i) => {
    const board = renderBoardFrame(d, { migration: 49, ticks: 260, effects: true });
    r.blit(crop(board, 200, 130, colW, stripH), colX(i), stripY + 24);
  });

  const footY = stripY + 24 + stripH + 20;
  drawText(r, labelX, footY, "What each one costs you, honestly:", TYPE.label, BOARD.text);
  prose(footY + 22, COST);
  return r;
}

/** Six kind hues under normal vision and the three dichromacies, as swatches. */
function colourSheet(): Raster {
  const visions = ["normal", "deuteranopia", "protanopia", "tritanopia"] as const;
  const cw = 96;
  const ch = 54;
  const r = new Raster(16 + KINDS.length * cw + 16, 78 + visions.length * ch + 16);
  r.clear(BOARD.hud, 1);
  drawText(r, 16, 14, "Kind hues under four eyes", TYPE.title, BOARD.text);
  drawText(r, 16, 44, "every column must stay distinct from every other, by hue or by value", TYPE.label, BOARD.textDim);
  KINDS.forEach((k, i) => drawText(r, 16 + i * cw + cw / 2, 64, k, TYPE.label, BOARD.text, "center"));
  visions.forEach((v, row) => {
    const y = 78 + row * ch;
    KINDS.forEach((k, i) => {
      const base = rgb(KIND_HUE[k]);
      const c: Rgb = v === "normal" ? base : simulate(base, v);
      r.fill(rect(16 + i * cw, y, cw - 4, ch - 10), c, 1, 1);
    });
    drawText(r, 20, y + 6, v.slice(0, 5), TYPE.label, contrastRatio(BOARD.text, rgb(KIND_HUE.armored)) > 3 ? BOARD.text : rgb(0x111111));
  });
  return r;
}

/**
 * Every frame `frames` owns, generated in memory and not yet written. One
 * list, so `doFrames` and `doVerify` can never disagree about which files
 * belong to the generator — which is what lets `verify` call a PNG in
 * `docs/art/` that is missing from this list an extra frame.
 */
function generatedFrames(): { rel: string; raster: Raster }[] {
  const out: { rel: string; raster: Raster }[] = [];
  for (const d of DIRECTIONS) {
    // Migration 49, 260 ticks in: a `fast` migration strung across two
    // corridors of the maze, which is the state the board should judge.
    const board = renderBoardFrame(d, { migration: 49, ticks: 260, effects: true });
    out.push({ rel: `docs/art/${d.id}-board.png`, raster: board });
    out.push({ rel: `docs/art/${d.id}-board-phone.png`, raster: resample(board, PHONE_W, PHONE_H) });

    // Migration 50, the Spinosaurus boss, with a dinosaur selected so the
    // frame carries the sheet tray and a refusal toast as well.
    //
    // This plate shows the tray; it does not compare directions. The tray is
    // HUD type and buttons, which no direction touches: differencing the
    // committed `*-sheet-phone.png` pairwise, the HUD band below `HUD_Y`
    // disagrees across 0.25-0.39% of its pixels (antialiasing on glyphs),
    // against 6.6-8.2% for the board area above it. Every visible difference
    // in this frame is in the board region the `*-board-phone.png` plate
    // already shows better. Compare directions on the legibility sheet.
    const sheet = renderBoardFrame(d, { migration: 50, ticks: 800, selectSheet: true, toast: "That would seal the maze", effects: true });
    out.push({ rel: `docs/art/${d.id}-sheet.png`, raster: sheet });
    out.push({ rel: `docs/art/${d.id}-sheet-phone.png`, raster: resample(sheet, PHONE_W, PHONE_H) });

    out.push({ rel: `docs/art/${d.id}-legibility.png`, raster: legibilitySheet(d) });
    out.push({ rel: `docs/art/${d.id}-effects.png`, raster: effectsPlate(d) });
  }
  out.push({ rel: "docs/art/kind-hues.png", raster: colourSheet() });
  out.push({ rel: "docs/art/directions-compared.png", raster: compareSheet() });
  return out;
}

function doFrames(): void {
  console.log("sample frames (board at 720x1280, and at the reference phone's rendered size)");
  for (const { rel, raster } of generatedFrames()) png(rel, raster);
}

/**
 * Check the committed frames without touching the tree: every frame the
 * generator produces must already be on disk with exactly those pixels, and
 * `docs/art/` must hold no PNG the generator does not produce.
 *
 * Pixels, not bytes, because only the pixels are reproducible — see the note
 * on `encodePng`'s IDAT chunk. That loses nothing a byte comparison had: a
 * changed frame differs in pixels, a deleted one is missing, an added one is
 * extra. It gains immunity to the zlib the runner's Node happens to link, so
 * a Node bump cannot be mistaken for the art drifting.
 */
function doVerify(): void {
  const produced = generatedFrames();
  const owned = new Set<string>();
  let bad = 0;

  for (const { rel, raster } of produced) {
    owned.add(rel);
    const p = join(ROOT, rel);
    if (!existsSync(p)) {
      console.error(`  MISSING    ${rel}`);
      bad++;
      continue;
    }
    let same: boolean;
    try {
      same = pngHasPixels(readFileSync(p), raster.w, raster.h, raster.px);
    } catch (e) {
      console.error(`  UNREADABLE ${rel}  ${(e as Error).message}`);
      bad++;
      continue;
    }
    if (same) {
      console.log(`  ok         ${rel}  ${raster.w}x${raster.h}`);
    } else {
      console.error(`  CHANGED    ${rel}`);
      bad++;
    }
  }

  for (const name of readdirSync(join(ROOT, "docs/art")).sort()) {
    if (!name.endsWith(".png") || owned.has(`docs/art/${name}`)) continue;
    console.error(`  EXTRA      docs/art/${name}`);
    bad++;
  }

  if (bad) {
    console.error(`\n${bad} frame(s) do not match the generator. Run \`npm run art:frames\` and commit the result.`);
    process.exit(1);
  }
  console.log(`\nall ${produced.length} frames match the generator, pixel for pixel`);
}

// ---------------------------------------------------------------- the atlases

function doAtlas(id: string): void {
  const d = direction(id);
  console.log(`atlas for ${d.name} (${d.id}), authored at ${d.spritePx}px`);
  const dinos = KINDS.flatMap((kind) =>
    ([1, 2, 3] as const).map((stage) => ({ name: `${kind}-${stage}`, raster: dinoSprite(kind, stage, d) })),
  );
  const invaders = ARCHETYPES.flatMap((a) => KINDS.map((kind) => ({ name: `${a}-${kind}`, raster: invaderSprite(a, kind, d) })));
  const width = d.spritePx <= 24 ? 256 : 512;

  const da = pack(dinos, width);
  png(`packages/game/assets/${d.id}/dinos.png`, da.raster);
  write(`packages/game/assets/${d.id}/dinos.json`, atlasJson(da, "dinos.png", d.spritePx, CELL_PX, DRAW_CELLS));

  const ia = pack(invaders, width);
  png(`packages/game/assets/${d.id}/invaders.png`, ia.raster);
  write(`packages/game/assets/${d.id}/invaders.json`, atlasJson(ia, "invaders.png", d.spritePx, CELL_PX, DRAW_CELLS));

  console.log(`  ${da.frames.length} dinosaur frames, ${ia.frames.length} invader frames`);
}

// ------------------------------------------------------------------ the check

function doCheck(): void {
  let bad = 0;

  console.log("\nkind hues: every pair, four eyes");
  const { worst, failures } = kindColourChecks();
  for (const p of worst) {
    const ok = p.distance >= MIN_DISTANCE || p.valueRatio >= MIN_VALUE_RATIO;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${p.a.padEnd(9)} vs ${p.b.padEnd(9)} ${p.vision.padEnd(13)} distance ${p.distance.toFixed(0).padStart(4)}  value ${p.valueRatio.toFixed(2)}`,
    );
  }
  if (failures.length) {
    bad += failures.length;
    console.log(`  ${failures.length} pair(s) separated by neither hue nor value`);
  }

  // The hues above are what the HUD chips and the kind buttons use. Each
  // direction repaints them before they reach the board, so the separation
  // tuned into KIND_HUE is not necessarily the separation the player gets.
  //
  // Advisory, not a failure, and deliberately so: until a direction is
  // chosen there is no single answer to grade, and the right fix is to
  // re-run the constrained search that produced KIND_HUE against the
  // winning direction's transform rather than to flatten all three toward
  // the one that happens to pass. Once a direction is chosen this should
  // become a gate.
  console.log("\nthe same pairs in each direction's body colour (advisory until a direction is chosen)");
  for (const d of DIRECTIONS) {
    const c = kindColourChecks((k) => d.palette(KIND_HUE[k]).base);
    const detail = c.failures.length
      ? c.failures.map((f) => `${f.a}/${f.b} ${f.vision} d${f.distance.toFixed(0)} v${f.valueRatio.toFixed(2)}`).join(", ")
      : `tightest ${c.worst[0]?.a}/${c.worst[0]?.b} d${c.worst[0]?.distance.toFixed(0)}`;
    console.log(`  ${c.failures.length ? "warn" : "ok  "} ${d.id.padEnd(20)} ${detail}`);
  }

  console.log("\nHUD contrast on the panel colours (WCAG AA body text is 4.5)");
  const pairs: [string, Rgb, Rgb][] = [
    ["text on HUD", BOARD.text, BOARD.hud],
    ["text on panel", BOARD.text, BOARD.hudPanel],
    ["dim on HUD", BOARD.textDim, BOARD.hud],
    ["dim on panel", BOARD.textDim, BOARD.hudPanel],
    ["meat on HUD", BOARD.meat, BOARD.hud],
    ["eggs on HUD", BOARD.eggs, BOARD.hud],
    ["text on Send", BOARD.text, BOARD.buttonActive],
    ["text on Sell", BOARD.text, BOARD.buttonDanger],
    ["text on button", BOARD.text, BOARD.button],
    ["text on toast", BOARD.text, darken(rgb(0x0b120d), 0)],
  ];
  for (const [what, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= 4.5;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${what.padEnd(16)} ${ratio.toFixed(2)}`);
  }

  console.log("\nhit targets (44 CSS points is the floor)");
  for (const row of layoutTable()) {
    if (!row.logical.includes("x") || row.what.startsWith("type")) continue;
    console.log(`  ${row.what.padEnd(22)} ${row.logical.padEnd(22)} ${row.points} pt`);
  }

  // A sprite touching its own frame border has been clipped, and what goes
  // first is the ink dilation drawn *outside* the body — so the sprite still
  // looks like a sprite and simply loses its outline on one edge. The boss
  // did exactly that: 26 border pixels and a flat-topped crown, with nothing
  // in any check that noticed. Trimming the atlas does not recover it: `pack`
  // trims to the ink that survived, so the authored square is a working area
  // and a pixel at its edge is a pixel that was thrown away.
  //
  // Gated for the direction that ships and reported for the other three,
  // which is the exemption that was left open when this check was added.
  // The reason is not a difference of art intent — it is that those three are
  // the *record of how the choice was made*. Their frames in `docs/art/` are
  // what the board looked at; regenerating them to pull the ink in a pixel
  // would edit the evidence, and nothing in them is in an atlas. Measured, it
  // is also not the per-genus appendage overhang the bestiary licenses: the
  // contact is on the left edge, in the same amount for every kind of a given
  // archetype, so it comes from the shared silhouette reaching x = 0 rather
  // than from a wing tip. Fossil Pixel touches on 48 of 72 frames (133 px in
  // all), Clay Pack on 57 (606 px, and the only one losing *feet* — cute
  // proportions inflate mass into the bottom edge), Valley Naturalist on 42
  // (150 px). Toy Box: none.
  //
  // Every frame in the atlas is measured, not one kind per archetype. The
  // first version of this check sampled `tyrant` only, so it was gating the
  // shipping direction on 9 of its 54 invader frames.
  console.log("\nsprites clear of their frame border (gated for the chosen direction)");
  const edge = (r: Raster): number => {
    let n = 0;
    for (let x = 0; x < r.w; x++) {
      if (r.get(x, 0)[3] > 8) n++;
      if (r.get(x, r.h - 1)[3] > 8) n++;
    }
    for (let y = 0; y < r.h; y++) {
      if (r.get(0, y)[3] > 8) n++;
      if (r.get(r.w - 1, y)[3] > 8) n++;
    }
    return n;
  };
  for (const d of DIRECTIONS) {
    let worst = 0;
    let worstName = "";
    let touching = 0;
    let total = 0;
    let frames = 0;
    const note = (name: string, r: Raster): void => {
      const n = edge(r);
      frames++;
      total += n;
      if (n) touching++;
      if (n > worst) {
        worst = n;
        worstName = name;
      }
    };
    for (const k of KINDS) for (const s of [1, 2, 3] as const) note(`${k}-${s}`, dinoSprite(k, s, d));
    for (const a of ARCHETYPES) for (const k of KINDS) note(`${a}-${k}`, invaderSprite(a, k, d));
    const shipped = d.id === CHOSEN.id;
    if (worst && shipped) bad++;
    const tag = !worst ? "ok  " : shipped ? "FAIL" : "warn";
    const detail = worst ? `${touching}/${frames} frames, ${total} px, worst ${worst} on ${worstName}` : `${frames} frames clear`;
    console.log(`  ${tag} ${d.id.padEnd(20)} ${detail}${shipped ? "  (shipped)" : ""}`);
  }

  console.log("\natlas bytes per direction");
  for (const d of DIRECTIONS) {
    const dinos = KINDS.flatMap((k) => ([1, 2, 3] as const).map((s) => ({ name: `${k}-${s}`, raster: dinoSprite(k, s, d) })));
    const invs = ARCHETYPES.flatMap((a) => KINDS.map((k) => ({ name: `${a}-${k}`, raster: invaderSprite(a, k, d) })));
    const w = d.spritePx <= 24 ? 256 : 512;
    const da = pack(dinos, w);
    const ia = pack(invs, w);
    const bytes = encodePng(da.raster.w, da.raster.h, da.raster.px).length + encodePng(ia.raster.w, ia.raster.h, ia.raster.px).length;
    console.log(
      `  ${d.id.padEnd(20)} ${String(d.spritePx).padStart(2)}px  ${da.frames.length + ia.frames.length} frames  ${(bytes / 1024).toFixed(1)} kB  (${da.raster.w}x${da.raster.h} + ${ia.raster.w}x${ia.raster.h})`,
    );
  }

  console.log(`\nreference phone ${390}x${844}pt, scale ${SCALE.toFixed(4)}, cell ${pt(CELL_PX)}pt, hatchlings ${hatchlings.length}`);
  if (bad) {
    console.error(`\n${bad} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks pass");
}

// ------------------------------------------------------------------- the CLI

const [cmd, arg] = process.argv.slice(2);
if (cmd === "frames") doFrames();
else if (cmd === "verify") doVerify();
else if (cmd === "compare") png("docs/art/directions-compared.png", compareSheet());
else if (cmd === "atlas") doAtlas(arg ?? CHOSEN.id);
else if (cmd === "check") doCheck();
else {
  console.log("usage: node tools/art/build.ts [frames|verify|atlas <direction>|check]");
  console.log(`directions: ${DIRECTIONS.map((d) => d.id).join(", ")}`);
  process.exit(1);
}
