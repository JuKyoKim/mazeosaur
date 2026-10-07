// `npm run check:readmes`, part of `npm run check`.
//
// Two ways a README goes quietly wrong, both of which have happened here:
// it describes files that do not exist, or it misses files that do. This
// makes the "What is in here" list of every package and app a checked
// claim instead of a sentence somebody has to remember to update.
//
// It checks exactly four things, and deliberately not more:
//
//   1. Every `src/…` or `test/…` path in the bullet list directly under
//      `## What is in here` resolves to a real file in that package.
//   2. Every file in that package's `src/` is named somewhere in the list.
//   3. Every relative markdown link resolves.
//   4. No markdown prose cites a source location as `file.ext:line`.
//
// Only the bullets immediately following the heading are read. Prose after
// the list is free to name a file that is specified and not yet written,
// which is the one honest way to describe a contract before it lands — and
// which is why `docs/` is not checked by 1 and 2. A design doc's job is to
// name files that do not exist yet; a README's job is to describe what is
// there. Checks 3 and 4 run everywhere, docs included, because a dead link
// and a rotted citation are wrong in either kind of file.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];

/** Every markdown file in the repo, minus dependencies. */
function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Which of `paths` git ignores, in one batched call. `test-results/` and
 * `playwright-report/` are gitignored generated output, not docs; walking
 * them the same as `dist` means every future generated directory needs this
 * list too, so defer to .gitignore instead of growing a parallel one here.
 *
 * That means this check now needs a working `git check-ignore`, and it is
 * not optional: a missing `git` binary or a tree with no `.git` must not
 * read as "nothing is ignored", because that silently puts generated output
 * like `dist/**` back under checks 1 and 2. Either failure is a hard stop,
 * not a fallback.
 */
function gitIgnored(paths) {
  if (paths.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root,
    input: paths.map((p) => relative(root, p)).join("\n"),
    encoding: "utf8",
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    const reason = result.error
      ? result.error.message
      : `exited ${result.status}${result.stderr?.trim() ? `: ${result.stderr.trim()}` : ""}`;
    process.stderr.write(
      `check:readmes: \`git check-ignore\` failed (${reason}); cannot tell which files are generated.\n`,
    );
    process.exit(1);
  }
  return new Set(result.stdout.split("\n").filter(Boolean));
}

function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const candidates = markdownFiles(root);
const ignored = gitIgnored(candidates);
const docs = candidates.filter((doc) => !ignored.has(relative(root, doc)));

// 1 and 2: the "What is in here" list of each package and app.
for (const doc of docs) {
  if (!doc.endsWith("README.md")) continue;
  const pkg = dirname(doc);
  const lines = readFileSync(doc, "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === "## What is in here");
  if (start === -1) continue;

  // The bullet list, and nothing past it. A blank line inside the list is
  // fine; a blank line followed by prose ends it.
  const bullets = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (line.startsWith("- ") || /^\s+\S/.test(line)) bullets.push(line);
    else break;
  }

  const named = new Set();
  for (const m of bullets.join("\n").matchAll(/`((?:src|test)\/[\w./-]+)`/g)) named.add(m[1]);

  for (const path of named) {
    if (!existsSync(join(pkg, path))) {
      problems.push(`${relative(root, doc)}: lists \`${path}\`, which does not exist`);
    }
  }

  for (const file of sourceFiles(join(pkg, "src"))) {
    const rel = relative(pkg, file).split("\\").join("/");
    if (!named.has(rel)) {
      problems.push(`${relative(root, doc)}: does not mention \`${rel}\`, which exists`);
    }
  }
}

// 3: relative markdown links, in every markdown file.
for (const doc of docs) {
  const text = readFileSync(doc, "utf8");
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith("/")) continue; // url, or a Paperclip route
    const full = resolve(dirname(doc), target);
    if (!existsSync(full)) {
      problems.push(`${relative(root, doc)}: links to ${target}, which does not exist`);
    }
  }
}

// 4: `file:line` citations, in every markdown file. A line number reads as
// precise, passes review because it once was, and rots on the next unrelated
// edit to the file — and the rot is invisible, because the reader who checks
// it lands a line or two away inside the same object literal and believes it.
// Three fixes in a row here were that, including one whose file had been a
// re-export for two milestones. Name the symbol and the drift cannot hide.
//
// Fenced blocks are exempt: a quoted grep transcript or a command is allowed
// to carry the line numbers it actually printed, and that is also the escape
// hatch for a doc describing this very check. The line number in the message
// below is not a violation — a linter's location is computed on the run that
// prints it, which is exactly what a citation in a doc is not.
for (const doc of docs) {
  const lines = readFileSync(doc, "utf8").split("\n");
  let fenced = false;
  for (const [i, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of line.matchAll(/[\w./-]+\.(?:ts|tsx|js|mjs|json|md|yml|yaml):\d+/g)) {
      problems.push(
        `${relative(root, doc)} line ${i + 1}: cites \`${m[0]}\` — name the symbol, not the line`,
      );
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`README drift (${problems.length}):\n`);
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.stderr.write(
    "\nEither the file moved or the list did not. Fix whichever is wrong.\n" +
      "For a citation: name the exported symbol, the function or the field, so\n" +
      "the reference survives an unrelated edit above it.\n",
  );
  process.exit(1);
}
process.stdout.write(`readmes: ${docs.length} markdown files, no drift\n`);
