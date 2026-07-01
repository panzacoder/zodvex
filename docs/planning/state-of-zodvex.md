# State of zodvex — what we do, where we're going

**Date:** 2026-07-01
**Status:** Living synthesis (reconstructed from a full crawl of `docs/`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `MIGRATION.md`, `CHANGELOG.md`, `TODO.md`)
**Purpose:** One place that captures what zodvex actually does today, where it's heading, and
the documentation cleanup that follows from that picture. Feeds and sharpens
[`../positioning.md`](../positioning.md).

---

## 1. Identity (the one-liner)

**zodvex lets you use Zod v4 as your schema language for Convex** — define your tables,
args, and return types once and use them end to end. Automatic validation and codecs at
every boundary are the standout *differentiator*; the codec-aware `ctx.db` is the flagship
of that, but the *identity* is "Zod as your source of truth across a Convex app." Not a
validator-mapper (that's the `convex-helpers` foundation it stands on), not a
middleware/composition framework. See [`../positioning.md`](../positioning.md).

The crawl **strongly reinforced** this framing across nearly every doc. The exceptions are
drift, not disagreement (see §4 and §5).

---

## 2. What zodvex does today (capability inventory)

### Setup & builders
- `initZodvex(schema, primitives, opts?)` → pre-wired `zq, zm, za, ziq, zim, zia` with a
  codec-aware `ctx.db` (opt out via `wrapDb: false`).
- `.withContext(customCtx(...))` for auth/permission/custom ctx; `defineContext()` (0.7.4)
  to author reusable customizations without annotation drift; `onSuccess` post-handler hook
  (sees decoded runtime types).

### Models & schema
- `defineZodModel(name, shape | z.object | (discriminated) union, opts?)` — client-safe;
  exposes `.table`, `.fields`, `.schema.{doc,insert,update,docArray,paginatedDoc}`,
  `.withSystemFields()`, index/search/vector metadata.
- **Slim models** — `defineZodModel(..., { schemaHelpers: false })` builds 2 Zod instances
  instead of 6 (~29 KB vs ~106 KB/model); the rest derive on demand via `zx.*`.
- `defineZodSchema({...})` lowers models into a Convex schema from explicit metadata.

### The `zx` namespace (the zodvex analogue of Zod's `z`)
Two roles — **codec/validator constructors** and **schema-derivation helpers**:
- Codecs/validators: `zx.date()` (Date↔timestamp codec), `zx.codec(wire, runtime, {encode,
  decode})` (custom codec, with optional `{ brand }`), `zx.id('table')` (typed ID validator
  — **NOT a codec**, no wire transform).
- Helpers: `zx.doc(model)`, `zx.update(model)`, `zx.docArray(model)`,
  `zx.paginationResult(item)`, `zx.paginationOpts()`.

### Codecs at every boundary
Automatic encode/decode at: function **args** (decode) and **returns** (encode), DB
**reads/writes**, `.withIndex()` / `.withSearchIndex()`, **and `.filter()`** (the last query
gap, closed via `ZodvexFilterBuilder`/`wrapFilterBuilder`). Escape hatches: `decodeDoc` /
`encodeDoc`. Codec **provenance brands** (0.7.2) let codegen match codecs by identity →
brand → fingerprint → hard error (never silently inlines a codec).

### Validation at every boundary
Function args (`safeParse`) and returns (`validateReturns`), **and every document read at
the DB layer** (`decodeDoc` = a real Zod `parse`). DB-layer validation — not just function
edges — is a differentiator on its own.

### Data-access security & audit
`.withRules()` (row-level security; field-level via typed hidden markers) and `.audit()`
(afterRead/afterWrite), chainable on the wrapped `ctx.db`, operating on **decoded** docs.
`CustomField`/sensitive-field is the single universal runtime type with a monotonic,
type-enforced "can only restrict, never escalate" invariant.

### Streams
`zodvexStream(db, schema)` and `zodvexMergedStream(streams, orderByIndexFields)` — typed
convex-helpers stream interop over the secure reader; decoded item types; rejects
codec-backed merge keys.

### Codegen (optional)
`zodvex generate` / `zodvex dev` → `convex/_zodvex/` (deterministic output). Provides the
`zodvexRegistry`, typed `useZodQuery`/`useZodMutation`, `ZodvexClient`/`ZodvexReactClient`,
`createBoundaryHelpers` (`encodeArgs`/`decodeResult`), and per-library form resolvers
(`mantineResolver`). **Not required** for the codec-aware DB — `initZodvex` alone works;
quickstart proves it.

### Full / mini
Real parallel entrypoints (`zodvex`, `zodvex/mini`, `+/server`, `+/client`, `+/react`).
Shared code is typed against `zod/v4/core` `$Zod*` types (the "core-type boundary," guarded
by `lint:core-types`); mini is produced by a build-time `zod → zod/mini` alias in tsup.
Ships ~2.4× deploy headroom on Convex's 64 MB isolate ceiling.

### Foundational / advanced
`zodToConvex` / `zodToConvexFields` (low-level mapping — deliberately demoted to "most users
won't need these"); AI SDK support (`toJSONSchema`, `zodvexJSONSchemaOverride`); form
integration (`zodResolver` over `z.object(Model.fields)`); `pickShape`/`safePick` for
100+-field schemas; `returnsAs<T>()`.

---

## 3. Where it's going

### Near-term (targeted at v0.8.0, gated on 0.7 stabilizing)
- **`.withRules()` / `.audit()` → applied free functions.** `audit(withRules(ctx.db, ctx,
  rules), { afterWrite })` replaces method chains, to break the `db.ts ↔ rules.ts` circular
  dependency at the structural level. Deliberately "wrappers you *apply*, not methods you
  *call*" — mirrors Convex's own `wrapDatabaseReader`. (`docs/issues/free-function-db-wrappers.md`)
  - *Note:* this reshapes the `zodvex/fluent` sketch — the free-function form is a **cleaner**
    fit for a fluent-convex middleware than the chained one. Reconcile
    [`fluent-convex-integration.md`](./fluent-convex-integration.md) when this lands.
- **Decouple validators from handlers.** Codegen references codecs by exact identity from a
  frontend-safe `*.args.ts` module, eliminating fingerprinting/brands for decoupled
  functions. Brands remain a fallback for inline codecs. (`docs/issues/validator-handler-decoupling.md`)

### Model & namespace direction
- **Slim model becomes the default.** A future minor flips `schemaHelpers` to `false`; a
  future major removes the eager 6-schema bundle entirely. `ZodModelBase` (name/fields/indexes
  only) is already the internal constraint guaranteeing nothing depends on the bundle. End
  state: a lean, Convex-`defineTable`-like model with schemas derived on demand via `zx.*`.
- **`zx` as the ambient helper surface.** Consumer code (esp. endpoint `returns:`) should
  reference `zx.doc(Model)` rather than `Model.schema.doc`, so the same code works for slim
  and full models.
- **Pagination shape unification** — align `zx.paginationResult()` to Convex's real
  `PaginationResult` (`continueCursor: string`, optional-nullable `splitCursor`); a deliberate
  breaking change.

### Architecture (unbuilt intent)
- **Unified function-contract compiler** — the largest remaining architectural aspiration
  (Phase 4 of the full-mini refactor). `wrappers.ts` / `builders.ts` / `custom.ts` /
  `functionContracts.ts` / `init.ts` still exist separately; the goal is one compiler they all
  delegate to. (`docs/superpowers/plans/2026-04-07-full-mini-architecture-refactor.md`)
- **Source-reorg Phase 6** — split `utils.ts` into domain files, add import-boundary lint so
  public `.d.ts` can't leak internals, collapse the `public/model.ts` ↔ `public/mini/model.ts`
  type-layer duplication. (`.../2026-04-08-source-reorg-execution-plan.md`)

### Deprecation removal (pre-1.0 — "remove rather than carry")
`zodTable`/`zodDoc`, `zQueryBuilder`/`zMutationBuilder`/`zActionBuilder` (+ custom variants),
`zid()`, `convexCodec()`, `mapDateFieldToNumber()`, `zodvex/core`, `zodvex/legacy`. Each has a
current replacement (see `TODO.md`, `MIGRATION.md`). Native `z.date()` already hard-throws.

### Unrealized ideas worth promoting out of the archive (see §5)
- **`_creationTime` as a `zx.date()` codec** — decode system fields to `Date` automatically.
  The most on-thesis idea in the archive; unshipped (`schemaHelpers.ts:205` still `z.number()`).
  Carries the open `_id`-as-branded-`Id<Table>` question. (`archive/todo/system-field-codecs.md`)
- **Runtime schema introspection API** — `introspect()`, `isConvexId`, `getTableName`,
  `getDefault`, etc. Assembly, not construction (traversal infra already exists); stops
  consumers poking `_def`. (`archive/todo/motiion-inspired-utilities.md` Phase 1)
- **`getSchemaDefaults()` / form-config derivation** — type-safe form defaults and
  schema→form-field config from the same models (Phases 2-3, depends on introspection).
- **`zodvex.config.ts` opt-in client-integration plugins** — config-driven form-resolver
  codegen (mantine / TanStack / RHF); supersedes the reverted auto-detection.
  (`archive/todo/opt-in-client-library-codegen.md`)
- **Static/hybrid codegen discovery** — replace the fragile dynamic-`import()` + Proxy-stub
  discovery with AST-based analysis. (`archive/todo/codegen-static-analysis.md`)

### Longer-term / parked
Perf benchmarks vs native Convex validators; TypeDoc API site (`TODO.md`). Memory S3/S4
(compile Zod away / lazy Zod) deferred; the transparent build-time zod→mini compile is proven
but **blocked on Convex exposing a pre-build hook**.

---

## 3b. In-flight work on GitHub (surveyed 2026-07-01)

The docs crawl above predates this survey of the 4 open issues / 10 open PRs. Directional
threads, in priority order (all reflected in `docs/roadmap.md` as of this date):

1. **Deploy-scale performance** — the dominant arc. #49 (external user churned off zodvex over
   zod-v4 OOM) → #81 (rebuilt stress harness, merges first) → **#80 codec-paths descriptors,
   beta-cut as `0.8.0-beta.0`, measured at pure-Convex deploy parity, gated on a hotpot
   trial** → #63 `zodvex compile` (compile-away, draft) → #84 (dynamic-import validation).
   Consequences: mini is demoted as a perf strategy (kept as a surface preference); the
   "blocked on upstream pre-build hook" line is moot if compile-away ships; codegen's role
   grows from client conveniences to the scale path. **Docs hold-back:** do not flip
   README/Quick Start messaging until #80 clears its trial; #80 also raises "should quickstart
   adopt codegen."
2. **Ecosystem composability** — #85's comment thread promoted db-wrap composability to a
   first-class ask (convex-helpers triggers and zodvex fight over the same `ctx.db` proxy
   slot). #86 (ref passthrough) is the ready near-term fix. Long-term shapes: compose
   (`ctx.raw` / wrap-underlying-db) vs absorb (model-bound triggers/cascades declared next to
   access rules). Converges with the v0.8 free-function wrappers issue and the
   `wrapCodecDb` primitive in `fluent-convex-integration.md` — one design surface.
3. **Native-semantics fidelity** — #82/#83 (patch strips `undefined` → can't unset fields;
   fix ready). Generalized into an architectural rule in `ARCHITECTURE.md`: the codec layer
   never subtracts native Convex capability.
