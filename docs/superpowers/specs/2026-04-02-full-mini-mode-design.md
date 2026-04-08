# Full zod/mini Mode — Design Spec

## Problem

zodvex hardcodes `import { z } from 'zod'` in 14 source files with ~50 runtime construction calls (`z.object()`, `z.array()`, `z.string()`, etc.). Even when a consumer uses `zod/mini`, zodvex pulls full `zod` into the bundle and constructs full-weight schema instances internally (61 own properties per `z.object()` vs 15 for `zm.object()`).

This means:
- `zod` is always in the bundle, regardless of the consumer's choice
- Internal schemas (doc, insert, update, docArray, paginatedDoc) are always full-weight
- The stress test shows only 16-18% memory savings from mini because zodvex's internal schemas are still full zod

## Goal

When a consumer imports from `zodvex/mini`, ALL internal schema construction should use `zod/mini`. No `import { z } from 'zod'` should appear in the dependency graph. The consumer's entrypoint choice (`zodvex/core` vs `zodvex/mini`) is the single configuration point.

## Verified: zod/mini has the full construction API

All construction functions zodvex needs are available in `zod/mini`:

| Function | Available | Notes |
|----------|-----------|-------|
| `z.object()` | YES | |
| `z.array()` | YES | |
| `z.string()` | YES | |
| `z.number()` | YES | |
| `z.boolean()` | YES | |
| `z.enum()` | YES | |
| `z.literal()` | YES | |
| `z.null()` | YES | |
| `z.union()` | YES | |
| `z.discriminatedUnion()` | YES | |
| `z.any()` | YES | |
| `z.record()` | YES | |
| `z.custom()` | YES | |
| `z.codec()` | YES | |
| `z.optional()` | YES | functional form |
| `z.nullable()` | YES | functional form |
| `z.safeParse()` | YES | |
| `z.encode()` | YES | |

**Not available in mini** (method chaining): `.optional()`, `.nullable()`, `.refine()`, `.describe()`, `.array()`. zodvex must use functional forms for these.

## Design: Entrypoint-as-injection

### The consumer's import IS the configuration

```ts
// Full zod consumer (default, backwards compatible)
import { defineZodModel, zx } from 'zodvex/core'

// Mini consumer (all internal construction uses zod/mini)
import { defineZodModel, zx } from 'zodvex/mini'
```

No config file. No second init step. No DI parameter.

### Implementation: `zod-factory.ts`

Replace the existing `zod-core.ts` (which re-exports core types/classes for instanceof checks) with an expanded module that also provides the construction namespace:

```ts
// src/zod-factory.ts
import type { z as ZodNamespace } from 'zod'

// Core types for instanceof checks (unchanged from zod-core.ts)
export { $ZodObject, $ZodOptional, $ZodType, ... } from 'zod/v4/core'

// Runtime utilities from core (unchanged)
export { parse, safeParse, encode, decode, clone } from 'zod/v4/core'

// The swappable construction namespace
let _z: typeof ZodNamespace | undefined

export function setZodFactory(z: typeof ZodNamespace): void {
  _z = z
}

export function getZ(): typeof ZodNamespace {
  if (!_z) {
    // Lazy default: import full zod (backwards compatible)
    // This dynamic import is resolved at build time by tsup since
    // 'zod' is an external dependency — it just becomes a runtime require.
    throw new Error(
      'zodvex: No Zod namespace configured. Import from zodvex/core or zodvex/mini before using zodvex APIs.'
    )
  }
  return _z
}
```

**Open question:** Should `getZ()` throw or lazy-default to full zod? Throwing forces explicit entrypoint choice. Lazy-defaulting is backwards compatible but means `zod` might still end up in the bundle. Recommendation: **lazy-default to full zod** for backwards compat, with a future major version that throws.

### Entrypoint wiring

```ts
// src/core/index.ts
import { z } from 'zod'
import { setZodFactory } from '../zod-factory'
setZodFactory(z)
export * from '../core-exports'  // existing re-exports
```

```ts
// src/mini/index.ts
import { z } from 'zod/mini'
import { setZodFactory } from '../zod-factory'
setZodFactory(z)
export * from '../mini-exports'  // existing re-exports with mini-typed zx
```

The `setZodFactory()` call runs at module load time — before any `defineZodModel()` or `initZodvex()` can execute, because those are imported from the same entrypoint.

### Internal migration

Every file that currently does `import { z } from 'zod'` for construction changes to:

```ts
import { getZ } from './zod-factory'

// At each call site:
const z = getZ()
z.object({ ... })
```

Or, for files with many calls, a module-level lazy getter:

```ts
import { getZ } from './zod-factory'

// ... later in functions:
function buildSchema() {
  const z = getZ()
  return z.object({ ... })
}
```

### Chaining elimination

14 files use chaining that doesn't exist in mini. These must be converted to functional form:

| Current | Replacement |
|---------|-------------|
| `z.string().optional()` | `z.optional(z.string())` |
| `z.number().nullable()` | `z.nullable(z.number())` |
| `z.string().refine(fn).describe(str)` | `z.refine(z.string(), fn)` + `z.describe(schema, str)` — or use `z.check()` |
| `schema.nullable()` | `z.nullable(schema)` |

