// The asset generator. Nothing here ships; it writes what does.
//
//   node tools/art/build.ts frames     the three sample frames the board picks from
//   node tools/art/build.ts compare    all three directions in one picture
//   node tools/art/build.ts atlas <id> the shipping atlases for one direction
//   node tools/art/build.ts check      colour-blindness, contrast and byte budget
//
// Every output is a pure function of this directory, so a frame can be
// regenerated from a diff and nobody has to trust a binary.

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { content, hatchlings } from "@mazeosaur/content";
import { ARCHETYPE_TELL, KIND_SILHOUETTE_NOTE, type Archetype } from "./bestiary.js";
import {
  BOARD,
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
import { CANVAS_H, CANVAS_W, CELL_PX, SCALE, fontScale, layoutTable, pt, TYPE } from "./layout.js";
import { encodePng } from "./png.js";
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

function png(rel: string, r: Raster): void {
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
 * The legibility sheet. Every dinosaur and every invader at exactly the size
 * it occupies on the reference phone, next to the same sprite at the logical
 * cell size. The left column is the only one that answers the question the
 * brief asks; the right column is there so a reviewer can see what detail
 * was in the sprite that failed to survive.
 */
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
 * in their head. The board frames are nearly identical at phone scale and
 * the sheet tray is HUD type, which is direction-independent — so a reader
 * told to compare those compares three pictures that genuinely look alike
 * and learns nothing.
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

  const r = new Raster(colX(2) + colW + 10, stripY + 34 + stripH + 96);
  r.clear(BOARD.hud, 1);

  // Every run of prose on this sheet is wrapped to the surface rather than
  // trusted to fit. A caption that runs off the right edge is the one defect
  // a reader cannot see is a defect — it reads as a finished sentence.
  const cols = Math.floor((r.w - labelX * 2) / (6 * fontScale(TYPE.label)));
  const prose = (y: number, s: string, c = BOARD.textDim): number => {
    const lines = wrap(s, cols, 3);
    lines.forEach((line, i) => drawText(r, labelX, y + i * 20, line, TYPE.label, c));
    return y + lines.length * 20;
  };

  drawText(r, labelX, 16, "Three directions, one picture", TYPE.title, BOARD.text);
  const ruleY =
    prose(
      52,
      "the same dinosaurs, drawn three ways. 20px is the cell on a 390pt phone; 96px is only there to show what differs. all three are already built, cost the same and read at 20px. this is a taste call.",
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
        r.blit(resample(sprite, px, px), colX(i) + slot[j]! - px / 2, y + (rowH - px) / 2);
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
  prose(
    footY + 22,
    "Fossil Pixel passes the colour-blindness check as drawn. Clay Pack and Valley Naturalist each need their own hue table, about an afternoon, because the direction repaints the kind hues before they reach the board. Atlas size is 23 kB against 126 kB, which is irrelevant against a 40 MB binary.",
  );
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

function doFrames(): void {
  console.log("sample frames (board at 720x1280, and at the reference phone's rendered size)");
  for (const d of DIRECTIONS) {
    // Migration 49, 260 ticks in: a `fast` migration strung across two
    // corridors of the maze, which is the state the board should judge.
    const board = renderBoardFrame(d, { migration: 49, ticks: 260, effects: true });
    png(`docs/art/${d.id}-board.png`, board);
    png(`docs/art/${d.id}-board-phone.png`, resample(board, PHONE_W, PHONE_H));

    // Migration 50, the Spinosaurus boss, with a dinosaur selected so the
    // frame carries the sheet tray and a refusal toast as well.
    const sheet = renderBoardFrame(d, { migration: 50, ticks: 800, selectSheet: true, toast: "That would seal the maze", effects: true });
    png(`docs/art/${d.id}-sheet.png`, sheet);
    png(`docs/art/${d.id}-sheet-phone.png`, resample(sheet, PHONE_W, PHONE_H));

    png(`docs/art/${d.id}-legibility.png`, legibilitySheet(d));
    png(`docs/art/${d.id}-effects.png`, effectsPlate(d));
  }
  png("docs/art/kind-hues.png", colourSheet());
  png("docs/art/directions-compared.png", compareSheet());
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
  write(`packages/game/assets/${d.id}/dinos.json`, atlasJson(da, "dinos.png"));

  const ia = pack(invaders, width);
  png(`packages/game/assets/${d.id}/invaders.png`, ia.raster);
  write(`packages/game/assets/${d.id}/invaders.json`, atlasJson(ia, "invaders.png"));

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
else if (cmd === "compare") png("docs/art/directions-compared.png", compareSheet());
else if (cmd === "atlas") doAtlas(arg ?? "fossil-pixel");
else if (cmd === "check") doCheck();
else {
  console.log("usage: node tools/art/build.ts [frames|atlas <direction>|check]");
  console.log(`directions: ${DIRECTIONS.map((d) => d.id).join(", ")}`);
  process.exit(1);
}