4. **Stale March PRs implement three roadmap items** — #43 (`_creationTime` → `Date`; PR is
   unconditional/breaking, roadmap prefers opt-in — decision required), #45
   (`zodvex.config.ts` integrations), #47 (introspection Phase 1, 61 tests). All based on
   pre-refactor main; need rebase + reevaluation, not greenfield work.
5. **Housekeeping** — #51 (static-analysis RFC) moves `todo/codegen-static-analysis.md` to
   `docs/plans/`; that file now lives at `docs/planning/codegen-static-analysis.md` after the
   prune — reconcile paths when #51 rebases (or close it in favor of the roadmap entry).
   #70 (parked, no repro on 0.7.2) yielded one docs task, now done: the brand-vs-brand
   disambiguation in `guide/custom-codecs.md`.

## 4. Positioning findings

- **Broad reinforcement.** `ARCHITECTURE.md`, `CLAUDE.md`, the guides, the decisions, and the
  specs all cohere with the identity-first statement. The middleware philosophy is explicit
  and consistent: "wrappers you apply, not a `.use()` chain."
- **Refine the `zx` framing.** Describe `zx` as the **codec + schema-helper** namespace, not
  "just codecs." Post-slim-model, `zx.doc`/`zx.docArray`/`zx.paginationOpts` are central to the
  define-once-use-end-to-end story; "codecs in your schema" alone undersells it.
