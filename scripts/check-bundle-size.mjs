#!/usr/bin/env node
// Fails non-zero when a gzipped JS chunk group in apps/web/dist/assets
// exceeds its budget in bundle-budget.json. Run after `npm run build`;
// there is nothing to measure before the bundle exists.
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const assetsDir = path.join(repoRoot, "apps/web/dist/assets");
const budgetPath = path.join(repoRoot, "bundle-budget.json");

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));

let files;
try {
  files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`no build output at ${assetsDir} — run "npm run build" first`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`no .js files found in ${assetsDir}`);
  process.exit(1);
}

let failed = false;
const unmatched = new Set(files);

for (const group of budget.groups) {
  const re = new RegExp(group.match);
  const members = files.filter((f) => re.test(f));
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
  console.error(`chunk(s) matched no budget group: ${[...unmatched].join(", ")}`);
  failed = true;
}

if (failed) {
  console.error("\nbundle size budget exceeded — see bundle-budget.json");
  process.exit(1);
}

console.log("\nall chunk groups within budget");
