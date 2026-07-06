# Spec: `zodvex/fluent` — fluent-convex integration

**Date:** 2026-07-01
**Status:** Draft / exploratory
**Owner:** TBD
**Related:** [fluent-convex](https://github.com/mikecann/fluent-convex), `docs/issues/2026-04-24-free-function-db-wrappers.md`

---

## Summary

[fluent-convex](https://github.com/mikecann/fluent-convex) is a fluent builder for
Convex functions with composable **handler-level** middleware (onion-style `.use()`),
reusable callable chains, and a plugin system (`.extend()`). Zod is an optional plugin
for it (`fluent-convex/zod`), doing structural arg/return conversion via convex-helpers.

zodvex operates at a **different layer**: it is a Zod↔Convex *semantic bridge* whose
signature capability is a codec-aware `ctx.db` decorator stack (automatic Date/ID/codec
encode-decode) plus `.withRules()` (RLS) and `.audit()` on that same db object.

The two layers are **orthogonal**:

```
fluent-convex  →  handler middleware (wraps the function, augments ctx)
zodvex         →  data-access middleware (wraps ctx.db, per-document codecs/rules/audit)
```

fluent-convex middleware augments ctx via `next({ ...ctx, db: wrappedDb })` — which is
exactly the injection point zodvex's wrapped db wants. This spec proposes a small
`zodvex/fluent` entrypoint that lets a fluent-convex chain adopt zodvex's data layer.

**This is a proposal, not a commitment.** See [Recommendation](#recommendation).

---

## Goals

- Let a fluent-convex function get zodvex's **codec-aware `ctx.db`** (Date ↔ timestamp,
  typed IDs, custom codecs) with encode/decode at the db boundary.
- Optionally inject `.withRules()` / `.audit()` behavior automatically.
- Keep fluent-convex as the outer function-registration layer (its `.public()` /
  `.internal()` still register the function); zodvex only supplies the db layer.

## Non-goals

- **No double-wrapping of args/returns validation.** Both libraries want to own
  args/returns validation and ctx augmentation. On a single function it is one or the
  other — you either use `zq`/`zm` OR a fluent-convex chain. `zodvex/fluent` supplies
  *only the db layer* into a fluent chain; it does not re-validate args.
- **No routing `zx.date()` codecs through fluent-convex's `WithZod` plugin.**
  `WithZod` converts codec schemas structurally (via convex-helpers) but does **not**
  run the wire encode/decode. That path silently half-works and is a trap — explicitly
  out of scope.
- No attempt to track fluent-convex's plugin internals beyond its public middleware/ctx
  contract.

---

## Convergence note (2026-07-01)

The `wrapCodecDb` primitive proposed in Step 1 is the same primitive demanded by two other
live threads: **db-wrap composability** for convex-helpers triggers / Convex components
(issue #85's promoted "first-class ask" — let other wrappers sit *under* zodvex's codec/rules
layer) and the **v0.8 free-function `withRules`/`audit`** migration
(`docs/issues/free-function-db-wrappers.md`). All three want "a standalone, composable way to
build the codec-aware db around an arbitrary underlying db." Design them as one surface; the
fluent-convex adapter then becomes a trivial consumer. Note the free-function direction also
supersedes this spec's chained `wrapCodecDb(...).withRules(...)` sketch — prefer the applied
form `audit(withRules(wrapCodecDb(db, schema), ctx, rules), cfg)` once that lands.

## The blocker today

The codec-aware db (`ZodvexDatabaseReader` / `ZodvexDatabaseWriter`) is constructed only
*inside* `initZodvex`. There is no public primitive to wrap an arbitrary `ctx.db` with a
schema's codec registry. Step 1 below extracts that primitive; it is independently useful
(see `docs/issues/2026-04-24-free-function-db-wrappers.md`) and de-risks the "opt-in rules
footgun" regardless of whether the fluent integration ships.

---

## Proposed design

### Step 1 — extract a standalone db-wrapper primitive (prerequisite, ships on its own merits)

Expose from `zodvex/server` the factory that `initZodvex` already uses internally:

```ts
// zodvex/server
export function wrapCodecDb<DataModel, DecodedDocs>(
  db: GenericDatabaseReader<DataModel> | GenericDatabaseWriter<DataModel>,
  schema: ZodvexSchema, // the defineZodSchema output that carries codec registry
): ZodvexDatabaseReader<DataModel, DecodedDocs> | ZodvexDatabaseWriter<DataModel, DecodedDocs>
```

- Reader vs writer is chosen by the input db's capabilities (mirrors `initZodvex`).
- The returned object already carries `.withRules()` and `.audit()` — no new surface.
- `initZodvex` is refactored to call `wrapCodecDb` internally (single source of truth).

### Step 2 — the `zodvex/fluent` entrypoint

A thin adapter that turns the schema into fluent-convex middleware. Two flavors:

```ts
// zodvex/fluent
import type { ZodvexSchema } from 'zodvex/server'

/**
 * Returns fluent-convex middleware factories bound to a schema.
 * Consumers pass their own fluent-convex `createBuilder<DataModel>()` result.
 */
export function zodvexFluent(schema: ZodvexSchema): {
  /** Injects a codec-aware ctx.db (Date/ID/codec encode-decode at the boundary). */
  withCodecDb: FluentMiddleware
  /** Injects codec-aware ctx.db + rules. Runtime ctx closure supported. */
  withRules: (rules: ZodvexRules, config?: ZodvexRulesConfig) => FluentMiddleware
  /** Injects codec-aware ctx.db + audit callbacks. */
  withAudit: (config: WriterAuditConfig) => FluentMiddleware
}
```

Each returned value is a plain fluent-convex middleware:

```ts
const withCodecDb: FluentMiddleware = async (ctx, next) =>
  next({ ...ctx, db: wrapCodecDb(ctx.db, schema) })
```

### Usage

```ts
import { createBuilder } from 'fluent-convex'
import type { DataModel } from './_generated/dataModel'
import schema from './schema'         // defineZodSchema output
import { zodvexFluent } from 'zodvex/fluent'

const convex = createBuilder<DataModel>()
const zv = zodvexFluent(schema)

// codec-aware db inside a fluent chain
export const listEvents = convex
  .query()
  .use(zv.withCodecDb)                // ctx.db now decodes Dates/IDs automatically
  .input({ limit: v.number() })
  .handler(async (ctx, args) => {
    // ctx.db.query('events').collect() returns decoded docs (Date objects)
    return await ctx.db.query('events').take(args.limit)
  })
  .public()

// rules, parameterized by runtime auth via a closure the middleware builds
export const listOwnEvents = convex
  .query()
  .use(authMiddleware)                                  // fluent-convex adds ctx.user
  .use((ctx, next) =>
    next({ ...ctx, db: wrapCodecDb(ctx.db, schema).withRules(
      { ownerId: ctx.user.id },
      { events: { read: (c, doc) => doc.ownerId === c.ownerId ? doc : null } },
    ) }),
  )
  .handler(async (ctx) => await ctx.db.query('events').collect())
  .public()
```

Note the second example uses `wrapCodecDb(...).withRules(...)` directly rather than
`zv.withRules(...)`, because the rule closes over `ctx.user` which only exists *after*
`authMiddleware` runs. `zv.withRules(...)` is the ergonomic path when rules are static;
the raw primitive is the escape hatch when they depend on upstream middleware ctx. This
is the same runtime-closure flexibility documented in
`docs/decisions/2026-02-17-runtime-only-middleware.md`.

---

## What this does NOT give you

- **Args/returns codecs.** fluent-convex owns `.input()`/`.returns()`. `zx.date()` in a
  fluent `.input()` will not encode/decode. If you need arg/return codecs, use zodvex's
  own `zq`/`zm` builders — not the fluent path. `zodvex/fluent` is a *db-layer* adapter.
- **Automatic install.** The middleware is opt-in per chain (`.use(zv.withCodecDb)`).
  This matches fluent-convex's declarative model; a project-wide default would live in
  the consumer's own base builder (`const convex = createBuilder().use(zv.withCodecDb)`).

---

## Open questions

1. **Peer dependency vs optional.** fluent-convex should be an *optional* peer dep;
   `zodvex/fluent` must not pull it into the core install. Guard with a runtime check +
   types-only import, mirroring how `WithZod` treats zod/convex-helpers.
2. **Schema handle shape.** Does `defineZodSchema`'s output already expose the codec
   registry in a form `wrapCodecDb` can consume standalone, or does that plumbing
   currently only exist post-`initZodvex`? (Determines Step 1 effort.)
3. **Version pinning.** fluent-convex is young (v0.13, "developed with AI assistance").
   Pin a tested range and document the tested version in the entrypoint README.
4. **Reader/writer detection** across query vs mutation ctx in a fluent chain — confirm
   fluent-convex exposes enough at middleware time to pick the right wrapper.

---

## Effort estimate

- **Step 1 (`wrapCodecDb` primitive):** small–medium. Mostly refactoring existing
  `initZodvex` internals to expose a factory + tests. **Worth doing regardless.**
- **Step 2 (`zodvex/fluent` entrypoint):** small. Thin middleware adapters + an example
  + docs, once Step 1 lands.
- **Ongoing:** maintenance commitment tracking fluent-convex's middleware/ctx contract.

---

## Recommendation

**Do not build Step 2 proactively.** Ship **Step 1** (`wrapCodecDb`) on its own merits —
it is independently useful and de-risks the rules footgun. Gate **Step 2** on real
demand for fluent-convex + zodvex together; when it arrives, the entrypoint is a thin
adapter on top of Step 1. Positioning-wise, `zodvex/fluent` reinforces the core message:
zodvex is the *data layer*, and it composes cleanly under any handler-middleware
framework — including fluent-convex — because the two live at different layers.