The `.refine()` and `.describe()` usages are concentrated in `ids.ts` (for `zx.id()`) and `zx.ts` (for `zx.date()`). These need special attention since `z.refine()` is a functional form in mini but `.describe()` becomes `z.describe(schema, str)`.

## File-by-file scope

### Must migrate (14 files with runtime `z` construction)

| File | Construction calls | Chaining to eliminate |
|------|-------------------|---------------------|
| `model.ts` | `z.object`, `z.number`, `z.array`, `z.boolean`, `z.string` | `.nullable()`, `.optional()` |
| `tables.ts` | `z.object`, `z.number`, `z.array`, `z.boolean`, `z.string`, `z.union`, `z.null` | `.nullable()`, `.optional()` |
| `utils.ts` | `z.object`, `z.number`, `z.array`, `z.boolean`, `z.string` | `.nullable()`, `.optional()` |
| `results.ts` | `z.discriminatedUnion`, `z.object`, `z.literal`, `z.array`, `z.record`, `z.string` | none |
| `schemaHelpers.ts` | `z.union`, `z.number` | none |
| `builders.ts` | `z.object` | none |
| `wrappers.ts` | `z.object` | none |
| `custom.ts` | `z.object` | none |
| `ids.ts` | `z.string` | `.refine()`, `.describe()` |
| `zx.ts` | `z.custom`, `z.string` (via zodvexCodec) | `.refine()`, `.describe()` |
| `codec.ts` | `z.codec` | none |
| `registry.ts` | `z.union` | none |
| `rules.ts` | `z.any` | none |
| `db.ts` | `z.union` | none |

### Can convert to `import type` (3 files)

- `boundaryHelpers.ts` — only `z.ZodError` type reference
- `serverUtils.ts` — only type references
- `form/mantine/index.ts` — uses `z.safeParse()` (available from core as `safeParse()`)

### Type-only files (already safe)

- `types.ts`, `schema.ts`, `init.ts` — already use `import type { z } from 'zod'`

### Codegen (special case)

- `codegen/generate.ts` — emits `import { z } from 'zod'` as a string in generated code. This should emit the consumer's import path. The codegen already knows whether the consumer uses mini (from the schema config or a flag).

## Chaining audit

Specific chaining patterns that must be eliminated across all 14 files:

| Pattern | Occurrences | Replacement |
|---------|------------|-------------|
| `.optional()` | ~15 | `z.optional(expr)` |
| `.nullable()` | ~8 | `z.nullable(expr)` |
| `.refine(fn, msg)` | 2 (ids.ts, zx.ts) | `z.refine(schema, fn)` or `z.check(schema, check)` |
| `.describe(str)` | 2 (ids.ts, zx.ts) | `z.describe(schema, str)` — verify this exists in mini |

## Edge cases

### Import ordering

`zodvex/server` imports from internal modules that call `getZ()`. If someone imports `zodvex/server` without first importing `zodvex/core` or `zodvex/mini`, `getZ()` needs to either:
1. Throw with a clear error message
2. Lazy-default to full zod

Recommendation: default to full zod for backwards compat (consumers who `import { initZodvex } from 'zodvex/server'` without `zodvex/core` should keep working).

Implementation: `getZ()` does a synchronous `require('zod')` fallback if `_z` is unset. This only triggers for consumers who don't use `zodvex/core` or `zodvex/mini` (uncommon but possible).

### Both entrypoints imported

If someone imports both `zodvex/core` and `zodvex/mini` (unlikely), the last one wins. This is fine — it's a misconfiguration.

### `zodvex` root entrypoint

The root `zodvex` entrypoint re-exports core + server. It should call `setZodFactory(z)` with full zod, same as `zodvex/core`.

### Cast targets

Several files use `as z.ZodObject<any>`, `as z.ZodOptional<any>` etc. These are TYPE casts, not runtime. They can stay as `import type` references since they erase at compile time.

## Verification

1. `bun run test` — all 860 tests pass (tests use full zod)
2. `bun run type-check` — no type errors
3. `bun run build` — clean, no `'zod'` in mini entrypoint's dependency graph
4. Stress test: re-run the full report matrix. Mini variant should show significantly better numbers since internal schemas are now mini-weight.
5. Bundle analysis: verify that importing from `zodvex/mini` does NOT pull in `zod` — only `zod/mini` and `zod/v4/core`.

## Expected memory impact

Currently at 200 endpoints (both mode):
- Baseline (full zod): 69.68 MB
- Mini (consumer schemas only): 58.16 MB (17% savings)

With full mini mode, internal schemas also become mini-weight. The tables-only path should see the biggest improvement since `defineZodModel` constructs 5-6 internal schemas per table (doc, insert, update, docArray, paginatedDoc, base).

Conservative estimate: 30-40% total savings (vs current 17%), pushing the OOM threshold from ~220 to ~280+ endpoints.
