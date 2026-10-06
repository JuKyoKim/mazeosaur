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

// ------------------------------------------------------ §4's row-1 widths

/**
 * §4 prints a second table above the geometry one: the measured width of
 * each row-1 field's widest value, where it therefore ends, and the origin
 * of whatever sits to its right. Every x in row 1 is set from that table, so
 * a stale row in it is a stale layout argument -- it is what says a timer
 * digit field does not fit beside the migration readout, and what pinned
 * Send's origin when ARB-218 took 82px out of Send to pay for Pause.
 *
 * Two of its three number columns are checkable without a font. `ends at` is
 * the field's own origin plus its own width, and `next origin` is a `ROW1`
 * constant the cell names. Whether the *width* is what the font really
 * renders is a different question with a different answer: the type is the
 * platform's, so it has to be measured in a running client, which
 * `tests/client/hud-row1-widths.spec.ts` does. It cannot be answered from
 * the board plates in `docs/art/` -- those are drawn in `font.ts`'s
 * fixed-pitch 5x7 mock, which is around 1.6x wider on a digit run and
 * reverses which of the readout's two lines is the wider one (ARB-307).
 */
const WIDTH_ROWS: Record<string, { origin: number; next: number; nextIs: string }> = {
  meat: { origin: ROW1.meatValue.x, next: ROW1.eggIcon.x, nextIs: "ROW1.eggIcon.x" },
  eggs: { origin: ROW1.eggValue.x, next: ROW1.migrationLabel.x, nextIs: "ROW1.migrationLabel.x" },
  migration: { origin: ROW1.migrationLabel.x, next: ROW1.send.x, nextIs: "ROW1.send.x" },
};

/** The first integer in a cell, or null: `444, **Send**` is 444. */
function leadingInt(s: string): number | null {
  const m = /-?\d+/.exec(unbold(s));
  return m ? Number(m[0]) : null;
}

export type WidthRow = { width: number; endsAt: number; nextOrigin: number };

/** §4's row-1 width table, keyed by field, or empty if it is not there. */
export function widthSpec(markdown: string): Map<string, WidthRow> {
  const table = parseTables(markdown).find((t) => {
    const h = t.header.map((c) => c.toLowerCase());
    return h.includes("widest value") && h.includes("ends at") && h.includes("next origin");
  });
  const spec = new Map<string, WidthRow>();
  if (!table) return spec;
  const h = table.header.map((c) => c.toLowerCase());
  const [w, e, n] = [h.indexOf("width"), h.indexOf("ends at"), h.indexOf("next origin")];
  for (const row of table.rows) {
    const field = unbold(row[0] ?? "").toLowerCase();
    const width = leadingInt(row[w] ?? "");
    const endsAt = leadingInt(row[e] ?? "");
    const nextOrigin = leadingInt(row[n] ?? "");
    if (field && width !== null && endsAt !== null && nextOrigin !== null) spec.set(field, { width, endsAt, nextOrigin });
  }
  return spec;
}

/**
 * Where §4's row-1 width table disagrees with itself or with `ROW1`.
 *
 * Three things, none of them about the font: the row ends where its own
 * origin plus its own width puts it, the neighbour it names sits where
 * `layout.ts` puts that neighbour, and it does not end past that neighbour.
 */
export function widthDrift(docMarkdown: string): Problem[] {
  const problems: Problem[] = [];
  for (const [field, { width, endsAt, nextOrigin }] of widthSpec(docMarkdown)) {
    const known = WIDTH_ROWS[field];
    if (!known) {
      problems.push({
        row: `${field} (width)`,
        doc: `${width} wide, ends at ${endsAt}`,
        code: "(no entry in WIDTH_ROWS -- add one)",
      });
      continue;
    }
    if (known.origin + width !== endsAt) {
      problems.push({
        row: `${field} (ends at)`,
        doc: `${endsAt}`,
        code: `${known.origin} + ${width} = ${known.origin + width}`,
      });
    }
    if (nextOrigin !== known.next) {
      problems.push({ row: `${field} (next origin)`, doc: `${nextOrigin}`, code: `${known.next} (${known.nextIs})` });
    }
    if (endsAt > known.next) {
      problems.push({ row: `${field} (clearance)`, doc: `ends at ${endsAt}`, code: `past ${known.next} (${known.nextIs})` });
    }
  }
  return problems;
}
