# zod/mini Compatibility Redesign

> Supersedes: `2026-04-02-full-mini-mode-design.md` (mutable global `setZodFactory`/`getZ()` pattern — replaced by explicit -impl parameterization)

## Problem

zodvex promises zod/mini compatibility via `zodvex/mini`, but the current implementation is a type-level fiction. At runtime, ALL schema construction uses `import { z } from 'zod'` (full zod) regardless of entrypoint. The mini entrypoint re-exports the same functions with `as any` casts and different type annotations.

### What breaks

1. **Memory**: Full zod is always in the bundle. Stress tests show only 16-18% savings when consumer uses mini, because zodvex's internal schemas are full-weight (61 own properties per `z.object()` vs 15 for mini).

2. **Types**: `InsertSchema` in the mini entrypoint references `ZodObject` (full) while `Schemas` references `MiniModelSchemas` — a mismatch that causes 33 type errors in task-manager-mini (every `.withIndex()` and `.eq()`/`.gt()`/`.lt()` call fails).

3. **Tests don't catch this**: The dual test suite runs via a Vite plugin that transforms test source code but never touches zodvex's compiled library code. Both test runs exercise the same full-zod runtime.

### Root cause

16 files in `packages/zodvex/src/` have runtime `import { z } from 'zod'` with ~100+ constructor calls. The mini entrypoint (`src/mini/index.ts`) imports these same modules and casts the exports with different types, but the underlying `z.object()`, `z.array()`, etc. calls always produce full-zod instances.

## Goal

When a consumer imports from `zodvex/mini`, ALL internal schema construction uses `zod/mini`. No `import { z } from 'zod'` appears in the mini dependency graph. The consumer's entrypoint choice (`zodvex/core` vs `zodvex/mini`) is the single configuration point. Both entrypoints have identical API surfaces.

## Design: The -impl Pattern

### Principle: Two layers

**Layer 1 — Accept/Inspect (core only):** Code that receives schemas, checks `instanceof`, maps to Convex validators, extracts type information. Imports ONLY from `zod/v4/core`. Already done for the mapping layer.

**Layer 2 — Construct (dual entrypoints):** Code that creates new Zod schema objects. Shared logic lives in `-impl` modules parameterized over a `z` namespace. Thin entrypoint modules wire up the right `z`.

### The -impl pattern

Each module that constructs schemas gets split into:

- **`foo-impl.ts`** — Pure logic. Imports only from `zod/v4/core`. Exports a factory function that accepts `z` (and any inter-module dependencies) as parameters.
- **`foo.ts`** — Thin wrapper for `zodvex/core`: `import { z } from 'zod'` + calls impl.
- **`mini/foo.ts`** — Thin wrapper for `zodvex/mini`: `import { z } from 'zod/mini'` + calls impl.

Example:

```ts
// src/model-impl.ts — pure logic, no zod/zod-mini import
import type { ZodNamespace } from './z-namespace'
import type { $ZodType, $ZodShape } from './zod-core'

export function createDefineZodModel(
  z: ZodNamespace,
  zx: { id: (name: string) => $ZodType; date: () => $ZodType },
  helpers: { addSystemFields: ...; ensureOptional: ... }
) {
  return function defineZodModel(name: string, fields: $ZodShape) {
    const insertSchema = z.object(fields)
    const docSchema = z.object({
      ...fields,
      _id: zx.id(name),
      _creationTime: z.number()
    })
    // ... same logic as current model.ts
  }
}
```

```ts
// src/model.ts (full zod path)
import { z } from 'zod'
import { zx } from './zx'
import { helpers } from './schemaHelpers'
import { createDefineZodModel } from './model-impl'
export const defineZodModel = createDefineZodModel(z, zx, helpers)

// src/mini/model.ts (mini path)
import { z } from 'zod/mini'
import { zx } from './zx'
import { helpers } from './schemaHelpers'
import { createDefineZodModel } from '../model-impl'
export const defineZodModel = createDefineZodModel(z, zx, helpers)
```

### Why -impl over the prior `setZodFactory`/`getZ()` design

| Concern | Prior design (mutable global) | New design (-impl) |
|---------|-------------------------------|---------------------|
| Import ordering | Fragile — `setZodFactory()` must run before any `getZ()` call | None — wiring is explicit at each entrypoint |
| Both entrypoints imported | Last one wins (mutable state) | Independent instances, no conflict |
| Server without core/mini | Open question (throw vs lazy-default) | Not an issue — `zodvex/server` and `zodvex/mini/server` are independent |
| Testability | Global state complicates test isolation | Pure functions, easy to test with either z |
| Tree-shaking | `getZ()` is opaque to bundlers | Direct `z.object()` calls are analyzable |

