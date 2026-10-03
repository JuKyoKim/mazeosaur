# @mazeosaur/content

Game data, not code: the six dinosaur kinds and their three growth stages,
the eight invader archetypes, the fifty migrations, the kind chart's
weights, the economy, and the valley. The sim decides what a shield or a
stun *is*; this package decides how many and how strong.

Units come from the sim: milli-cells (1000 = one cell), ticks (20 per
second), integer damage and integer meat.

## What is in here

- `src/index.ts` — the whole table. Eighteen dinosaur definitions (six
  kinds x three stages), nine archetypes including the boss, fifty
  migrations, the hp and bounty curves, the rules block, and one valley.
- `test/content.test.ts` — integrity. Every migration references a known
  invader, every `growsTo` names a real next stage, the empty valley is
  walkable and the lane cells are inside it.
- `test/balance.test.ts` — the balance harness. A scripted player paints
  the obvious serpentine, buys the kind that counters the next migration,
  grows what it can and always sends early. It must survive at least 35 of
  the 50 migrations; at the current tuning it reaches 46. A change here
  that makes it die ten migrations earlier is a balance change, not a fix,
  and the test says so as a number instead of a feeling.

"Validated against a schema" means two things, both at `npm run check`
time: the TypeScript types in `@mazeosaur/sim`
(`DinoDef`, `InvaderDef`, `MigrationDef`, `ValleyDef`, `Rules`), and the
integrity test above. There is no runtime validator, because nothing loads
this data at runtime — it is compiled in.

## Rules that apply here

This package is held to the sim's purity rules (`npm run lint`), because
the sim reads these numbers: a curve computed with `Math.pow` here
diverges a replay exactly as one in the sim would. `hpCurve` iterates for
that reason.

`content.version` is part of the save format. **Bump it when, and only
when, a number the sim reads changes** — new art, copy and sound ids do
not. A player's in-progress run is dropped when it no longer matches; see
section 1.5 of [docs/01-v1-architecture.md](../../docs/01-v1-architecture.md).
