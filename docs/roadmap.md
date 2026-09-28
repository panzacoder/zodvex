# Roadmap

Where zodvex is heading. This is a **durable, public-facing** document (a docs-site
candidate) — it describes direction at the level an adopter cares about. Detailed, in-flight
implementation plans are tracked internally and change often, so this page stands on its own
rather than linking to them.

Status legend: **Next** (actively planned) · **Direction** (committed intent, unscheduled)
· **Exploring** (idea we like, not committed) · **Blocked** (waiting on upstream).

---

## Deploy-scale performance

Was the most active thread ([#49](https://github.com/panzacoder/zodvex/issues/49) is the
originating issue): making codec-enabled apps deploy at the same scale as hand-written Convex.
The experiment arc closed on 2026-09-28 with the verdicts #144 recorded; what shipped for
scale is the 0.7.11 memoizing registry getters, and the live direction is reference-by-import
for client-visible schemas (see Client boundary & codegen). The harness stays as the
regression gate.

- **Codec-paths descriptor codegen** — *Closed ([#80](https://github.com/panzacoder/zodvex/pull/80),
  2026-09-28).* The port onto the current library measured a smaller import graph but 13
  differences from 25 baseline outcomes, including a wire-valid union codec failure; verdict
  **INCOMPLETE** in [`guide/memory-experiments.md`](./guide/memory-experiments.md). The
  `0.8.0-beta.0` npm publish came from this branch and is unrelated to the 0.8.0 line cut from
  `main`. The scale path is now the 0.7.11 memoizing registry getters plus reference-by-import
  for client-visible schemas (see Codegen discovery below).
- **Compile-away (`zodvex compile`)** — *Closed ([#63](https://github.com/panzacoder/zodvex/pull/63),
  2026-09-28).* The real compiler drops argument decoding, return encoding, refinements and
  defaults; verdict **INCOMPATIBLE**, excluded from performance ranking (same guide).
- **Scale-test harness** — *Merged ([#81](https://github.com/panzacoder/zodvex/pull/81),
  2026-08-13).* Shape-faithful, axis-decoupled stress harness that baselines main against any
  branch; it measured the experiments above and the 0.7.11 registry getters (#148). See
  [`guide/memory-benchmarks.md`](./guide/memory-benchmarks.md).

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
- **`_creationTime` as a `Date` codec** — *Direction ([#43](https://github.com/panzacoder/zodvex/pull/43)
  was closed 2026-07-06 in favor of a clean redo tracked in
  [#95](https://github.com/panzacoder/zodvex/issues/95), which carries the decision below).* A
  codec-first library should decode `_creationTime` to a `Date` automatically, consistent
  with `zx.date()` fields. Open decisions: #43's approach made it **unconditional/breaking**, while
  the safer shape is opt-in — pick one explicitly before landing; and whether to brand `_id`
  as `Id<Table>` at the same boundary.

## Client boundary & codegen

- **Decouple validators from handlers** — *Next.* Let codegen reference codecs by exact
  identity from a frontend-safe `*.args.ts` module, so the client can import schemas without
  dragging server code into the browser bundle — retiring codec fingerprinting/brands for
  decoupled functions.
- **Library-agnostic form binding** — *Direction (tracked in
  [#153](https://github.com/panzacoder/zodvex/issues/153)).* The generated client (or a core
  primitive) exposes an accessor that returns a function's args schema from the registry
  given a function reference; consumers pass that schema to whatever resolver their form
  library uses. React Hook Form and TanStack Form are the integrations to document first;
  `zodvex/form/mantine` stays as a manual-bind primitive. A `zodvex.config.ts` and
  per-library codegen plugins are deferred until a second codegen option needs a config
  file, and auto-detection of form libraries is not coming back. Depends on the generated
  registry carrying checks, defaults, `describe` and `meta` (emitter fidelity, also under
  #153). Rationale in
  [`decisions/2026-09-28-library-agnostic-form-binding.md`](./decisions/2026-09-28-library-agnostic-form-binding.md);
  the earlier `zodvex.config.ts` implementation ([#45](https://github.com/panzacoder/zodvex/pull/45))
  was closed 2026-09-28 as unrebasable (unrelated git history).
- **Codegen discovery** — *Direction.* The static-analysis RFC
  ([#51](https://github.com/panzacoder/zodvex/pull/51), closed 2026-09-28) is preserved at
  [`planning/codegen-static-analysis.md`](./planning/codegen-static-analysis.md) but is not
  being pursued. The direction is reference-by-import for client-visible schemas (the
  decouple-validators item above; detail in
  [`issues/2026-06-08-validator-handler-decoupling.md`](./issues/2026-06-08-validator-handler-decoupling.md)),
  which shrinks what discovery has to execute rather than replacing execution with AST
  analysis.

## Schema conveniences

These are framed as **codec-aware, define-once boundary conveniences**, not a form-builder
framework — they reuse your existing models rather than adding a new authoring surface.

- **Runtime schema introspection** — *Direction (tracked in
  [#153](https://github.com/panzacoder/zodvex/issues/153); the earlier implementation in
  [#47](https://github.com/panzacoder/zodvex/pull/47) was closed 2026-09-28 as unrebasable (unrelated git history)).* A stable public
  `introspect()` surface (`isConvexId`, `getTableName`, `getDefault`, `isOptional`, …) so
  consumers stop reaching into Zod internals (`_def`). Constraints: built on `zod/v4/core`
  types so it works with `zod/mini`; metadata read through the public `.meta()`/registry
  channel so model wrappers can extend it; codecs report their semantic base type. It gives
  wrong answers on a shape-only registry copy, so it follows emitter fidelity (#157). The
  earlier traversal module was removed in 0.7.0, so this is a rewrite on core types, not a
  repackaging.
- **Type-safe form defaults from schemas** — *Exploring (#153).* `getSchemaDefaults()` /
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