### The ZodNamespace interface

Typed with `zod/v4/core` types. Both `z` from `'zod'` and `z` from `'zod/mini'` satisfy this interface.

```ts
// src/z-namespace.ts
import type {
  $ZodAny, $ZodArray, $ZodBoolean, $ZodCodec, $ZodCustom,
  $ZodDiscriminatedUnion, $ZodEnum, $ZodLiteral, $ZodNullable,
  $ZodNumber, $ZodObject, $ZodOptional, $ZodRecord, $ZodShape,
  $ZodString, $ZodType, $ZodUnion
} from './zod-core'

export interface ZodNamespace {
  object<T extends $ZodShape>(shape: T): $ZodObject<T>
  array<T extends $ZodType>(element: T): $ZodArray<T>
  string(): $ZodString
  number(): $ZodNumber
  boolean(): $ZodBoolean
  optional<T extends $ZodType>(inner: T): $ZodOptional<T>
  nullable<T extends $ZodType>(inner: T): $ZodNullable<T>
  union(options: readonly $ZodType[]): $ZodUnion
  discriminatedUnion(disc: string, options: readonly $ZodType[]): $ZodDiscriminatedUnion
  literal(value: any): $ZodLiteral
  enum(values: readonly string[]): $ZodEnum
  record(key: $ZodType, value: $ZodType): $ZodRecord
  any(): $ZodAny
  custom<O, I>(fn?: (data: O) => unknown): $ZodCustom<O, I>
  codec(in_: $ZodType, out: $ZodType, params: { decode: any; encode: any }): $ZodCodec
}
```

The exact generic signatures may need refinement during implementation to match what both `z` from `'zod'` and `z` from `'zod/mini'` actually provide. The principle is: the interface includes only the intersection of what both provide, typed with core types.

## Entrypoint structure

| Entrypoint | z source | Scope | Status |
|---|---|---|---|
| `zodvex/core` | `'zod'` | Client-safe | Exists, update wiring |
| `zodvex/mini` | `'zod/mini'` | Client-safe | Exists, rewrite |
| `zodvex/server` | `'zod'` | Server | Exists, update wiring |
| `zodvex/mini/server` | `'zod/mini'` | Server | **New** |
| `zodvex` | `'zod'` | Re-exports core + server | Exists, no change |

Each entrypoint's module graph is fully isolated — `zodvex/mini` never transitively imports from `'zod'`, and `zodvex/core` never imports from `'zod/mini'`.

## Modules: what changes

### New files

| File | Purpose |
|---|---|
| `src/z-namespace.ts` | `ZodNamespace` interface |

### Refactored to -impl pattern (13 modules)

Each gets: `foo-impl.ts` (shared logic) + `foo.ts` (full zod) + `mini/foo.ts` (mini).

| Module | Impl factory | Dependencies | Scope |
|---|---|---|---|
| `ids` | `createIds(z)` | z | core |
| `zx` | `createZx(z, ids)` | z, ids | core |
| `schemaHelpers` | `createSchemaHelpers(z)` | z | core |
| `model` | `createDefineZodModel(z, zx, helpers)` | z, zx, schemaHelpers | core |
| `results` | `createResults(z)` | z | core |
| `utils` | `createUtils(z)` | z | core |
| `codec` | `createCodec(z)` | z | core |
| `registry` | `createRegistry(z)` | z (`toJSONSchema` available in mini via core) | core |
| `builders` | `createBuilders(z)` | z | server |
| `custom` | `createCustom(z)` | z | server |
| `wrappers` | `createWrappers(z)` | z | server |
| `db` | `createDb(z)` | z | server |
| `rules` | `createRules(z)` | z | server |

### Excluded from mini

- **`tables.ts`** — Legacy, being replaced by defineZodModel. Not worth migrating.
- **`form/mantine/`** — Separate concern, can be addressed later.

### Already safe (no changes needed)

- **`mapping/core.ts`**, **`mapping/types.ts`** — already import only from `zod/v4/core`
- **`schema.ts`** — accepts/inspects schemas, doesn't construct. Uses `import type`.
- **`zod-core.ts`** — re-exports from `zod/v4/core`
- **`types.ts`**, **`init.ts`**, **`boundaryHelpers.ts`** — `import type` only

### Convert to `import type`

- **`serverUtils.ts`** — only uses `z.ZodError` as type reference
- **`form/mantine/index.ts`** — uses `z.safeParse()`, replaceable with standalone `safeParse()` from core

### Special case: codegen

`codegen/generate.ts` emits `import { z } from 'zod'` as a string in generated code. Should emit the consumer's import path. The codegen already knows whether the consumer uses mini (from schema config or a CLI flag).

