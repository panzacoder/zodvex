# Migrate zodvex to `zod/v4/core` — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate zodvex's internal imports from `'zod'` to `'zod/v4/core'` so that zodvex works transparently with both `zod` (full) and `zod/mini`, per [Zod's library author guidance](https://zod.dev/library-authors?id=how-to-support-zod-4).

**Architecture:** zodvex currently imports `{ z } from 'zod'` in 37 source files and uses `z.ZodFoo` for ~131 `instanceof` checks plus schema construction (`z.object()`, `z.encode()`, etc.). The migration separates these two concerns:

1. **Type checking** (131 `instanceof` sites) — switch from `z.ZodFoo` to `$ZodFoo` from `zod/v4/core`. Both `zod` and `zod/mini` schemas are `instanceof` these shared base classes.
2. **Schema construction** (~25 files call `z.object()`, `z.string()`, etc.) — these cannot come from `zod/v4/core` (it doesn't export constructors). Instead, zodvex must accept schema instances from the user's chosen Zod variant, or use `zod/v4/core`'s standalone `parse`/`encode`/`decode` functions where zodvex calls those directly.

**Tech Stack:** TypeScript, Zod v4, `zod/v4/core`

**Spec:** `docs/superpowers/specs/2026-03-26-zod-v4-oom-mitigation-design.md` (Track B, now simplified)

---

## Why This Matters

Per [Zod's library author guidance](https://zod.dev/library-authors?id=how-to-support-zod-4):

> "If you reference classes from the `zod/v4` module, your library will not work with Zod Mini, and vice versa."

zodvex currently does exactly this — importing from `'zod'` (which resolves to `zod/v4`). This means:
- Users MUST use full `zod`, even if `zod/mini` would suffice
- `zod/mini` schemas have 4x fewer own properties (15 vs 61), which is the core OOM mitigation
- The fix is NOT a "mini entrypoint" — it's using the right import path so zodvex is variant-agnostic

## Key Mapping

| Current (zodvex) | Target (`zod/v4/core`) | Notes |
|---|---|---|
| `import { z } from 'zod'` | `import * as zc from 'zod/v4/core'` | For type checks only |
| `z.ZodType` | `zc.$ZodType` | Base type |
| `z.ZodTypeAny` | `zc.$ZodType` | No separate "Any" — `$ZodType` is already generic |
| `z.ZodObject` | `zc.$ZodObject` | |
| `z.ZodString` | `zc.$ZodString` | |
| `z.ZodNumber` | `zc.$ZodNumber` | |
| `z.ZodBoolean` | `zc.$ZodBoolean` | |
| `z.ZodOptional` | `zc.$ZodOptional` | |
| `z.ZodNullable` | `zc.$ZodNullable` | |
| `z.ZodDefault` | `zc.$ZodDefault` | |
| `z.ZodArray` | `zc.$ZodArray` | |
| `z.ZodUnion` | `zc.$ZodUnion` | |
| `z.ZodDiscriminatedUnion` | `zc.$ZodDiscriminatedUnion` | |
| `z.ZodEnum` | `zc.$ZodEnum` | |
| `z.ZodLiteral` | `zc.$ZodLiteral` | |
| `z.ZodRecord` | `zc.$ZodRecord` | |
| `z.ZodTuple` | `zc.$ZodTuple` | |
| `z.ZodLazy` | `zc.$ZodLazy` | |
| `z.ZodCustom` | `zc.$ZodCustom` | |
| `z.ZodCodec` | `zc.$ZodCodec` | |
| `z.ZodDate` | `zc.$ZodDate` | |
| `z.ZodNull` | `zc.$ZodNull` | |
| `z.ZodAny` | `zc.$ZodAny` | |
| `z.ZodUndefined` | `zc.$ZodUndefined` | |
| `z.ZodError` | `zc.$ZodError` | |
| `z.ZodNaN` | `zc.$ZodNaN` | |
| `z.ZodPipe` | `zc.$ZodPipe` | |
| `z.ZodTransform` | `zc.$ZodTransform` | |
| `z.parse(schema, data)` | `zc.parse(schema, data)` | Standalone function in core |
| `z.safeParse(schema, data)` | `zc.safeParse(schema, data)` | Standalone function in core |
| `z.encode(schema, data)` | `zc.encode(schema, data)` | Standalone function in core |
| `z.decode(schema, data)` | `zc.decode(schema, data)` | Standalone function in core |
| `schema.parse(data)` | `zc.parse(schema, data)` | Method → standalone |
| `z.object({...})` | **Cannot migrate** | Constructor — must come from user's `z` |
| `z.infer<T>` | `zc.infer<T>` | Type utility — available in core |
| `z.input<T>` | `zc.input<T>` | Type utility — available in core |
| `z.output<T>` | `zc.output<T>` | Type utility — available in core |

## Schema Construction Sites

These ~25 files call `z.object()`, `z.string()`, etc. to BUILD schemas (not just check them). These need case-by-case analysis:

| File | What it constructs | Strategy |
|---|---|---|
| `builders.ts` | `z.object(config.args)` — wraps raw shapes into ZodObject | Accept pre-built schemas or use core's constructor if available |
| `wrappers.ts` | Same as builders | Same |
| `custom.ts` | `z.object(maybeObject)` | Same |
| `utils.ts` | `z.object(...)` for pagination, `z.number()` for date conversion | These are zodvex-internal schemas — need a strategy |
| `zx.ts` | `z.number()`, `z.custom()`, `zx.codec()` — custom codec constructors | User-facing API — consumers pass their `z` |
| `model.ts` | `schema.optional()` | Method call on user schema — should work with both variants via core |
| `db.ts` | `z.union(fieldSchemas)` | Internal — needs strategy |
| `codegen/zodToSource.ts` | Uses `z.ZodFoo` for instanceof only | Pure migration |
| `codegen/generate.ts` | Constructs import statements | String generation, not runtime |

### Strategy for construction sites

**Option A (recommended): Import `z` from `zod/v4` as a dev/internal dependency for construction, `zod/v4/core` for type checking.**

This is what Zod's guidance implies: library code that needs to BUILD schemas imports from `zod/v4` (or accepts them from the user). Library code that needs to CHECK schemas imports from `zod/v4/core`. The key insight is that zodvex's internal schema construction (pagination helpers, date wrappers in `utils.ts`) is a small surface that can use `zod/v4` directly, while the 131 `instanceof` checks — which are what break mini compatibility — move to `zod/v4/core`.

**Result:** Users who pass `zod/mini` schemas into zodvex functions get correct `instanceof` checks. zodvex's own internal schemas (pagination, etc.) use full zod, which is fine since they're internal.

## Peer Dependency Change

```json
// Current
"peerDependencies": {
  "zod": "^4.3.6"
}

// After migration
"peerDependencies": {
  "zod": "^4.3.6"
}
```

No change needed — `zod/v4/core` is a subpath of the `zod` package, not a separate package. Both `zod` and `zod/mini` users install the `zod` package.

---

## File Inventory

### Files with ONLY `instanceof`/type checks (pure migration — no construction)

These files import `{ z } from 'zod'` but only use `z.ZodFoo` for `instanceof` checks or type annotations. They can switch entirely to `zod/v4/core`.

| File | instanceof count |
|---|---|
| `mapping/core.ts` | 21 |
| `codegen/zodToSource.ts` | 20 |
| `utils.ts` | 17 (also constructs — see below) |
| `wrappers.ts` | 11 (also constructs) |
| `codegen/discover.ts` | 8 |
| `normalizeCodecPaths.ts` | 7 |
| `mapping/handlers/record.ts` | 7 |
| `builders.ts` | 6 (also constructs) |
| `tables.ts` | 6 |
| `codegen/generate.ts` | 5 |
| `model.ts` | 4 (also constructs) |
| `custom.ts` | 3 (also constructs) |
| `db.ts` | 3 (also constructs) |
| `schemaHelpers.ts` | 3 |
| `codegen/extractCodec.ts` | 3 |
| `mapping/handlers/nullable.ts` | 2 |
| `codec.ts` | 2 |
| `serverUtils.ts` | 1 |
| `registry.ts` | 1 |
| `mapping/utils.ts` | 1 |

### Files with BOTH `instanceof` checks AND schema construction

These need dual imports: `zod/v4/core` for type checks, `zod/v4` (or internal helper) for construction.

- `builders.ts` — `z.object(config.args)` wrapping
- `wrappers.ts` — same pattern as builders
- `custom.ts` — `z.object(maybeObject)`
- `utils.ts` — `z.object()`, `z.number()`, `z.boolean()`, `z.string()`, `z.array()` for pagination and date helpers
- `model.ts` — `schema.optional()`
- `db.ts` — `z.union(fieldSchemas)`

### Files with only type annotations (no runtime `instanceof`)

These use `z.ZodTypeAny`, `z.infer<T>`, etc. as types only:
- `types.ts`, `mapping/types.ts`, `results.ts`, `boundaryHelpers.ts`, `transform/types.ts`, `transform/traverse.ts`

### Files that construct user-facing schemas

- `zx.ts` — `zx.date()`, `zx.id()`, `zx.codec()` — these use `z.number()`, `z.custom()`, `z.string()` to build schemas the user imports. These must continue to use full `zod/v4` constructors since the returned schemas need to be compatible with user code.

---

## Implementation Tasks

### Task 1: Add `zod/v4/core` import helper and type aliases

**Files:**
- Create: `packages/zodvex/src/zod-core.ts`

This central file re-exports what zodvex needs from `zod/v4/core`, providing a single migration point.

- [ ] **Step 1: Create the import helper**

```typescript
// packages/zodvex/src/zod-core.ts
// Central re-export of zod/v4/core types and functions.
// zodvex uses these for instanceof checks and standalone parse/encode operations.
// Schema CONSTRUCTION still uses 'zod' (full) — see zx.ts, utils.ts.
export {
  // Base types
  $ZodType,
  $ZodString,
  $ZodNumber,
  $ZodBoolean,
  $ZodBigInt,
  $ZodDate,
  $ZodNull,
  $ZodUndefined,
  $ZodAny,
  $ZodUnknown,
  $ZodNaN,
  $ZodVoid,
  $ZodNever,
  $ZodSymbol,

  // Compound types
  $ZodObject,
  $ZodArray,
  $ZodTuple,
  $ZodUnion,
  $ZodDiscriminatedUnion,
  $ZodEnum,
  $ZodLiteral,
  $ZodRecord,

  // Wrappers
  $ZodOptional,
  $ZodNullable,
  $ZodDefault,
  $ZodPrefault,
  $ZodNonOptional,
  $ZodReadonly,

  // Transform/pipe
  $ZodTransform,
  $ZodPipe,
  $ZodCodec,
  $ZodLazy,
  $ZodCustom,

  // Errors
  $ZodError,

  // Standalone parse/encode functions
  parse,
  safeParse,
  encode,
  decode,

  // Type utilities
  type infer,
  type input,
  type output,

  // Internals for advanced type checking
  type $ZodTypeDef,
  type $ZodTypeInternals,
} from 'zod/v4/core'
```

- [ ] **Step 2: Verify the import works**

Run: `cd packages/zodvex && echo 'import { $ZodObject } from "./src/zod-core"' | bun run --bun -`

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/src/zod-core.ts
git commit -m "feat: add zod/v4/core re-export module for mini compatibility"
```

---

### Task 2: Migrate pure-instanceof files (no schema construction)

**Files to modify:** `mapping/core.ts`, `codegen/zodToSource.ts`, `codegen/discover.ts`, `codegen/extractCodec.ts`, `codegen/generate.ts`, `normalizeCodecPaths.ts`, `mapping/handlers/record.ts`, `mapping/handlers/nullable.ts`, `mapping/utils.ts`, `tables.ts`, `schemaHelpers.ts`, `serverUtils.ts`, `registry.ts`, `codec.ts`

These files only use `z.ZodFoo` for `instanceof` and type annotations. The migration is mechanical:

1. Replace `import { z } from 'zod'` with `import { $ZodFoo, $ZodBar, ... } from '../zod-core'` (importing only what's used)
2. Replace `z.ZodFoo` with `$ZodFoo` in instanceof checks
3. Replace `z.ZodTypeAny` type annotations with `$ZodType`

Do this file-by-file, running `bun run type-check` after each file to catch issues.

- [ ] **Step 1: Migrate `mapping/core.ts`** (21 instanceof sites — largest file)

Pattern:
```typescript
// Before
import { z } from 'zod'
if (actualValidator instanceof z.ZodArray) { ... }

// After
import { $ZodArray, $ZodObject, ... } from '../../zod-core'
if (actualValidator instanceof $ZodArray) { ... }
```

- [ ] **Step 2: Run type-check**
Run: `bun run type-check`

- [ ] **Step 3: Migrate `codegen/zodToSource.ts`** (20 sites)
- [ ] **Step 4: Run type-check**
- [ ] **Step 5: Migrate `codegen/discover.ts`** (8 sites)
- [ ] **Step 6: Run type-check**
- [ ] **Step 7: Migrate `codegen/extractCodec.ts`** (3 sites)
- [ ] **Step 8: Migrate `codegen/generate.ts`** (5 sites)
- [ ] **Step 9: Run type-check**
- [ ] **Step 10: Migrate `normalizeCodecPaths.ts`** (7 sites)
- [ ] **Step 11: Migrate `mapping/handlers/record.ts`** (7 sites)
- [ ] **Step 12: Migrate `mapping/handlers/nullable.ts`** (2 sites)
- [ ] **Step 13: Migrate `mapping/utils.ts`** (1 site)
- [ ] **Step 14: Run type-check**
- [ ] **Step 15: Migrate `tables.ts`** (6 sites)
- [ ] **Step 16: Migrate `schemaHelpers.ts`** (3 sites)
- [ ] **Step 17: Migrate `serverUtils.ts`** (1 site)
- [ ] **Step 18: Migrate `registry.ts`** (1 site)
- [ ] **Step 19: Migrate `codec.ts`** (2 sites)
- [ ] **Step 20: Run type-check**
- [ ] **Step 21: Run full test suite**
Run: `bun run test`
- [ ] **Step 22: Commit**

```bash
git add packages/zodvex/src/
git commit -m "refactor: migrate pure-instanceof files to zod/v4/core"
```

---

### Task 3: Migrate dual-use files (instanceof + construction)

**Files:** `builders.ts`, `wrappers.ts`, `custom.ts`, `utils.ts`, `model.ts`, `db.ts`

These files need both imports:
- `zod/v4/core` (via `../zod-core`) for `instanceof` checks
- `'zod'` for schema construction (`z.object()`, `z.union()`, etc.)

The pattern:
```typescript
// Before
import { z } from 'zod'

// After
import { z } from 'zod'  // For schema construction (z.object, z.union, etc.)
import { $ZodObject, $ZodOptional, ... } from '../zod-core'  // For instanceof checks
```

Then replace `instanceof z.ZodFoo` with `instanceof $ZodFoo`, keeping `z.object(...)` calls as-is.

- [ ] **Step 1: Migrate `wrappers.ts`** (11 instanceof sites + construction)
- [ ] **Step 2: Migrate `builders.ts`** (6 instanceof + construction)
- [ ] **Step 3: Migrate `custom.ts`** (3 instanceof + construction)
- [ ] **Step 4: Run type-check**
- [ ] **Step 5: Migrate `utils.ts`** (17 instanceof + construction)
- [ ] **Step 6: Migrate `model.ts`** (4 instanceof + construction)
- [ ] **Step 7: Migrate `db.ts`** (3 instanceof + construction)
- [ ] **Step 8: Run type-check**
- [ ] **Step 9: Run full test suite**
Run: `bun run test`
- [ ] **Step 10: Commit**

```bash
git add packages/zodvex/src/
git commit -m "refactor: migrate dual-use files to zod/v4/core for instanceof checks"
```

---

### Task 4: Migrate type-only files

**Files:** `types.ts`, `mapping/types.ts`, `results.ts`, `boundaryHelpers.ts`, `transform/types.ts`, `transform/traverse.ts`

These only use `z.ZodTypeAny`, `z.infer<T>`, etc. as type annotations.

- [ ] **Step 1: Migrate all type-only files**

Replace `z.ZodTypeAny` with `$ZodType`, `z.infer<T>` with `zc.infer<T>`, etc.

- [ ] **Step 2: Run type-check**
- [ ] **Step 3: Run full test suite**
- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/src/
git commit -m "refactor: migrate type-only files to zod/v4/core"
```

---

### Task 5: Update `zx.ts` (user-facing API)

**File:** `packages/zodvex/src/zx.ts`

`zx.ts` constructs schemas that users import (`zx.date()`, `zx.id()`, `zx.codec()`). These use `z.number()`, `z.custom()`, `z.string()` etc. They must continue using `'zod'` constructors.

However, `zx.ts` may also have `instanceof` checks that should use `zod/v4/core`.

- [ ] **Step 1: Audit `zx.ts` for instanceof vs construction**
- [ ] **Step 2: Split imports if needed — keep `z` for construction, add core imports for checks**
- [ ] **Step 3: Run type-check and tests**
- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/src/zx.ts
git commit -m "refactor: update zx.ts imports for zod/v4/core compatibility"
```

---

### Task 6: Update exports and verify consumer API

**Files:**
- Modify: `packages/zodvex/src/core/index.ts`
- Modify: `packages/zodvex/src/server/index.ts`

Ensure the public API surface still works. The `zod-core.ts` module should NOT be exported to consumers — it's internal.

- [ ] **Step 1: Verify `zod-core.ts` is not re-exported from any public entrypoint**
- [ ] **Step 2: Run type-check**
- [ ] **Step 3: Run full test suite**

Run: `bun run test`

- [ ] **Step 4: Verify the example project still works**

```bash
cd examples/task-manager && bun run test
```

- [ ] **Step 5: Commit if any changes needed**

---

### Task 7: Add zod-mini compatibility test

**Files:**
- Create: `packages/zodvex/__tests__/zod-mini-compat.test.ts`

Write a test that imports schemas from `zod/mini` and passes them through zodvex's core functions (mapping, codec, etc.) to verify they work.

- [ ] **Step 1: Write compatibility test**

```typescript
import { describe, expect, it } from 'vitest'
import { z as zm } from 'zod/mini'
import { zodToConvex } from '../src/mapping/core'

describe('zod-mini compatibility', () => {
  it('maps a mini string schema to convex', () => {
    const result = zodToConvex(zm.string())
    expect(result).toBeDefined()
  })

  it('maps a mini object schema to convex', () => {
    const schema = zm.object({
      name: zm.string(),
      age: zm.number(),
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini optional to convex optional', () => {
    const schema = zm.object({
      name: zm.string(),
      nickname: zm.optional(zm.string()),
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini nullable to convex union with null', () => {
    const schema = zm.object({
      name: zm.string(),
      bio: zm.nullable(zm.string()),
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini array to convex array', () => {
    const schema = zm.array(zm.string())
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini enum to convex', () => {
    const schema = zm.enum(['a', 'b', 'c'])
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test — expect FAILURES before migration**

Run: `bun run test -- packages/zodvex/__tests__/zod-mini-compat.test.ts`

This should fail with the current `z.ZodFoo` instanceof checks. The failures confirm the problem.

- [ ] **Step 3: Run again AFTER migration — expect PASSES**

If the migration is complete, these should pass. If any fail, they point to remaining `z.ZodFoo` references.

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/__tests__/zod-mini-compat.test.ts
git commit -m "test: add zod-mini compatibility tests for instanceof migration"
```

---

### Task 8: Update stress-test to measure zod-mini after migration

Once the migration is complete, re-run the stress test with `--variant=zod-mini` to get real measurements.

- [ ] **Step 1: Generate and measure zod-mini at 200 endpoints**

```bash
cd examples/stress-test
bun run generate.ts --count=200 --mode=both --variant=zod-mini
bun --expose-gc run measure.ts --count=200 --mode=both --variant=zod-mini
```

- [ ] **Step 2: Test against Convex isolate**

```bash
bun run generate.ts --count=200 --mode=both --variant=zod-mini
npx convex dev --once
```

If the 4x property count reduction holds, 200 endpoints should use ~18MB instead of 73MB — well within the 64MB limit.

- [ ] **Step 3: Update results/report.md with zod-mini findings**
- [ ] **Step 4: Commit**

```bash
git add examples/stress-test/results/
git commit -m "docs(stress-test): add zod-mini measurement results after core migration"
```

---

## Risks and Open Questions

1. **`schema.optional()` method calls** — `zod/mini` schemas may not have `.optional()` as a method. zodvex calls this in `model.ts`. If mini doesn't have it, we need `zc.$ZodOptional` constructor or a wrapper. Check during Task 3.

2. **`z.object()` in builders/wrappers** — These wrap user-provided raw shapes into `ZodObject`. If a user passes a raw shape `{ name: zm.string() }`, zodvex calls `z.object(shape)` which creates a full-zod object wrapping mini schemas. This should work since `z.object()` accepts any values, but needs verification.

3. **Type inference** — `z.infer<T>` and `zc.infer<T>` should produce the same types for the same schema structure, but generics may need adjustment if zodvex constrains to `z.ZodTypeAny` vs `$ZodType`.

4. **codegen output** — Generated code (`_zodvex/api.ts` etc.) imports from `zodvex/core` which re-exports from `zod`. If a user uses `zod/mini`, the generated code's `z.encode()` calls need to work. This may require codegen to use `zod/v4/core`'s standalone `encode()` instead of `z.encode()`.
