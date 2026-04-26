# Issue: Migrate `.withRules()` / `.audit()` from chainable methods to free functions

**Opened:** 2026-04-24
**Status:** Tracking (not in flight)
**Target:** v0.8.0 (major-version API change)
**Relates-to:** PR #59 (tactical fix for the lazy-load race)

## Context

PR #59 resolved a latent race in the rules/db module boundary: `rules.ts`
subclassed base classes from `db.ts`, which in turn needed rules.ts's factory
functions to implement `.withRules()` / `.audit()`. The cycle was previously
broken by a `dynamic import('./rules')` in db.ts — which worked, but the
resulting promise could be unsettled when consumer code called `.audit()` at
mutation wire-up time (see hotpot's `internalMutations.ts` TODO).

PR #59 replaced that with a synchronous installer (`installRulesSubclasses`)
that db.ts calls at the end of its own module body. This fixes the race,
but does not eliminate the underlying circular dependency — it just sequences
the initialization carefully so the cycle resolves in one tick instead of
across a promise boundary.

## Why we didn't do a structural fix now

A genuine structural resolution was sketched (see brainstorm in PR #59
review). The three options considered:

1. **Extract base classes into `dbClasses.ts`.** Attractive on paper. But
   the `.withRules()` / `.audit()` methods live on the base classes (that's
   what makes chaining work), and those methods call into rules.ts factories.
   Either the cycle comes back, the methods move off the base (and chaining
   breaks), or a sibling registration mechanism replaces the current
   installer — which is the same indirection relocated, not removed.
2. **Merge rules.ts into db.ts.** Declaration order would be sufficient.
   But the combined file is ~1500 lines and conflates two legitimately
   distinct concerns (codec-at-boundary vs. rules/audit middleware).
3. **Make `.withRules()` / `.audit()` free functions.** Eliminates the
   cycle at the structural level: db.ts has no runtime dep on rules.ts at
   all; rules.ts imports db.ts for types only. Breaking API change.

The blocker for Option 1 is the chaining requirement — as long as
`ctx.db.withRules(...).audit(...)` has to work as method chains, the
wrappers need methods on the base class, which means the base class has
to know about the factories, which means some form of cycle or deferred
wiring.

Option 3 is the only truly cycle-free shape, and it requires giving up
chaining.

## The v0.8.0 migration

Replace:

```ts
const secureDb = ctx.db
  .withRules(ctx, rules)
  .audit({ afterWrite })
```

with:

```ts
import { withRules, audit } from 'zodvex/server'

const secureDb = audit(
  withRules(ctx.db, ctx, rules),
  { afterWrite }
)
```

`withRules` and `audit` become standalone functions exported from
`zodvex/server`. They take a `ZodvexDatabaseReader`/`Writer` as their first
argument and return the wrapped variant. No methods on the base class.

### After migration, the dependency graph

```
ruleTypes.ts    (types only)
    ↓
db.ts           ← base classes, codec wiring, no runtime dep on rules.ts
    ↓ (type)
rules.ts        ← subclasses, `withRules` / `audit` functions
```

A strict DAG. No installer. No live-binding tricks. No `dynamic import()`.
Adding a new `extends` can never re-introduce a cycle because the arrow
only points one way.

### Alignment with prior direction

The `2026-02-17-runtime-only-middleware.md` decision doc ended with a note:

> zodvex v2 moved away from providing hook points entirely — consumers
> write their own DB wrappers (following Convex's `wrapDatabaseReader`
> pattern) on top of zodvex's codec layer…

This migration is in the same spirit: wrappers become things consumers
*apply* to a db object, not methods they *call on* it. Matches Convex's
own `wrapDatabaseReader` shape more closely, too.

## Scope of the change

### Source changes
- Move `.withRules()` / `.audit()` method bodies out of base classes in
  `db.ts` into standalone `withRules` / `audit` exports in `rules.ts`
  (or a new `wrappers.ts` — tbd).
- Rename / remove the internal factories (`createRulesDatabaseReader`,
  etc.) or promote them directly to the public surface.
- Delete `installRulesSubclasses` + `_subclasses` slot; subclasses go
  back to top-level class declarations in `rules.ts`.
- Remove the ESM `let RulesQueryChain` live-binding trick.

### Consumer migration
- All examples (`examples/task-manager`, `examples/task-manager-mini`,
  `examples/quickstart`, `examples/stress-test`) need updating.
- Hotpot (external consumer — coordinate with them).
- Write a codemod in `packages/zod-to-mini` style that rewrites
  `db.withRules(...).audit(...)` → `audit(withRules(db, ...), ...)`
  (AST-aware so it handles nested expressions and the `ctx` argument
  order correctly).

### Docs
- Migration guide (`docs/migration/v0.8.md`).
- Update `docs/guide/custom-context.md` and any other guide that shows
  `.withRules()` / `.audit()` call sites.
- Update `CLAUDE.md` architecture section.

## Open questions

1. **Naming**: `withRules` + `audit` as top-level exports, or nest under a
   namespace (`wrappers.withRules`, `wrappers.audit`)? Former is what
   React Query-ish APIs do; latter avoids polluting the top-level with
   common names.
2. **Type ergonomics**: Method chaining let us thread `DataModel` /
   `DecodedDocs` generics naturally. As free functions, we need to ensure
   inference survives composition — `audit(withRules(db, ctx, rules), ...)`
   should keep the decoded-doc types on the inner `db`. Worth prototyping
   on a branch before committing to the shape.
3. **Timing**: v0.8.0 is ambiguous right now. zodvex is still 0.7.x in
   beta — stabilizing 0.7 should happen before a breaking API change.
   Realistic window is "after 0.7 ships stable."

## Non-goals

- Don't ship this in a minor version. It's breaking.
- Don't revisit Option 1 (`dbClasses.ts` extract). The sketch in PR #59
  showed it's either fake-structural (installer-shaped indirection) or
  it breaks chaining — at which point you might as well do Option 3.
- Don't land this and Option C's codemod (zod → zod-mini) in the same
  release. Consumers should not be asked to run two codemods in one
  upgrade.

## When to revisit

Whenever we cut 0.8.0. Reference this doc and the PR #59 brainstorm.
The current installer-based fix is stable and not costing anyone
anything at runtime — there's no urgency.
