# Decisions

One decision per file. New decisions go here; section 10 of
[../00-proposal.md](../00-proposal.md) is the frozen history of the ones taken
before this directory existed. Why it works this way is itself a decision:
[0001-decisions-live-in-their-own-files.md](0001-decisions-live-in-their-own-files.md).

There is deliberately **no index file**. An index would reintroduce the
append-conflict this directory exists to remove, one line per decision. The
sorted listing above is the index.

## The convention

A file is `NNNN-slug.md`: a four-digit number, then a short kebab-case slug.

- **The number orders, it does not identify.** Take the next one above the
  highest already here. Two branches picking the same number is fine and is
  not a conflict — they are different files, and whichever merges second may
  keep its number or renumber, because nothing links to a decision by number.
- `date` in the front matter is the day the decision was taken, `YYYY-MM-DD`.
- The title is the decision stated as a claim, not a topic. "The sim owns the
  tick rate", not "Tick rate".
- Say what was decided, then **why**, then what was rejected and why. A
  decision without its rejected alternatives gets re-litigated by whoever
  arrives next.
- Cite symbols, never a line number. The 2026-10-05 decision in section 10
  applies here, and `npm run check:readmes` enforces it over this directory
  like any other markdown.
- Superseding a decision does not edit it. Add a new file saying what it
  replaces, and add `superseded-by` to the old one's front matter. The history
  of a decision is as useful as the decision.

Front matter is a fenced `yaml` block, so the files stay readable as plain
markdown and nothing has to parse them:

````markdown
---
date: 2026-10-06
status: decided
---

# The sim owns the tick rate

What was decided, in a paragraph.

**Why.** The reason, including what went wrong without it.

**Rejected.** The alternatives, each with the reason it lost.
````

## What belongs here, and what does not

- A **decision** belongs here: a choice with alternatives, that constrains
  future work, and that somebody could otherwise reverse by accident.
- A **contract** does not. The save format, the platform ports and the scene
  graph live in [../01-v1-architecture.md](../01-v1-architecture.md), where
  they can be read as one document. A decision may point at a contract; it
  does not replace it.
- **Session history** does not. No after-action notes, no dated asides. This
  directory holds what is durably true, which is why a decision file carries a
  date in its front matter and no narrative about the day it was written.
