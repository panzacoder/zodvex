# Roadmap

Where zodvex is heading. This is a **durable, public-facing** document (a docs-site
candidate) — it describes direction at the level an adopter cares about. Detailed, in-flight
implementation plans are tracked internally and change often, so this page stands on its own
rather than linking to them.

Status legend: **Next** (actively planned) · **Direction** (committed intent, unscheduled)
· **Exploring** (idea we like, not committed) · **Blocked** (waiting on upstream).

---

## Data-access layer

- **Applied db wrappers for rules & audit** — *Next.* Move `.withRules()` / `.audit()` from
  method chains to composable free functions — `audit(withRules(ctx.db, ctx, rules), { … })`
  — matching Convex's own `wrapDatabaseReader` shape and removing an internal circular
  dependency. Behavior and rule/audit shapes are unchanged; only the call form. See
  [`guide/rules-and-audit.md`](./guide/rules-and-audit.md).
- **`_creationTime` as a `Date` codec** — *Direction.* A codec-first library should decode
  `_creationTime` to a `Date` automatically, consistent with `zx.date()` fields. Ships as
  opt-in (breaking for anyone reading the raw number). Open question: brand `_id` as
  `Id<Table>` at the same boundary.

## Client boundary & codegen

- **Decouple validators from handlers** — *Next.* Let codegen reference codecs by exact
  identity from a frontend-safe `*.args.ts` module, so the client can import schemas without
  dragging server code into the browser bundle — retiring codec fingerprinting/brands for
  decoupled functions.
- **Opt-in client-integration plugins** — *Direction.* A `zodvex.config.ts` that drives
  codegen of form resolvers (Mantine, TanStack Form, React Hook Form) via explicit,
  package.json-based opt-in — superseding the reverted auto-detection.
- **Sturdier codegen discovery** — *Exploring.* Replace the fragile dynamic-`import()` +
  Proxy-stub discovery with AST-based (or hybrid static/dynamic) analysis.

## Schema conveniences

These are framed as **codec-aware, define-once boundary conveniences**, not a form-builder
framework — they reuse your existing models rather than adding a new authoring surface.

- **Runtime schema introspection** — *Direction.* A stable public `introspect()` surface
  (`isConvexId`, `getTableName`, `getDefault`, `isOptional`, …) so consumers stop reaching
  into Zod internals (`_def`). The traversal infrastructure already exists.
- **Type-safe form defaults from schemas** — *Exploring.* `getSchemaDefaults()` /
  `getPartialDefaults()` derived from the same models that validate args (builds on
  introspection).

## Model & namespace evolution

- **Slim model becomes the default** — *Direction.* Converge on a lean,
  Convex-`defineTable`-like model whose schemas derive on demand via `zx.*`. A future minor
  flips `schemaHelpers` to `false`; a future major removes the eager schema bundle. Prefer
  `zx.doc(Model)` over `Model.schema.doc` in consumer code so it works for slim and full
  models alike.
- **Pagination shape unification** — *Direction.* Align `zx.paginationResult()` to Convex's
  real `PaginationResult` shape (a deliberate breaking change).

## Architecture (internal)

- **Unified function-contract compiler** — *Direction.* Collapse `wrappers` / `builders` /
  `custom` / `functionContracts` / `init` onto one compiler they all delegate to (the largest
  remaining architectural aspiration).
- **Source-reorg follow-ups** — *Direction.* Split `utils.ts`, add an import-boundary lint so
  public `.d.ts` can't leak internals, and collapse the `public/model.ts` ↔
  `public/mini/model.ts` type-layer duplication.

## Deprecation removal (pre-1.0)

Removed rather than carried indefinitely, each with a current replacement: `zodTable`/`zodDoc`,
`zQueryBuilder`/`zMutationBuilder`/`zActionBuilder` (+ custom variants), `zid()`,
`convexCodec()`, `mapDateFieldToNumber()`, and the `zodvex/core` / `zodvex/legacy` entrypoints.
See [`MIGRATION.md`](../MIGRATION.md).

## Quality & tooling

- **Performance benchmarks** vs native Convex validators — *Exploring.*
- **Generated API doc site** (TypeDoc) — *Exploring*; part of standing up the public docs site.
- **Example-project validation coverage** — *Direction.* CI hardening checklist (crons,
  `convex.config.ts`, components, `.withRules()`), each item tied to a past regression.

## Blocked on upstream

- **Transparent build-time zod→mini compile** — proven working but needs Convex to expose a
  pre-build hook. Until then, `zodvex/mini` (explicit entrypoint) is the supported path.
- **Deeper memory wins** (compiling Zod away / lazy Zod for codecs) — parked while the current
  slim-model + mini headroom (~2.4×) holds.

## Parked — may be obsolete

Deferred ideas kept for the record. Each was set aside, and the architecture has since moved
on — they're likely moot and would need re-validation against the current design before anyone
acts on them. Not commitments.

- **Generic index field-path helper (`fieldPath()`)** — a proposed blessed escape hatch for
  `.index([field] as any)` through generics. In practice the example projects haven't hit
  index type-safety problems, so this may simply be a non-issue. Revisit only if consumers
  repeatedly trip over the generic cast.
- **Type-aware transforms as the zod→mini default** — a benchmark-gated question from the
  `zod-to-mini` plugin work. Module-size limits have since been addressed by other means
  (slim models, the explicit `zodvex/mini` entrypoint), so this line is dormant and may no
  longer be relevant.
- **Traversal-primitive exports (`unwrapOnce`/walk helpers)** — an older ask to export schema
  traversal so consumers stop reimplementing it. The internals were rearchitected since (the
  `transform/` module was removed), so the original shape no longer applies; if the runtime
  introspection surface above lands, it would cover this need natively.