- **Hold the line: `zx.id()` is a typed validator, not a codec.** Specs repeat this
  deliberately; positioning copy must not lump it with `zx.date()`/`zx.codec()`.
- **Terminology frictions to avoid (not contradictions):**
  - `docs/decisions/2026-02-17-runtime-only-middleware.md` is titled "Database Middleware" and
    sketches `onRead`/`onWrite` hooks that were later dropped (`:193`). The *principle*
    (runtime-typed docs) is load-bearing; the hook API is dead. A casual reader could misread
    the title against "not a middleware framework."
  - The internal "function-contract compiler / pipeline" language is *internal plumbing* — keep
    positioning clear it's not a user-facing composition chain.
- **A sharp line worth resurfacing verbatim** (from `archive/todo/system-field-codecs.md`):
  *"A codec-first library should decode `_creationTime` as `Date` automatically, consistent with
  how user-defined `zx.date()` fields work."*
- **Caveat when resurfacing archive ideas:** the motiion doc's "batteries-included /
  auto-form-generation / feature-checklist-vs-competitors" framing pulls toward exactly the
  validator-mapper/framework positioning we reject. Reframe those ideas as **codec-aware
  boundary conveniences**, not a form-builder framework.

---

## 5. Documentation health & prune plan

### High priority (active contradictions / gaps)
- **`CONTRIBUTING.md` — rewrite, don't patch.** The single most-stale doc: says "Builders are
  the primary public API," lists `zodTable`/`zid`/`convexCodec` as *public*, describes a flat
  pre-0.6 `src/` layout, and uses `bun test` (which `CLAUDE.md` forbids). It never mentions
  `initZodvex`, `defineZodModel`, or the codec-aware DB. Reads as pre-0.6.
