# Roadmap

Where zodvex is heading. This is a **durable, public-facing** document (a docs-site
candidate) — it describes direction at the level an adopter cares about. Detailed, in-flight
implementation plans are tracked internally and change often, so this page stands on its own
rather than linking to them.

Status legend: **Next** (actively planned) · **Direction** (committed intent, unscheduled)
· **Exploring** (idea we like, not committed) · **Blocked** (waiting on upstream).

---

## Deploy-scale performance

The most active current thread ([#49](https://github.com/panzacoder/zodvex/issues/49) is the
originating issue): making codec-enabled apps deploy at the same scale as hand-written Convex.

- **Codec-paths descriptor codegen** — *Next (in beta as `0.8.0-beta.0`,
  [#80](https://github.com/panzacoder/zodvex/pull/80)).* Codegen emits a pure-Convex
  `_zodvex/tables.ts` (zero Zod in the schema isolate), per-table minimal codec descriptors,
  and a codec-args-only registry — measured at **pure-Convex deploy parity** (~800-table
  TooManyReads wall, the same wall raw `defineTable` hits, instead of OOMing per-entrypoint
  isolates at ~100–150 tables). Gated on a downstream trial before merge. When this lands,
  codegen's role grows: still optional for small apps, but the recommended path at scale.
- **Compile-away (`zodvex compile`)** — *Exploring
  ([#63](https://github.com/panzacoder/zodvex/pull/63), draft).* Rewrite a project to vanilla
  Convex source at build time (`zq` → `query`, models → `defineTable`); measured at ~0.9× of
  the pure-Convex endpoint ceiling. More radical than descriptors; codec-endpoint detection
  still outstanding.
- **Scale-test harness** — *Next ([#81](https://github.com/panzacoder/zodvex/pull/81)).*
  Shape-faithful, axis-decoupled stress harness that baselines main vs any feature branch;
  merges ahead of the descriptor work it measures.

## Ecosystem interop

Playing well with the wider Convex ecosystem — components, convex-helpers triggers, and other
libraries that also want to wrap `ctx` or `ctx.db`.

- **Non-zodvex function-ref passthrough** — *Next
  ([#86](https://github.com/panzacoder/zodvex/pull/86), fixes
  [#85](https://github.com/panzacoder/zodvex/issues/85)).* `ctx.runQuery`/`runMutation`/
  scheduler treat refs without a resolvable function name (e.g. Convex component refs) as
  passthrough instead of throwing — unblocking `@convex-dev/aggregate` and every other
  component called from a zodvex-wrapped function.
- **Composable db wrapping** — *Direction.* A supported way to layer other db wrappers (e.g.
  `convex-helpers/server/triggers`) **under** zodvex's codec/rules layer instead of fighting
  over the same proxy slot — a `ctx.raw` / wrap-an-underlying-db hook. This should be designed
  together with the applied-free-function rules/audit change below; both push the same
  "wrappers you apply" model.
- **Model-bound triggers & cascades** — *Exploring.* The "absorb" end-state: zodvex's own
  wrapper grows a trigger-registration hook so a model can declare reactive cascades right
  next to its access rules — one wrapper doing codec + rules + triggers. Deepens the
  data-layer identity; contingent on the composability groundwork above.

## Data-access layer

- **Applied db wrappers for rules & audit** — *Next.* Move `.withRules()` / `.audit()` from
  method chains to composable free functions — `audit(withRules(ctx.db, ctx, rules), { … })`
  — matching Convex's own `wrapDatabaseReader` shape and removing an internal circular
  dependency. Behavior and rule/audit shapes are unchanged; only the call form. See
  [`guide/rules-and-audit.md`](./guide/rules-and-audit.md). Design together with the
  composable-db-wrapping work under Ecosystem interop — same "wrappers you apply" model.
- **`_creationTime` as a `Date` codec** — *Direction (implemented in
  [#43](https://github.com/panzacoder/zodvex/pull/43), pending rebase + a decision).* A
  codec-first library should decode `_creationTime` to a `Date` automatically, consistent
  with `zx.date()` fields. Open decisions: the PR makes it **unconditional/breaking**, while
  the safer shape is opt-in — pick one explicitly before landing; and whether to brand `_id`
  as `Id<Table>` at the same boundary.

## Client boundary & codegen

- **Decouple validators from handlers** — *Next.* Let codegen reference codecs by exact
  identity from a frontend-safe `*.args.ts` module, so the client can import schemas without
  dragging server code into the browser bundle — retiring codec fingerprinting/brands for
  decoupled functions.
- **Opt-in client-integration plugins** — *Direction (implemented in
  [#45](https://github.com/panzacoder/zodvex/pull/45), pending rebase).* A `zodvex.config.ts`
  that drives codegen of form resolvers (Mantine, TanStack Form, React Hook Form) via
  explicit, package.json-based opt-in — superseding the reverted auto-detection.
- **Sturdier codegen discovery** — *Exploring (RFC open as
  [#51](https://github.com/panzacoder/zodvex/pull/51)).* Replace the fragile
  dynamic-`import()` + Proxy-stub discovery with AST-based (or hybrid static/dynamic)
  analysis.

## Schema conveniences

These are framed as **codec-aware, define-once boundary conveniences**, not a form-builder
framework — they reuse your existing models rather than adding a new authoring surface.

- **Runtime schema introspection** — *Direction (implemented in
  [#47](https://github.com/panzacoder/zodvex/pull/47), pending rebase).* A stable public
  `introspect()` surface (`isConvexId`, `getTableName`, `getDefault`, `isOptional`, …) so
  consumers stop reaching into Zod internals (`_def`). The traversal infrastructure already
  exists.
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

## Superseded & blocked lines

The earlier memory strategy (slim models + `zod/mini` for ~2.4× headroom) is being overtaken
by the Deploy-scale performance work above, which targets full parity rather than incremental
headroom. Consequences:

- **`zod/mini` remains supported but is no longer the performance strategy.** Keep using it if
  you prefer mini's surface; don't reach for it to fix deploy memory — descriptor codegen
  (and eventually compile-away) is that answer.
- **Transparent build-time zod→mini compile** — proven working but needs Convex to expose a
  pre-build hook; moot if compile-away ships. Dormant.
- **Deeper runtime memory work** (lazy Zod for codecs, dynamic model imports in V8 actions) —
  validated experimentally; parked unless the descriptor path leaves a gap.

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
