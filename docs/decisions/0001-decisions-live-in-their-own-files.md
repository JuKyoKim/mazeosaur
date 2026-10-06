---
date: 2026-10-06
status: decided
---

# A new decision is a new file, not a new line in section 10

Section 10 of [../00-proposal.md](../00-proposal.md) stops growing. Its
existing entries stay exactly as they are — they are the history, and
rewording them would churn every open pull request — and it gains a pointer
saying new decisions go in this directory. Each new decision is its own
`NNNN-slug.md` file here. The convention is in [README.md](README.md).

**Why.** Section 10 is an append-only list, so every pull request that records
a decision edits the **same last line of the same file**. Two concurrent
decision PRs therefore conflict by construction — not sometimes, always. Each
conflict resolves trivially, so the merge cost was never the problem. The
damage is downstream and silent:

- A conflicting PR has no merge ref, so GitHub runs **no CI on it at all**.
  `gh pr checks` prints nothing — not a failure, nothing.
- Neither the PR nor its issue changes state. The PR looks open and healthy
  while its newest commits have never been built.
- Two PRs sat in exactly that state until a recovery run happened to look.

The list grows monotonically, so this gets more likely, not less. Two files in
a directory cannot textually conflict; that is the whole mechanism, and it is
structural rather than a habit anybody has to keep.

**Rejected.**

- *Prepend new entries at the top of section 10 instead of appending.* Two
  concurrent PRs still edit the same adjacent lines. The same conflict at the
  other end of the file.
- *`merge=union` in `.gitattributes` for `docs/00-proposal.md`.* Correct for an
  append-only list, wrong for a prose document — it would silently duplicate
  genuine concurrent prose edits instead of conflicting on them, which trades a
  loud problem for a quiet one.
- *An index file listing every decision.* It reintroduces the exact
  append-conflict being removed, one line per decision, and a generated index
  brings a regeneration guard with it. The sorted directory listing is the
  index.