- **`.withRules()` / `.audit()` have no guide.** The headline data-access feature appears only
  incidentally in `streams.md`. This is a gap, not staleness — write `docs/guide/rules-and-audit.md`
  (and account for the v0.8 free-function shift so it doesn't immediately go stale).
- **Migration docs are triplicated and mis-linked.** `MIGRATION.md` **omits v0.6 entirely**
  (the largest breaking release) — it lives only in `docs/migration/v0.6.md`, which the ~90%-
  overlapping `docs/skills/migrate-to-v0.6.md` restates. Cross-link and de-duplicate; the skill
  should reference the doc, not copy it. The skill also shows native `z.date()` "working" though
  it now hard-throws.
- **`CHANGELOG.md` link-def rot** — compare links missing for 0.7.2/0.7.3/0.7.5/0.7.6.

### Medium (duplication / leakage in guides)
- Merge `docs/guide/large-schemas.md` into `working-with-subsets.md` (near-verbatim `pickShape`/
  `safePick` overlap).
- Trim maintainer-facing internals from `codegen.md` (circular-import thunk rationale, stub
  chicken-and-egg); minor `ai-sdk.md` ↔ `zx-namespace.md` overlap on "`zx.id` is not a transform."
- Several guides lead validation-first in their intros; align intros to the identity-first
  framing (codec-aware DB as the differentiator, per the `readme-and-docs-restructure` spec).

### Archive verdicts — EXECUTED 2026-07-01
`docs/archive/` no longer exists: the docs below were deleted (git history is the archive) and
the five live TODOs were moved to `docs/planning/`. Verdicts kept for the record:

**Safe to delete (shipped or abandoned):**
`archive/superpowers-plans/`: `migrate-to-zod-v4-core`, `full-mini-mode` (build-time alias
shipped; the `getZ`/`setZodFactory` factory it described was **abandoned/absent from source**),
`zod-to-mini-vite-plugin`, `type-aware-transforms`, `zod-v4-oom-phase0`, `stress-test-three-modes`,
`filter-codec-encoding`. `archive/todo/`: `hotpot-unwraponce-migration`, `hotpot-upstream-audit-2026-03-17`.
`archive/plans/`: `codegen-form-resolver-auto-detection` (implemented then reverted),
`defineZodModel-inline-indexes` (deferred; fold the `fieldPath()` idea into a roadmap note).

*Before deleting these, note three carry deferred-but-unbuilt ideas — now captured under
[`roadmap.md`](../roadmap.md) "Parked — may be obsolete" so nothing is lost:
`defineZodModel-inline-indexes` (`fieldPath()`), `type-aware-transforms` (type-aware as the
mini default), and `hotpot-unwraponce-migration` (traversal-primitive exports). All three are
likely superseded by later architecture changes, not merely un-started. Correction: the docs
crawl reported `unwrapOnce` as "shipped/exported" — that was a **false positive** (`grep` finds
no `unwrapOnce` in `src`; the `transform/` module that held it was removed).*

**Promote OUT of `archive/` into an active roadmap (live, unrealized):**
`archive/todo/`: `system-field-codecs`, `motiion-inspired-utilities` (trim 1766 → the Phase 1-3
API sketches), `opt-in-client-library-codegen`, `codegen-static-analysis`,
`example-project-validation-coverage`.

**Superpowers plans/specs:**
- Archive (done): plans `core-type-boundary`, `zod-mini-compat`, `source-organization-audit`,
  `stress-test-harness`, `slim-model-and-zx-helpers` (note Task 8 superseded by the harness);
  specs `full-mini-mode-design` (superseded), `zod-mini-compat-redesign` (keep only as
  build-time-alias rationale), `as-any-cast-remediation-design`.
- Keep (live/partial): plans `full-mini-architecture-refactor` (the function-contract compiler),
  `source-reorg-execution-plan` (Phase 6); specs `slim-model-and-zx-helpers-design` (governs
  current direction), `zx-codec-split-implementation` (canonical `zx` architecture),
  `filter-codec-encoding-design`, `readme-and-docs-restructure-design` (the docs contract),
  `core-type-boundary-enforcement` (union half).

**Decisions:** `form-resolver-naming.md` is archivable once the rename shipped; mark the dead
`onRead`/`onWrite` hook-API section of `runtime-only-middleware.md` as superseded (keep the principle).

### Loose ends (verified)
- `TODO.md` references `CLEANUP_AUDIT.md` — **confirmed dead pointer** (file does not exist); fix
  or drop the reference in `TODO.md`.
- `examples/stress-test/seeds/` (`models/`, `endpoints/`) — **present**; migration completed.
- `transform/` module — **removed** (no `internal/transform*`); the `as-any-cast-remediation`
  follow-up landed.

---

## 6. Suggested sequencing

1. **Fix the contradictions** (this branch): rewrite `CONTRIBUTING.md`; de-dup/cross-link the
   migration docs; fix the CHANGELOG links.
2. **Fill the gap:** write the rules-and-audit guide (v0.8-aware).
3. **Consolidate guides:** merge large-schemas, trim internals, align intros; refine `zx`
   framing to "codec + schema-helper namespace" everywhere.
4. **Roadmap pass:** create an active `docs/roadmap/` (or promote the five live archive TODOs),
   then do the archive deletions. Do pruning *after* the roadmap exists so no live idea is lost.