## Chaining elimination

zodvex uses method chaining in several places. zod/mini only supports functional forms. All chaining must be converted:

| Current pattern | Replacement | Occurrences |
|---|---|---|
| `schema.optional()` | `z.optional(schema)` | ~15 |
| `schema.nullable()` | `z.nullable(schema)` | ~8 |
| `z.string().check(...).check(...).describe(...)` | `z.string().check(z.check(fn), z.describe(str))` — verify mini API | 2 (ids.ts, zx.ts) |
| `new $ZodOptional({type: 'optional', innerType})` | `z.optional(schema)` | 2 (model.ts, tables.ts) |

The existing `new $ZodOptional(def)` direct constructor calls in model.ts and tables.ts should also be replaced with `z.optional()` for consistency.

## Type system fixes

### InsertSchema dual-master resolution

The current bug: `mini/index.ts:112` types InsertSchema as `ZodObject<Fields>` (full zod, not even imported) while Schemas is `MiniModelSchemas`.

With the -impl pattern, each entrypoint provides the correct types naturally:

- **`model.ts`** (full): Returns `ZodModel<..., z.ZodObject<Fields>, FullZodModelSchemas<...>, ...>`
- **`mini/model.ts`** (mini): Returns `ZodModel<..., ZodMiniObject<Fields>, MiniModelSchemas<...>, ...>`

Both work because:
1. `ModelFieldPaths<InsertSchema>` constrains `InsertSchema extends $ZodType` — both `z.ZodObject` and `ZodMiniObject` extend `$ZodObject` which extends `$ZodType`.
2. `ConvexValidatorFromZodFieldsAuto<F>` operates on `model.fields` (the shape, typed as `$ZodShape`), not on `InsertSchema`.
3. The Convex `DataModel` type derivation in `schema.ts` uses `ConvexTableFor<E>` which extracts `fields: infer F extends Record<string, $ZodType>` — core-typed, works with both.

### convex-helpers

convex-helpers does NOT transitively import from `'zod'`. Its exports used by zodvex:
- `Customization`, `NoOp`, `customCtx` from `convex-helpers/server/customFunctions` — no zod dependency
- `Table` from `convex-helpers/server` — only used in `tables.ts` (excluded from mini)

No changes needed for convex-helpers.

## Test infrastructure

### Why current tests don't catch this

The dual test suite runs via a Vite plugin (`packages/zod-to-mini/src/vite-plugin.ts`) that transforms test source code:
- Replaces `.optional()` with `z.optional()`
- Replaces `z.ZodObject` with `$ZodObject`
- etc.

But the plugin **never transforms zodvex's own library code** — only test files that import from `'zod'`. Both the "zod" and "zod-mini" test runs exercise the exact same zodvex runtime, which always uses full zod. The tests prove "zodvex's API is type-compatible with mini types" but NOT "zodvex creates mini objects at runtime."

### New test requirements

1. **Runtime assertion tests**: Verify that schemas produced by `zodvex/mini` are actual mini instances:
   ```ts
   import { defineZodModel } from 'zodvex/mini'
   const model = defineZodModel('test', { name: z.string() })
   // model.schema.doc should be a ZodMiniObject, not a ZodObject
   expect(model.schema.doc).toBeInstanceOf(ZodMiniObject)
   expect(model.schema.doc).not.toBeInstanceOf(ZodObject)
   ```

2. **Import isolation test**: A test environment where `import 'zod'` (full) is blocked — any accidental full-zod import in the mini path fails immediately. This can be done via a Vite/vitest plugin that intercepts `'zod'` imports and throws when running in mini mode.

3. **Type-check both entrypoints against examples**: Run `tsc --noEmit` on `examples/task-manager-mini/` to catch type errors like the current 33 failures. This should be part of CI.

## Expected memory impact

From the prior spec's measurements:
- Currently at 200 endpoints: full zod = 69.68 MB, mini (consumer only) = 58.16 MB (17% savings)
- With full mini mode, internal schemas also become mini-weight
- Conservative estimate: 30-40% total savings, pushing OOM threshold from ~220 to ~280+ endpoints

## Scope exclusions

- **Compilation step**: The compile-to-mini approach (zod-to-mini codemod at build time) remains deferred pending Convex pre-build hooks. This spec addresses the runtime dual-entrypoint approach only.
- **`tables.ts` mini support**: Legacy module, excluded.
- **`form/mantine/` mini support**: Deferred.
- **`zodvex/react` and `zodvex/client` mini variants**: These consume schemas but don't construct them. They should work with either entrypoint's output without changes, but this should be verified.
