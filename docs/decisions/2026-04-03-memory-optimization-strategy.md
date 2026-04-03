# Decision: Memory Optimization Strategy for Convex Deployments

**Date:** 2026-04-03
**Status:** In Progress
**Context:** Consumer complaints about Zod overhead in Convex deploys; confirmed via stress testing that full Zod v4 hits the 64MB V8 isolate limit at ~190 endpoints.

---

## Problem

Convex runs all queries, mutations, and default-runtime actions in a single V8 isolate with a **64MB memory limit**. All modules are loaded eagerly — no per-function isolation, no lazy loading. Zod schema instances dominate memory:

| Endpoints | Full Zod | zod/mini | Savings |
|-----------|----------|----------|---------|
| 50        | 19.5 MB  | 11.4 MB  | 42%     |
| 100       | 35.6 MB  | 19.2 MB  | 46%     |
| 200       | 67.3 MB  | 34.4 MB  | 49%     |
| 250       | 82.9 MB  | 42.0 MB  | 49%     |

Convex validators themselves are negligible (~0.5 MB at 250 endpoints). Nearly all memory is Zod schema instances (~61 own properties per `z.object()` vs ~15 for `zm.object()`).

## Solutions (Not Mutually Exclusive)

### S1: Full zod/mini Compatibility (**~95% complete**)

**What:** Ensure zodvex works identically with both `zod` and `zod/mini`.

**Status:** zodvex internals already use functional forms and `$ZodType` from `zod/v4/core`. Build-time aliasing via tsup rewrites `'zod'` → `'zod/mini'` in the `zodvex/mini` entrypoint. Missing: test dual-run (depends on S2).

**Impact:** 49% memory reduction. OOM threshold moves from ~190 to ~400 endpoints. Requires consumers to **rewrite their code** to use mini syntax.

**Decision:** Keep. This is the foundation.

### S2: Compile Full-Zod to zod/mini at Build Time (**next step**)

**What:** A vite/unplugin that transforms full-zod method chains to mini functional equivalents at module load time. Same source code runs under both variants.

**Serves two audiences:**
1. zodvex's own test suite (run 872 tests under both zod and zod/mini without maintaining two codebases)
2. Consumer-facing tool (users write full-zod, deploy with mini, get 49% savings transparently)

**Existing work:** `packages/zod-to-mini/` — ts-morph AST codemod with 42 passing unit tests covering all transform categories (wrappers, checks, methods, class refs, imports). Proven correct.

**Implementation approach for the plugin:**
- ts-morph is too heavy for per-module vite transforms (confirmed by research — no existing vite plugins use it)
- Best options: (a) oxc-parser + magic-string, (b) ts-morph with caching/warm project, (c) Babel visitor
- Ship as unplugin for portability beyond Vite
- The existing codemod proves correctness; the plugin re-implements the same transforms with a faster engine

**Key API surface to transform:**

| Full zod (method)         | zod/mini (standalone)                |
|---------------------------|--------------------------------------|
| `schema.optional()`       | `z.optional(schema)`                 |
| `schema.nullable()`       | `z.nullable(schema)`                 |
| `schema.describe(str)`    | `z.describe(schema, str)`            |
| `schema.transform(fn)`    | `z.pipe(schema, z.transform(fn))`    |
| `schema.pipe(other)`      | `z.pipe(schema, other)`              |
| `schema.refine(fn, opts)` | `schema.check(z.refine(fn, opts))`   |
| `schema.default(val)`     | `z._default(schema, val)`            |
| `schema.partial()`        | `z.partial(schema)`                  |
| `schema.extend(shape)`    | `z.extend(schema, shape)`            |
| `schema.pick(keys)`       | `z.pick(schema, keys)`               |
| `schema.omit(keys)`       | `z.omit(schema, keys)`               |
| `schema.catchall(s)`      | `z.catchall(schema, s)`              |
| `z.string().email()`      | `z.string().check(z.email())`        |
| `z.string().min(n)`       | `z.string().check(z.minLength(n))`   |
| `z.number().min(n)`       | `z.number().check(z.gte(n))`         |

Note: The standalone functions (z.partial, z.extend, z.pick, etc.) only exist in zod/mini. The method forms only exist in full zod. No single syntax works in both — this is why compile-time transformation is necessary.

**Decision:** Build this next. Start with a vite plugin for the test suite, then generalize to unplugin for consumers.

### S3: Compile Away Zod Entirely (**aspirational**)

**What:** Eliminate Zod from the Convex runtime entirely. Ship only `v.*` validators + compiled codec functions.

