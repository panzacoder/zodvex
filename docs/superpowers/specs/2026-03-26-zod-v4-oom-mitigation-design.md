# Zod v4 OOM Mitigation Design

**Date:** 2026-03-26
**Issue:** [panzacoder/zodvex#49](https://github.com/panzacoder/zodvex/issues/49)
**Upstream:** [get-convex/convex-backend#414](https://github.com/get-convex/convex-backend/issues/414)

## Problem

Zod v4 allocates ~91 own properties per schema instance (vs ~20 in v3), resulting in ~13x higher heap usage per schema. Large Convex projects with 180+ endpoints blow past the 64MB isolate memory limit during module initialization. The Convex team has been unable to reproduce and is requesting a minimal repro.

zodvex creates all Zod schemas eagerly at module load time — every `defineZodModel`, `zodTable`, and function wrapper instantiates its full Zod schema tree when the module is imported. Critically, `defineZodSchema()` iterates over all table entries and builds the `zodTableMap` eagerly, calling through to `zodToConvex` for each table. This is likely the single largest allocation site, as it instantiates every table's doc/insert/update/base schemas at import time. This directly contributes to the memory spike during `npx convex dev`.

## Goals

1. Unblock zodvex users hitting the 64MB wall (ship a practical mitigation)
2. Produce a reproducible stress test the Convex and Zod teams can use
3. Establish whether lazy loading, `zod-mini`, or both are effective mitigations
4. Contribute findings upstream

## Non-Goals

- Backporting to Zod v3 (zodvex's mapping and codec layers are fundamentally v4)
- Fixing the Convex isolate memory limit (upstream concern)
- Fixing Zod v4's per-schema memory allocation (upstream concern, but we'll contribute data)

## Design

### Phase 0: Stress-Test Repro & Measurement Harness

A new `examples/stress-test/` project that empirically determines where the 64MB wall is and which mitigations work.

#### Generator Script

A script (`examples/stress-test/generate.ts`) that stamps out N Convex modules from templates:

- Each module contains a zodvex model definition + query and mutation endpoints. Critically, the generator must produce **both table definitions and function registrations** as separate allocation sites, since `defineZodSchema` (table schemas) and function wrappers (`zQuery`/`zMutation`/`zCustomQuery` etc.) both create `z.object()` trees eagerly at module load. The generator should support running with tables-only, functions-only, or both, so Phase 0 can isolate which allocation path dominates.
- Schemas use three complexity tiers to model real-world usage:
  - **Small** — 3-5 fields, simple types (string, number, boolean, optional)
  - **Medium** — 8-12 fields, nested objects, optional/nullable, codecs (`zx.date()`, `zx.id()`)
  - **Large** — 15-20 fields, nested unions, discriminated unions, arrays of objects, multiple codecs
  - Distribution: ~50% small, ~35% medium, ~15% large (models typical project shape)
- Configurable scale: 50, 100, 150, 200, 250 endpoints
- Generates three variants of the same modules:
  - **`zod` (baseline)** — current eager schema creation with full `zod`
  - **`zod-mini`** — same schemas rewritten for `zod/mini`'s API surface
  - **`lazy`** — schemas wrapped in thunks, deferred until first access

#### Measurement

**Methodology:** Use `v8.getHeapStatistics()` snapshots before and after module initialization (not `process.memoryUsage()`, which is misleading due to GC timing). Force GC with `--expose-gc` before each snapshot for consistency.

**Baselines to establish first:**
- Cost of `import { z } from 'zod'` alone (zero user schemas) — establishes Zod's own initialization overhead
- Cost of `import { z } from 'zod/mini'` alone — same for mini
- These baselines determine the floor; if Zod's own module init is already large, lazy user schemas won't save much

**Per-variant measurements:**
- V8 heap delta during module initialization (standalone, outside Convex)
- `npx convex dev` success/failure against the 64MB limit (requires a Convex project)
- Schema count, module count, total Zod instances created

**Success criteria:** 200 endpoints with realistic schemas (mixed small/medium/large) must complete `npx convex dev` within the 64MB isolate limit.

Outputs a report: scale point × variant → heap MB, pass/fail

#### Deliverables

- `examples/stress-test/` — the generated project (gitignored output, checked-in generator + templates). For upstream sharing, we can extract the standalone repro into a separate repo or gist — but development happens here in the monorepo.
- A markdown report with measurements
- A minimal repro suitable for posting on get-convex/convex-backend#414

### Phase 1: Mitigations in zodvex

Which track(s) we ship depends entirely on Phase 0 measurements. Both may be needed.

#### Track A: Lazy Schema Creation

Change zodvex internals to defer Zod schema construction while keeping Convex validators eager.

**How it works:**

**Two allocation sites must be lazified, not just one:**

1. **Table schemas (`defineZodSchema` → `defineZodModel`/`zodTable`):** `defineZodSchema` eagerly iterates all tables and calls `zodToConvex` for each, building doc/insert/update/base Zod schemas. These accept both shapes and thunks: `defineZodModel('tasks', fields)` and `defineZodModel('tasks', () => fields)`. Internally, even eager-form shapes are wrapped — the Zod `z.object()` tree is not constructed until first access.

2. **Function wrappers (`zQuery`/`zMutation`/`zAction`, `zCustomQuery`/`zCustomMutation`/`zCustomAction`):** These also create `z.object()` wrappers and call `zodToConvex` at module load time (see `wrappers.ts:74`, `custom.ts:191`, `builders.ts:64`). A table-only fix can still miss the 200-endpoint target if function registration is the dominant allocation path — which is plausible since endpoint count scales faster than table count. **Deferral mechanism for functions:** The wrappers currently accept a pre-built `ZodType` or shape object as `args` and eagerly call `zodToConvex(args)` to produce Convex validators for Convex's function registration. To defer: the wrapper stores the Zod args/returns schemas but delays `z.object()` wrapping and `zodToConvex` calls until the handler is first invoked. Convex function registration only needs the Convex validator (lightweight), so the wrapper must still produce that eagerly — but without constructing the full Zod tree. This requires the same "shape descriptor → Convex validator" path described for tables.

**Both paths need deferral:**
- Convex validators (`v.object()`, `v.string()`, etc.) are still created eagerly — Convex needs these at schema registration time and they are lightweight. **However, this assumption must be validated.** Today, both table registration and function registration recurse through schemas to build Convex validators via `zodToConvex`, which requires live Zod instances. If the Convex validators themselves retain significant memory (or if the `zodToConvex` mapping process is the expensive part rather than the Zod schemas it reads), lazy loading alone won't help. Phase 0 must include a **Convex-validator-only baseline**: measure the cost of creating equivalent `v.object()`/`v.string()`/etc. trees directly (without Zod) at the same scale points to isolate whether the cost is in Zod schema creation, Convex validator creation, or the mapping between them.
- The mapping layer (`zodToConvex`) needs a mode that can produce Convex validators from a schema descriptor without fully instantiating the Zod tree. This may require extracting a "shape descriptor" intermediate representation.
- **Codegen interaction:** The codegen system (`src/codegen/`) walks Zod schemas for discovery. If schemas become lazy, codegen must force-resolve them. This is acceptable since codegen runs as a build step, not at runtime in the isolate.

**Key risks:**
- If `npx convex dev` imports all modules and touches Zod schemas during push (not just Convex validators), lazy loading buys nothing. Phase 0 will determine this.
- `convex-helpers/server/customFunctions` may expect live schemas at registration time. Phase 0 should verify this interaction.

**API impact:** The thunk overload is additive. Existing code continues to work. Internal lazy wrapping is transparent.

#### Track B: zod-mini Entrypoint

If Phase 0 shows `zod/mini` has a meaningfully smaller memory footprint per schema:

- **Mirrored subpath exports.** zodvex currently exposes `.`, `./core`, `./server`, `./transform`, `./codegen`, `./react`, `./client`, and `./form/mantine`. A single `zodvex/mini` entrypoint is insufficient — the mini variant needs mirrored subpaths (`zodvex/mini/core`, `zodvex/mini/server`, etc.) or an alternative strategy (e.g., a build-time flag that swaps the Zod import across all subpaths). Codegen (`src/codegen/generate.ts`) hardcodes imports to `zodvex/core`, `zodvex/server`, `zodvex/react`, and `zodvex/client` — these must emit the correct mini paths when the project uses mini.
- No new peer dependency needed — `zod/mini` ships inside the `zod` package
- **The compatibility surface is larger than the mapping layer.** While `zodToConvexInternal` dispatches primarily on `def.type` (which may work with mini), `instanceof z.*` checks are used pervasively across the codebase — not just in mapping, but in wrappers (`wrappers.ts`), builders (`builders.ts`), schema helpers (`schemaHelpers.ts`), codegen discovery (`codegen/discover.ts`), codec path normalization (`normalizeCodecPaths.ts`), utils, and more (~100 `instanceof z.*` call sites total). The feasibility spike must assess whether `zod-mini` exports the same class hierarchy or whether a codebase-wide migration to `def.type`-based dispatch is required.
- Custom types (`zx.date()`, `zx.id()`, `zx.codec()`) need mini-compatible implementations
- Users opt in by changing their import paths across all subpaths

**Key risks:**
- If `zod-mini` schemas share the same underlying `$ZodType` base class with 91 properties, this doesn't help. Phase 0 will determine this.
- The effort for Track B is substantial — potentially a codebase-wide refactor of type detection, not just a mapping adapter. Phase 0 should include a feasibility spike that surveys all ~100 `instanceof` sites, not just the mapping layer.

**API impact:** New mirrored entrypoints. Users must adjust imports across all subpaths. Schema definitions may need minor changes if they use full-Zod-only APIs (`.email()`, `.url()`, etc.). Migration sketch:
- `import { z } from 'zod'` → `import { z } from 'zod/mini'`
- `import { ... } from 'zodvex/core'` → `import { ... } from 'zodvex/mini/core'` (and similarly for `/server`, `/react`, etc.)
- `.email()` → `.check(z.email())` (mini uses explicit checks)
- `zx.*` custom types — TBD based on Phase 0 feasibility
- Codegen output must respect the mini variant when generating imports

#### Decision Matrix

| Phase 0 Finding | Action |
|---|---|
| Lazy loading drops memory below 64MB | Ship Track A; Track B is nice-to-have |
| `zod-mini` drops memory; lazy doesn't | Ship Track B; skip Track A |
| Both help | Ship both; recommend mini for large projects |
| Neither helps | Document endpoint-count limits, recommend splitting Convex deployments, focus on upstream contributions; the repro is still valuable |

### Phase 2: Upstream Contributions

1. **Convex team** — Post the stress-test repo on get-convex/convex-backend#414 as the minimal repro. Include memory measurements at each scale point. The Convex team has explicitly requested this.
2. **Zod team** — File or contribute to existing issues (zod#5760, #5204, #5490) with concrete per-schema memory measurements and before/after data if `zod-mini` sidesteps the problem.
3. **zodvex#49** — Reply to dan-myles with findings, what we shipped, and interim workarounds.

## Testing Strategy

**Phase 0 (stress test is itself a test):**
- The stress-test project validates mitigations empirically at scale
- Convex-validator-only baseline isolates allocation attribution

**Track A (lazy schema creation):**
- Unit tests: verify Zod schemas are not instantiated at import time, only on first access — for both table definitions and function wrappers
- Unit tests: verify codegen discovery can force-resolve lazy schemas and produces correct output
- Integration test: the stress-test project at 200+ endpoints passes `npx convex dev` with lazy loading applied

**Track B (zod-mini entrypoint):**
- Unit tests: verify mapping produces identical Convex validators from `zod-mini` schemas
- Unit tests: codegen emits correct mini import paths (`zodvex/mini/core`, `zodvex/mini/server`, etc.) when configured for mini
- Unit tests: codegen discovery works against `zod-mini` schema types (the `instanceof`-based walker must handle mini's class hierarchy)
- Package tests: verify all mirrored subpath exports resolve correctly (every `zodvex/mini/*` path maps to a valid module)
- Integration test: the stress-test project at 200+ endpoints passes `npx convex dev` with mini variant

## Phase 0 → Phase 1 Gate

After Phase 0 measurements are collected, write a brief decision document before starting Phase 1 implementation. This prevents committing to a track while measurements are ambiguous. The decision doc should include: which tracks to pursue, effort estimates for each, and the expected memory improvement.

## Open Questions

1. Does `npx convex dev` touch Zod schemas during push, or only the Convex validators? (Phase 0 will answer)
2. What is `zod-mini`'s actual per-schema property count and heap footprint? (Phase 0 will answer)
3. Can `zodToConvex` produce validators from a descriptor without instantiating Zod? (Phase 0 spike)
4. Are there `zod-mini` API gaps that would prevent zodvex's codec layer from working? (Phase 0 spike)
5. What is the cost of `import { z } from 'zod'` alone (zero user schemas)? If Zod's module init itself is large, lazy user schemas won't save much. (Phase 0 baseline)
6. Can zodvex's ~100 `instanceof z.*` call sites (spread across mapping, wrappers, builders, schemaHelpers, codegen, utils) work with `zod-mini` types, or is a codebase-wide migration to `def.type`-based dispatch required? (Phase 0 spike)
7. Does `defineZodSchema`'s eager iteration of all tables force Zod instantiation even if individual models are lazy? (Phase 0 spike)
8. Which allocation path dominates: table schema registration or function endpoint registration? (Phase 0 measurement — the generator's tables-only vs functions-only mode will answer this)
9. Should Track B use mirrored subpaths (`zodvex/mini/core`, etc.) or a build-time flag that swaps Zod imports across all existing subpaths? (Phase 1 design question)
10. How much memory do Convex validators (`v.object()`, `v.string()`, etc.) themselves consume at scale? If significant, lazy Zod alone won't solve the problem. (Phase 0 Convex-validator-only baseline)
