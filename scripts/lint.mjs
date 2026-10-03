// `npm run lint`.
//
// ESLint is not a dependency of the repo root. It lives in tools/lint with
// its own TypeScript 6, because typescript-eslint refuses to load against
// the TypeScript 7 that typechecks everything else
// (https://github.com/typescript-eslint/typescript-eslint/issues/10940).
// Holding the compiler back for the linter would be the wrong trade, so
// the two sit side by side the way the TypeScript 7 release notes
// describe, and this wrapper runs the one in tools/lint.
//
// It installs tools/lint the first time, so a fresh clone needs one
// `npm install` and not two.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lintDir = join(root, "tools", "lint");
const eslintBin = join(lintDir, "node_modules", ".bin", "eslint");

if (!existsSync(eslintBin)) {
  process.stderr.write("lint: installing the linter in tools/lint (first run only)\n");
  const install = spawnSync("npm", ["ci", "--no-audit", "--no-fund", "--prefix", lintDir], {
    stdio: "inherit",
    cwd: root,
  });
  if (install.status !== 0) {
    process.stderr.write("lint: could not install tools/lint\n");
    process.exit(install.status ?? 1);
  }
}

// cwd is the repo root so that eslint.config.js is found there and its
// `files` globs are relative to the repo, not to tools/lint.
const args = process.argv.slice(2);
const result = spawnSync(eslintBin, args.length > 0 ? args : ["."], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