**Natural path:** Extend `zodvex generate` to emit Zod-free runtime code:
- Pre-computed `v.*` validators (already done by the mapping layer)
- Compiled codec transforms (the hard part — user-authored functions need serialization)
- TypeScript types (compile-time only, zero runtime cost)

**Challenges:**
- Codec transforms are user-authored closures (`z.pipe(schema, z.transform(v => new Date(v)))`). Serializing arbitrary functions to standalone JS is undecidable in general.
- zod-aot (the only existing AOT Zod compiler) explicitly punts on this — transforms, refines, and closures fall back to Zod at runtime via `Object.create(originalSchema)`.
- libar-dev/zod-convex-packages claims "zero Zod at runtime" but their codec system (`fromConvexJS`, `toConvexJS`) is built entirely on `instanceof z.*` checks and `z.safeParse()` — Zod is back at runtime the moment you use codecs.

**Feasible scope:** Handle the common cases (Date <-> timestamp, field mapping, simple coercions) via pattern matching at codegen time. Fall back to mini for complex codecs. This hybrid would eliminate Zod for most endpoints while keeping a minimal footprint for codec-heavy ones.

**Decision:** Defer. S2 provides 49% savings which covers most real-world projects (~400 endpoint ceiling). Revisit if consumers hit limits beyond that.

### S4: Hybrid — Eager Validators, Lazy Zod for Codecs (**exploratory**)

**What:** Ship pre-computed `v.*` validators eagerly (zero Zod at module load). Only `import('zod/mini')` dynamically when a codec encode/decode is first triggered.

**Rationale:** Many endpoints don't use codecs at all. For those, Zod is pure overhead — it was only needed to derive the `v.*` validators, which `zodvex generate` already emits statically.

**How it would work:**
1. `zodvex generate` emits `v.*` validators directly (no Zod import in generated files)
2. The codec registry stores codec definitions as lazy thunks
3. On first DB read/write for a codec-enabled model, the thunk executes, importing mini and creating the schema
4. Functions without codecs never touch Zod

**Impact:** Depends on codec density. For a project where 30% of endpoints use codecs, baseline memory drops by ~70% (only codec endpoints pay the Zod cost).

**Decision:** Interesting but exploratory. Would require rethinking how `initZodvex` bootstraps. Park for now; revisit after S2 ships.

## Competitive Landscape

### zod-aot (wakita181009)
- AOT-compiles `.parse()` calls into flat boolean-chain validators
- Does NOT eliminate Zod from runtime (uses `Object.create(originalSchema)` for API compat)
- Targets parse **performance**, not memory reduction
- Zod v4 only, unplugin-based, ~1 month old (52 releases, 9 stars)
- Not relevant to our memory problem, but interesting for parse perf if needed later

### libar-dev/zod-convex-packages
- 7-package monorepo, codegen-first architecture
- Claims "zero Zod at runtime" — **only true for arg/return validators**
- Codec system (`fromConvexJS`, `toConvexJS`) requires Zod at runtime (instanceof checks, safeParse)
- Claims 40-50MB Zod runtime — unsubstantiated, likely conflates tsc depth limits with V8 memory
- 0 stars, 3 commits (all same day), appears AI-generated
- Does NOT do DB-level codec wrapping (zodvex's key differentiator)
- Lossy transform handling: `z.transform()` → `v.any()` (function discarded)
- No zod/mini compatibility (uses `instanceof z.ZodObject` not `$ZodType` from core)
- **Interesting ideas worth noting:**
  - TS2589 depth extraction (pulling deeply nested validators into named constants)
  - ESLint plugin to enforce "no runtime Zod in convex/" (useful governance tool)

### Convex ecosystem
- No official guidance from Convex team on Zod memory
- `convex-helpers/server/zodV4` does nothing to minimize memory footprint
- The Convex team ships Zod at runtime in their own helpers, suggesting they don't consider it a blocker for typical projects
- 64MB limit is hard and platform-level — no escape hatch available

## Summary

| Solution | Effort | Impact | Status |
|----------|--------|--------|--------|
| S1: Mini compat | Low | 49% savings (opt-in) | ~Done |
| S2: Compile to mini | Medium | 49% savings (transparent) | **Next** |
| S3: Compile away Zod | High | ~100% savings (complex codecs excluded) | Deferred |
| S4: Lazy Zod for codecs | Medium | Variable (depends on codec density) | Exploratory |

The strategy is sequential: S1 (done) → S2 (next) → S3/S4 (if needed). Each step builds on the previous — S2's transform infrastructure directly enables S3.
