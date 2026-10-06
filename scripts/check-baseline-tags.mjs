// `npm run check:baseline-tags`, run first by `npm run test:baseline`
// (ARB-264). See docs/03-v1-baseline.md, "How the count stays honest".
//
// `vitest run -t "@baseline"` fails open: a filter that matches zero tests
// inside files that still load exits 0, same as a full pass. Playwright's
// `--grep` fails closed only on a *total* wipe — a filter that drops one of
// several tagged specs still exits 0 on the specs that remain. Neither
// runner can tell "the baseline set shrank" from "the baseline set is
// small"; only a count that is pinned somewhere outside the filtered run
// can.
//
// So this script is that pin. EXPECTED below is the literal set of
// `[@baseline]`-tagged test titles docs/03-v1-baseline.md's mapping table
// claims. It is not derived from the doc's prose — that table mixes exact
// quotes with paraphrase and is for a human, not a parser — so this file is
// the actual source of truth and the doc's job is to stay a true
// description of it. A test dropping its tag (or losing the file it lived
// in) shrinks the scan below EXPECTED; a test gaining the tag without this
// list learning about it grows the scan past EXPECTED. Both exit 1.
//
// The title scan below only matches a plain string literal passed directly
// to `it(`/`test(`. A template-literal title, or a tag added inside
// `it.skip(`/`test.skip(`, will not be found -- in the unlisted direction
// only, so a skipped or templated test could carry the tag without this
// script noticing. The dropped direction is unaffected: EXPECTED is still
// checked against whatever the scan does find.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const EXPECTED = [
  { file: "apps/web/test/save-store.test.ts", title: "round-trips a document through put and readRawSave" },
  { file: "apps/web/test/save-store.test.ts", title: "writes a coalesced document immediately instead of waiting out COALESCE_MS" },
  { file: "packages/game/test/resume.test.ts", title: "reuses the resumed Game and never calls replay -- the whole point of LoadOutcome.resumed" },
  { file: "packages/sim/test/flowfield.test.ts", title: "routes around a wall and marks sealed cells unreachable" },
  { file: "packages/sim/test/flowfield.test.ts", title: "nextStep walks a creep to the target along non-increasing distances" },
  { file: "packages/sim/test/game.test.ts", title: "charges meat, blocks the cell, and refuses when broke" },
  { file: "packages/sim/test/game.test.ts", title: "leaks eat eggs and an empty nest loses the game" },
  { file: "packages/sim/test/game.test.ts", title: "kills pay bounty, clearing pays the bonus, and clearing the last migration wins" },
  { file: "packages/sim/test/game.test.ts", title: "ground-only dinosaurs ignore fliers" },
  { file: "packages/sim/test/lane.test.ts", title: "still routes an invader through both legs with a dinosaur on the checkpoint" },
  { file: "packages/sim/test/mechanics.test.ts", title: "hits the N furthest-along invaders per cooldown" },
  { file: "packages/sim/test/save.test.ts", title: "reaches the same hash as the live game it was saved from, mid-migration" },
  { file: "packages/sim/test/save.test.ts", title: "loads a document with a resumable run mid-migration, dropping nothing" },
  { file: "packages/sim/test/save.test.ts", title: "resumed is the replay's own object: same hash and tick as the run it was built from" },
  { file: "tests/client/restart-regression.spec.ts", title: "scene.restart() leaves the canvas rendering with no renderer errors" },
  { file: "tests/client/resume.spec.ts", title: "save and resume: a reload picks the stored run back up, not a fresh one" },
  { file: "tests/client/smoke.spec.ts", title: "full run: four select+tap pairs, grow, sell, send, leak, lose, play again" },
  { file: "tests/client/win-screen.spec.ts", title: "win screen: clearing the last migration shows it, and Play again starts a fresh run" },
];

function testFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const TAG = "[@baseline]";
const actual = [];
for (const file of testFiles(root)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\b(?:it|test)\(\s*(["'])((?:(?!\1).)*?)\1/g)) {
    const title = m[2];
    if (!title.endsWith(TAG)) continue;
    actual.push({
      file: relative(root, file).split("\\").join("/"),
      title: title.slice(0, -TAG.length).trimEnd(),
    });
  }
}

const key = (t) => `${t.file}::${t.title}`;
const expectedKeys = new Set(EXPECTED.map(key));
const actualKeys = new Set(actual.map(key));

const problems = [];
for (const t of EXPECTED) {
  if (!actualKeys.has(key(t))) {
    problems.push(`dropped: ${t.file} no longer has a [@baseline] test titled "${t.title}"`);
  }
}
for (const t of actual) {
  if (!expectedKeys.has(key(t))) {
    problems.push(
      `unlisted: ${t.file} has a [@baseline] test titled "${t.title}" that scripts/check-baseline-tags.mjs does not expect`,
    );
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `baseline tag drift (${problems.length}): scanned ${actual.length} tagged tests, expected ${EXPECTED.length}\n`,
  );
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.stderr.write(
    "\nEither a test's [@baseline] tag or title changed, or scripts/check-baseline-tags.mjs's\n" +
      "EXPECTED list did not. Update whichever is wrong, and keep docs/03-v1-baseline.md's\n" +
      "mapping table in sync with EXPECTED.\n",
  );
  process.exit(1);
}
process.stdout.write(`baseline tags: ${actual.length} tagged tests, matches scripts/check-baseline-tags.mjs\n`);
