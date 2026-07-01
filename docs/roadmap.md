# Roadmap

Where zodvex is heading. This is a **durable, public-facing** document (a docs-site
candidate) — it describes direction at the level an adopter cares about. Detailed,
in-flight implementation plans are ephemeral and live under `docs/superpowers/` and
`docs/planning/`; this page links to them for the curious but doesn't depend on them.

Status legend: **Next** (actively planned) · **Direction** (committed intent, unscheduled)
· **Exploring** (idea we like, not committed) · **Blocked** (waiting on upstream).

---

## Data-access layer

- **Applied db wrappers for rules & audit** — *Next.* Move `.withRules()` / `.audit()` from
  method chains to composable free functions — `audit(withRules(ctx.db, ctx, rules), { … })`
  — matching Convex's own `wrapDatabaseReader` shape and removing an internal circular
  dependency. Behavior and rule/audit shapes are unchanged; only the call form.
  → [`issues/free-function-db-wrappers.md`](./issues/free-function-db-wrappers.md),
  [`guide/rules-and-audit.md`](./guide/rules-and-audit.md)
- **`_creationTime` as a `Date` codec** — *Direction.* A codec-first library should decode
  `_creationTime` to a `Date` automatically, consistent with `zx.date()` fields. Ships as
  opt-in (breaking for anyone reading the raw number). Open question: brand `_id` as
  `Id<Table>` at the same boundary. → `archive/todo/system-field-codecs.md`

## Client boundary & codegen

- **Decouple validators from handlers** — *Next.* Let codegen reference codecs by exact
  identity from a frontend-safe `*.args.ts` module, so the client can import schemas without
  dragging server code into the browser bundle — retiring codec fingerprinting/brands for
  decoupled functions. → [`issues/validator-handler-decoupling.md`](./issues/validator-handler-decoupling.md)
- **Opt-in client-integration plugins** — *Direction.* A `zodvex.config.ts` that drives
  codegen of form resolvers (Mantine, TanStack Form, React Hook Form) via explicit,
  package.json-based opt-in — superseding the reverted auto-detection.
  → `archive/todo/opt-in-client-library-codegen.md`
- **Sturdier codegen discovery** — *Exploring.* Replace the fragile dynamic-`import()` +
  Proxy-stub discovery with AST-based (or hybrid static/dynamic) analysis.
  → `archive/todo/codegen-static-analysis.md`

## Schema conveniences

These are framed as **codec-aware, define-once boundary conveniences**, not a form-builder
framework — they reuse your existing models rather than adding a new authoring surface.

- **Runtime schema introspection** — *Direction.* A stable public `introspect()` surface
  (`isConvexId`, `getTableName`, `getDefault`, `isOptional`, …) so consumers stop reaching
  into Zod internals (`_def`). The traversal infrastructure already exists.
  → `archive/todo/motiion-inspired-utilities.md` (Phase 1)
- **Type-safe form defaults from schemas** — *Exploring.* `getSchemaDefaults()` /
  `getPartialDefaults()` derived from the same models that validate args (builds on
  introspection). → `archive/todo/motiion-inspired-utilities.md` (Phases 2–3)

## Model & namespace evolution

- **Slim model becomes the default** — *Direction.* Converge on a lean,
  Convex-`defineTable`-like model whose schemas derive on demand via `zx.*`. A future minor
  flips `schemaHelpers` to `false`; a future major removes the eager schema bundle. Prefer
  `zx.doc(Model)` over `Model.schema.doc` in consumer code so it works for slim and full
  models alike. → `docs/superpowers/specs/2026-04-14-slim-model-and-zx-helpers-design.md`
- **Pagination shape unification** — *Direction.* Align `zx.paginationResult()` to Convex's
  real `PaginationResult` shape (a deliberate breaking change).

## Architecture (internal)

- **Unified function-contract compiler** — *Direction.* Collapse `wrappers` / `builders` /
  `custom` / `functionContracts` / `init` onto one compiler they all delegate to (the largest
  remaining architectural aspiration). → `docs/superpowers/plans/2026-04-07-full-mini-architecture-refactor.md`
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
  → `archive/todo/example-project-validation-coverage.md`

## Blocked on upstream

- **Transparent build-time zod→mini compile** — proven working but needs Convex to expose a
  pre-build hook. Until then, `zodvex/mini` (explicit entrypoint) is the supported path.
- **Deeper memory wins** (compiling Zod away / lazy Zod for codecs) — parked while the current
  slim-model + mini headroom (~2.4×) holds.

---

*Archive note:* several items above still reference `docs/archive/todo/*`. Those five docs
carry live, unrealized intent and should be promoted into this roadmap (and their detail into
`docs/planning/`) before the archive is pruned — see
[`planning/state-of-zodvex.md`](./planning/state-of-zodvex.md) §5.
