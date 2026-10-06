// `docs/01-art-hud-and-audio.md` §4 prints a hand-maintained HUD geometry
// table, and `layoutTable()` in `./layout.ts` already builds the same shapes
// from the constants the client draws from (`ROW1`, `ROW3`). Nothing compared
// the two: ARB-186 shipped `BoardScene` building Sell at 120x52 against §4's
// 164x82 because the renderer-vs-doc seam was unguarded, and closing that one
// (`tests/client/hud-hit-targets.spec.ts` plus `layout.test.ts`) only checks
// the renderer and the constants against *each other*. A `ROW3.sell` edit
// that stays inside every one of those guards -- clears the hit floor,
// doesn't overlap Grow, stays inside `CONTENT_RIGHT` -- would still leave §4
// attesting to stale numbers with nothing to say so.
//
// ARB-186 was adjudicated against the doc ("docs/01 is correct as written --
// do not change the doc to match the build. The build moves"), so this reads
// §4's own numbers and never edits either side; a disagreement is reported,
// not resolved here.
//
// Lives in vitest rather than only a CLI step for the same reason
// `atlas.test.ts` does: `npm run check` runs lint, typecheck and vitest, not
// `art:check`, so a guard that only `art:check` ran would not gate anything.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROW1, ROW3 } from "./layout.js";

/** One row of a doc table, as plain cell text (markdown still inside). */
type Row = string[];

/** A GFM pipe table: the header cells and the data rows below the `---` line. */
type Table = { header: string[]; rows: Row[] };

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparator = (line: string): boolean => /^\|?[\s:-]+\|[\s:|-]*\|?$/.test(line.trim()) && line.includes("-");

/** Every pipe table in a markdown document, in source order. */
export function parseTables(markdown: string): Table[] {
  const lines = markdown.split("\n");
  const tables: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line === undefined || next === undefined) continue;
    const looksLikeRow = /^\s*\|.*\|\s*$/.test(line);
    if (!looksLikeRow || !isSeparator(next)) continue;
    const header = cellsOf(line);
    const rows: Row[] = [];
    let j = i + 2;
    while (j < lines.length) {
      const rowLine = lines[j];
      if (rowLine === undefined || !/^\s*\|.*\|\s*$/.test(rowLine)) break;
      rows.push(cellsOf(rowLine));
      j++;
    }
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

/** A markdown-bold or plain cell, stripped of `**` and surrounding space. */
const unbold = (s: string): string => s.replace(/\*\*/g, "").trim();

/**
 * The coordinate-looking backtick spans in a "box" cell, in order. A box cell
 * can carry a second, non-coordinate span for the type style (`` `vital` ``)
 * or two spans for a row that names two positions (migration label/value);
 * filtering to spans that start with a digit keeps the former out and the
 * latter in.
 */
function boxSpans(cell: string): string[] {
  const spans = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
  return spans.filter((s) => /^-?\d/.test(s));
}

/** §4's two geometry tables, keyed by each row's own label. */
export function docSpec(markdown: string): Map<string, string[]> {
  const tables = parseTables(markdown);
  const wanted = tables.filter(
    (t) =>
      t.header.map((h) => h.toLowerCase()).includes("box") &&
      (t.header.map((h) => h.toLowerCase()).includes("on the phone") || t.header.map((h) => h.toLowerCase()).includes("note")),
  );
  const boxIdx = (t: Table) => t.header.findIndex((h) => h.toLowerCase() === "box");
  const spec = new Map<string, string[]>();
  for (const table of wanted) {
    const idx = boxIdx(table);
    for (const row of table.rows) {
      const label = unbold(row[0] ?? "").toLowerCase();
      const cell = row[idx] ?? "";
      const spans = boxSpans(cell);
      if (label && spans.length > 0) spec.set(label, spans);
    }
  }
  return spec;
}

const wh = (b: { x: number; y: number; w: number; h: number }) => `${b.x}, ${b.y}, ${b.w} x ${b.h}`;
const xy = (b: { x: number; y: number }) => `${b.x}, ${b.y}`;
const wide = (b: { x: number; y: number; w: number }) => `${b.x}, ${b.y}, ${b.w} wide`;

/**
 * The same rows, built from the constants the client draws from. One entry
 * per row label in §4 -- a label with no entry here is a row the doc added
 * that this guard does not yet know about, which `codeDrift` reports rather
 * than silently passing.
 */
export function codeSpec(): Map<string, string[]> {
  return new Map<string, string[]>([
    ["build timer bar", [wh(ROW1.timerBar)]],
    ["meat icon", [wh(ROW1.meatIcon)]],
    ["meat value", [xy(ROW1.meatValue)]],
    ["egg icon", [wh(ROW1.eggIcon)]],
    ["egg value", [xy(ROW1.eggValue)]],
    ["migration label / value", [xy(ROW1.migrationLabel), xy(ROW1.migrationValue)]],
    ["send", [wh(ROW1.send)]],
    ["pause", [wh(ROW1.pause)]],
    ["speed toggle", [wh(ROW1.speed)]],
    ["genus", [wide(ROW3.sheetName)]],
    ["kind + stage", [wide(ROW3.sheetKind)]],
    ["stat line", [wide(ROW3.sheetStats)]],
    ["modifier line", [wide(ROW3.sheetExtras)]],
    ["grow", [wh(ROW3.grow)]],
    ["sell", [wh(ROW3.sell)]],
  ]);
}

export type Problem = { row: string; doc: string; code: string };

/** Where the doc's §4 geometry tables and the layout constants disagree. */
export function geometryDrift(docMarkdown: string): Problem[] {
  const doc = docSpec(docMarkdown);
  const code = codeSpec();
  const problems: Problem[] = [];
  for (const [row, docSpans] of doc) {
    const codeSpans = code.get(row);
    if (!codeSpans) {
      problems.push({ row, doc: docSpans.join(" / "), code: "(no entry in codeSpec -- add one)" });
      continue;
    }
    const docStr = docSpans.join(" / ");
    const codeStr = codeSpans.join(" / ");
    if (docStr !== codeStr) problems.push({ row, doc: docStr, code: codeStr });
  }
  return problems;
}

export function describeProblem(p: Problem): string {
  return `${p.row}: doc says "${p.doc}", layout.ts says "${p.code}"`;
}

export function readDoc(root: string): string {
  return readFileSync(join(root, "docs", "01-art-hud-and-audio.md"), "utf8");
}
