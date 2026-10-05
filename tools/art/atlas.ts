// What a shipping atlas is: which frames go in it, where the files go, and
// whether the ones on disk are still the ones this code produces.
//
// It is a module and not a few lines inside `build.ts` for two reasons. The
// first is the same one `generatedFrames` exists for: the command that writes
// the atlas and the check that it is current must read one list, or the check
// is only ever about the files someone remembered to add to it. The second is
// that the check has to run under vitest. `npm run check` does not call
// `art:verify` — it runs lint, typecheck and vitest — so a guard that lived
// only in the CLI would not fail the gate, and the whole point of this one is
// that a `sprites.ts` or palette edge that was not followed by
// `npm run art:atlas` cannot reach main.
//
// The comparison is pixels for the PNG, never bytes. `encodePng` compresses
// through the zlib the running Node links and two builds disagree on the same
// scanlines, so a byte diff asserts on the compressor. The JSON is compared as
// text, because `atlasJson` is a pure `JSON.stringify` and that *is*
// reproducible.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ARCHETYPES } from "./bestiary.js";
import { CHOSEN, DIRECTIONS, KINDS, type Direction } from "./directions.js";
import { CELL_PX, DRAW_CELLS } from "./layout.js";
import { pngHasPixels } from "./png.js";
import { type Raster } from "./raster.js";
import { atlasJson, dinoSprite, invaderSprite, pack, strikeEntries } from "./sprites.js";

/** Where a direction's atlas lives, relative to the repo root. */
export const assetDir = (id: string): string => `packages/game/assets/${id}`;

export type AtlasFile =
  | { rel: string; kind: "image"; raster: Raster; frames: number }
  | { rel: string; kind: "json"; text: string };

/**
 * Every atlas for a direction, generated in memory and not yet written.
 *
 * The 256px sheet is for a direction authored at 24px or smaller; anything
 * larger needs 512, and Toy Box's 64px square is the case that decides it.
 *
 * `strikes` is the third set and the one that is packed **untrimmed**: an
 * attack effect's position inside its frame is the content of the frame, so
 * there is nothing to trim away without losing it. It is also empty for a
 * direction that is not `blocks` — `strikeEntries` says why — and an empty
 * set is skipped rather than written as a sheet with no frames in it, so
 * the three archived directions keep exactly the two atlases they had.
 */
export function atlasFiles(d: Direction): AtlasFile[] {
  const sets = [
    {
      name: "dinos",
      trim: true,
      entries: KINDS.flatMap((kind) => ([1, 2, 3] as const).map((stage) => ({ name: `${kind}-${stage}`, raster: dinoSprite(kind, stage, d) }))),
    },
    {
      name: "invaders",
      trim: true,
      entries: ARCHETYPES.flatMap((a) => KINDS.map((kind) => ({ name: `${a}-${kind}`, raster: invaderSprite(a, kind, d) }))),
    },
    { name: "strikes", trim: false, entries: strikeEntries(d) },
  ];
  const width = d.spritePx <= 24 ? 256 : 512;

  const out: AtlasFile[] = [];
  for (const { name, trim, entries } of sets) {
    if (!entries.length) continue;
    const packed = pack(entries, width, 1, trim);
    out.push({ rel: `${assetDir(d.id)}/${name}.png`, kind: "image", raster: packed.raster, frames: packed.frames.length });
    out.push({
      rel: `${assetDir(d.id)}/${name}.json`,
      kind: "json",
      text: atlasJson(packed, `${name}.png`, d.spritePx, CELL_PX, DRAW_CELLS),
    });
  }
  return out;
}

export interface AtlasProblem {
  rel: string;
  what: "MISSING" | "CHANGED" | "UNREADABLE" | "EXTRA";
  detail?: string;
}

export const describeProblem = (p: AtlasProblem): string => `${p.what.padEnd(10)} ${p.rel}${p.detail ? `  ${p.detail}` : ""}`;

/**
 * Every way the committed atlas can disagree with this code. Empty means the
 * files on disk are exactly what `npm run art:atlas` writes today.
 *
 * `root` is the repo root, passed in rather than derived, so the same function
 * serves the CLI and a test that resolves it from its own directory.
 *
 * Deletions are found by listing the produced set against disk, not by asking
 * git what changed. `git add --all -N` stages a deletion and hides it from
 * `git diff`, so a guard built on the worktree diff passes on a missing file —
 * which is the one case where the game crashes on load rather than drawing
 * something slightly wrong.
 */
export function atlasDrift(root: string, d: Direction = CHOSEN): AtlasProblem[] {
  const problems: AtlasProblem[] = [];
  const produced = atlasFiles(d);

  for (const file of produced) {
    const p = join(root, file.rel);
    if (!existsSync(p)) {
      problems.push({ rel: file.rel, what: "MISSING" });
      continue;
    }
    if (file.kind === "json") {
      let got: string;
      try {
        got = readFileSync(p, "utf8");
      } catch (e) {
        problems.push({ rel: file.rel, what: "UNREADABLE", detail: (e as Error).message });
        continue;
      }
      if (got !== file.text) problems.push({ rel: file.rel, what: "CHANGED", detail: `${got.length} bytes on disk, ${file.text.length} generated` });
      continue;
    }
    try {
      if (!pngHasPixels(readFileSync(p), file.raster.w, file.raster.h, file.raster.px)) {
        problems.push({ rel: file.rel, what: "CHANGED", detail: `${file.raster.w}x${file.raster.h}, ${file.frames} frames` });
      }
    } catch (e) {
      problems.push({ rel: file.rel, what: "UNREADABLE", detail: (e as Error).message });
    }
  }

  // Anything else under a direction's asset folder is a file the game does
  // not load and nothing regenerates: a renamed atlas left behind, or the
  // atlas of a direction that lost the choice. Folders that are not a
  // direction are ignored, so audio and terrain can land here later without
  // this check having an opinion about them.
  const owned = new Set(produced.map((f) => f.rel));
  for (const dir of DIRECTIONS.map((x) => assetDir(x.id))) {
    const p = join(root, dir);
    if (!existsSync(p)) continue;
    for (const name of readdirSync(p).sort()) {
      const rel = `${dir}/${name}`;
      if (owned.has(rel)) continue;
      problems.push({ rel, what: "EXTRA", detail: dir === assetDir(d.id) ? "not produced by the generator" : `${d.id} is the direction that ships` });
    }
  }

  return problems;
}
