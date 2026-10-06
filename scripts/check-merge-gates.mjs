// `npm run check:gates`. Deliberately NOT part of `npm run check`, and not a
// CI step: it reads the Paperclip control plane, which CI has no key for and
// must not reach. It is a sweep an agent runs, and section 6.6 of
// docs/01-v1-architecture.md says when and what to do with what it finds.
//
// What it answers: **is any pull request merged while the issue that was
// supposed to gate it is still open?** That is the shape of a merge gate whose
// run died before it wrote anything — the issue is left looking alive, the
// pull request lands without the review, and every issue blocked behind the
// gate waits on a run that is not coming. Nothing else in the system raises
// it, because an `in_progress` gate with a dead run is byte for byte an
// `in_progress` gate with a live one.
//
// The link it walks is the one that already exists: a gate issue names its
// pull request in its title (`Merge gate: PR #70, …`). So:
//
//   1. every pull request in this repo, with its state, from `gh`;
//   2. every issue in this company, with its status, from Paperclip;
//   3. report each issue whose title names a pull request that is merged or
//      closed while the issue itself is not `done` or `cancelled`.
//
// Two deliberate narrowings. A number the repo has no pull request for is
// skipped, because sibling repos share the board and their pull request
// numbers collide with nothing here — which also means a gate for another
// repo's pull request is out of scope for this check. And a merge younger
// than `--min-age-minutes` is skipped, because a gate that merges its own
// pull request closes itself moments later and is not a finding.
//
// Every input is required. A missing `gh`, a missing key, a truncated list:
// all hard stops, never a quiet pass. A sweep that cannot see is not the same
// as a sweep that saw nothing, and only one of them is good news.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const minAgeMinutes = Number(flag("min-age-minutes", "30"));
const issueLimit = Number(flag("limit", "1000"));
const prLimit = Number(flag("pr-limit", "1000"));

function die(message) {
  process.stderr.write(`check:gates: ${message}\n`);
  process.exit(1);
}

if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) die("--min-age-minutes must be a non-negative number");

/** Every pull request in this repo, by number. */
function pullRequests() {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--state", "all", "--limit", String(prLimit), "--json", "number,state,title,url,mergedAt,closedAt"],
    { encoding: "utf8" },
  );
  if (result.error) die(`\`gh pr list\` could not run (${result.error.message}); cannot tell which pull requests merged.`);
  if (result.status !== 0) die(`\`gh pr list\` exited ${result.status}: ${result.stderr?.trim() || "no output"}`);
  const list = JSON.parse(result.stdout);
  if (list.length >= prLimit) die(`\`gh pr list\` returned ${list.length} pull requests at the limit; raise --pr-limit.`);
  return new Map(list.map((pr) => [pr.number, pr]));
}

/** Every issue on this company's board. */
async function issues() {
  const base = (process.env.PAPERCLIP_API_URL ?? "").replace(/\/$/, "").replace(/\/api$/, "");
  const key = process.env.PAPERCLIP_API_KEY;
  const company = process.env.PAPERCLIP_COMPANY_ID;
  if (!base || !key || !company) {
    die("needs PAPERCLIP_API_URL, PAPERCLIP_API_KEY and PAPERCLIP_COMPANY_ID; run it from an agent heartbeat.");
  }
  const response = await fetch(`${base}/api/companies/${company}/issues?limit=${issueLimit}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) die(`issue list returned ${response.status} ${response.statusText}`);
  const list = await response.json();
  if (!Array.isArray(list)) die(`issue list was not an array; the endpoint's shape changed`);
  // The endpoint honours `limit` and has no cursor, so a full page is
  // indistinguishable from a truncated one. Refuse rather than sweep a prefix.
  if (list.length >= issueLimit) die(`issue list returned ${list.length} issues at the limit; raise --limit.`);
  return list;
}

const CLOSED = new Set(["done", "cancelled"]);

const prs = pullRequests();
const board = await issues();
const now = Date.now();
const findings = [];

for (const issue of board) {
  if (CLOSED.has(issue.status)) continue;
  for (const match of String(issue.title ?? "").matchAll(/#(\d+)\b/g)) {
    const pr = prs.get(Number(match[1]));
    if (!pr || pr.state === "OPEN") continue;
    const settled = Date.parse(pr.mergedAt ?? pr.closedAt ?? "");
    if (!Number.isFinite(settled)) continue;
    const ageMinutes = (now - settled) / 60_000;
    if (ageMinutes < minAgeMinutes) continue;
    findings.push({ issue, pr, ageMinutes });
  }
}

findings.sort((a, b) => b.ageMinutes - a.ageMinutes);

function hours(minutes) {
  return minutes < 90 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`;
}

if (findings.length > 0) {
  process.stderr.write(`Unpaid merge gates (${findings.length}):\n`);
  for (const { issue, pr, ageMinutes } of findings) {
    const verb = pr.state === "MERGED" ? "merged" : "closed";
    process.stderr.write(
      `  ${issue.identifier} is \`${issue.status}\` — PR #${pr.number} ${verb} ${hours(ageMinutes)} ago\n` +
        `    ${issue.title}\n    ${pr.url}\n`,
    );
  }
  process.stderr.write(
    "\nThe work the issue names is over and the issue is still open. Either the\n" +
      "gate's run died before it wrote anything, or the issue was never closed.\n" +
      "Section 6.6 of docs/01-v1-architecture.md says which, and what to do:\n" +
      "a merged pull request does not retire its gate, and a gate left open\n" +
      "strands every issue blocked behind it.\n",
  );
  process.exit(1);
}
process.stdout.write(
  `gates: ${board.length} issues against ${prs.size} pull requests, none merged past an open gate\n`,
);
