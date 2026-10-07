#!/usr/bin/env node
// Fails non-zero when a gzipped asset group in apps/web/dist/assets
// exceeds its budget in bundle-budget.json. Run after `npm run build`;
// there is nothing to measure before the bundle exists.
//
// Matching is extension-agnostic: every file in dist/assets must land in
// an exclude rule or a budget group, so a new kind of build output (an
// atlas PNG today, anything else later) has to be budgeted on purpose
// instead of silently passing because nothing was looking for it.
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const assetsDir = path.join(repoRoot, "apps/web/dist/assets");
const budgetPath = path.join(repoRoot, "bundle-budget.json");

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

let entries;
try {
  entries = readdirSync(assetsDir, { withFileTypes: true });
} catch {
  console.error(`no build output at ${assetsDir} — run "npm run build" first`);
  process.exit(1);
}

const files = entries.filter((e) => e.isFile()).map((e) => e.name);

if (files.length === 0) {
  console.error(`no files found in ${assetsDir}`);
  process.exit(1);
}

let failed = false;
const excluded = new Set();

for (const rule of budget.exclude ?? []) {
  const re = new RegExp(rule.match);
  const members = files.filter((f) => re.test(f));
  for (const f of members) excluded.add(f);
  console.log(`[excluded] ${rule.name}: ${members.length} file(s) — ${rule.reason}`);
}

const remaining = files.filter((f) => !excluded.has(f));
const unmatched = new Set(remaining);

for (const group of budget.groups) {
  const re = new RegExp(group.match);
  const members = remaining.filter((f) => re.test(f));
  for (const f of members) unmatched.delete(f);

  const gzipBytes = members.reduce((sum, f) => {
    const buf = readFileSync(path.join(assetsDir, f));
    return sum + gzipSync(buf).length;
  }, 0);

  const over = gzipBytes > group.gzipBudgetBytes;
  if (over) failed = true;

  const status = over ? "OVER" : "ok";
  console.log(
    `[${status}] ${group.name}: ${(gzipBytes / 1000).toFixed(1)} kB gzip ` +
      `(budget ${(group.gzipBudgetBytes / 1000).toFixed(1)} kB) — ${members.join(", ") || "(no files matched)"}`,
  );
}

if (unmatched.size > 0) {
  console.error(`file(s) matched no exclude rule or budget group: ${[...unmatched].join(", ")}`);
  failed = true;
}

if (failed) {
  console.error("\nbundle size budget exceeded — see bundle-budget.json");
  process.exit(1);
}

console.log("\nall asset groups within budget");
