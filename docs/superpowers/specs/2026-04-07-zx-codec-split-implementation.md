# zx/Codec Split Implementation

> Supersedes the `zx`/codec portions of `2026-04-06-core-type-boundary-enforcement.md` (Fixes 1, 5).
> Union model fixes (Fixes 2-4) from that spec remain valid and orthogonal.

## Problem

`zodvex/core` consumers get `$Zod*` core types on everything returned by `zx.date()`, `zx.id()`, `zx.codec()`, and `zodvexCodec()`. These core types lack method chaining (`.optional()`, `.nullable()`, `.parse()`), breaking real consumer code:

- 44 errors in hotpot (beta.9)
- 12 errors in task-manager once method-chain patterns are used

The root cause is architectural: shared source (`src/zx.ts`, `src/codec.ts`) constructs schemas with full `zod`, then each entrypoint either passes them through (core) or recasts the types (mini). This creates a runtime/type mismatch — objects are full-zod instances behind core-type facades.

This same class of bug has shipped in beta.6, beta.7, beta.8, and beta.9.

## Design Principle

**Shared source = constraints and abstract interface only. Each entrypoint owns its own construction.**

```
shared/          $Zod* constraints, abstract types, pure logic
core/            extends constraints, constructs with `zod`
mini/            extends constraints, constructs with `zod/mini`
```

No recasting. No `as any`. The types match the construction at every level.

This mirrors the existing `ZodModel` pattern:
- `ModelSchemas` (shared constraint)
- `FullZodModelSchemas` (core fills with `z.ZodObject`, etc.)
- `MiniModelSchemas` (mini fills with `$ZodObject`, etc.)
- `defineZodModel` returns the concrete type; mini re-types it

## Scope

This spec covers:
1. `ZodvexCodec` type (in `types.ts`)
2. `zx` namespace — `ZxId`, `ZxDate`, `date()`, `id()`, `codec()`
3. `zodvexCodec()` function
4. CI smoke test

Out of scope (follow-up work):
- Other shared source that constructs with full zod (`results.ts`, `utils.ts`, `wrappers.ts`, etc.)
- Union model type computation (covered by existing spec Fix 2)
- Legacy/deprecated APIs (`convexCodec`, `zodTable`)

## Changes

### 1. `ZodvexCodec` type — generic `Base` parameter

**File:** `src/types.ts`

Add a defaulted `Base` generic so each entrypoint can fill it:

```typescript
export type ZodvexCodec<
  Wire extends $ZodType,
  Runtime extends $ZodType,
  Base extends $ZodCodec<Wire, Runtime> = $ZodCodec<Wire, Runtime>
> = Base & { readonly [ZodvexWireSchema]: Wire }
```

- Default is `$ZodCodec` (core constraint) — existing callsites (`ZodvexCodec<W, R>`) keep working
- Core fills `Base` with `z.ZodCodec<W, R>` (full-zod, has methods)
- Mini leaves the default (no methods, use `z.optional()` wrapper)

### 2. Shared `zx` — constraints and pure logic only

**File:** `src/zx.ts` becomes abstract interface + reusable logic

What stays in shared source:
- `ZodvexWireSchema` brand (already in `types.ts`)
- Type constraint interfaces for `ZxId` and `ZxDate` (using `$Zod*`)
- The `registryHelpers.setMetadata()` call for `id()` — extracted as a helper
- Transform functions: `dateTransforms` (`decode: timestamp => new Date(timestamp)`, `encode: date => date.getTime()`)
- The `zx` namespace shape type (what functions exist and their signatures)

What moves OUT of shared source:
- `z.string().check(z.refine(...), z.describe(...))` — construction in `id()`
- `z.number()`, `z.custom<Date>(...)` — construction in `date()`
- `z.codec(wire, runtime, transforms)` — construction in `zodvexCodec()`

**Shared type definitions** (constraint layer):

```typescript
// src/zx.ts — shared constraints and pure logic

// Constraint types — each entrypoint fills Base
export type ZxDate<Base extends $ZodCodec<$ZodNumber, $ZodCustom<Date, Date>> = $ZodCodec<$ZodNumber, $ZodCustom<Date, Date>>>
  = ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>, Base>

export type ZxId<TableName extends string, Base extends $ZodType<GenericId<TableName>> = $ZodType<GenericId<TableName>>>
  = Base & { _tableName: TableName }

// Pure logic — no construction
export const dateTransforms = {
  decode: (timestamp: number) => new Date(timestamp),
  encode: (date: Date) => date.getTime(),
}

export function applyIdMetadata<T>(schema: T, tableName: string): T {
  registryHelpers.setMetadata(schema as any, { isConvexId: true, tableName })
  const branded = schema as any
  branded._tableName = tableName
  return branded
}

// Namespace shape — each entrypoint provides concrete implementation
export type ZxNamespace<DateType, IdType, CodecType> = {
  date: () => DateType
  id: <TableName extends string>(tableName: TableName) => IdType
  codec: <W extends $ZodType, R extends $ZodType>(
    wire: W, runtime: R,
    transforms: { decode: (wire: any) => any; encode: (runtime: any) => any }
  ) => CodecType
}
```

### 3. Core `zx` — full-zod construction

**File:** `src/core/zx.ts` (new file)

```typescript
import { z } from 'zod'
import type { GenericId } from 'convex/values'
import { type ZxDate, type ZxId, dateTransforms, applyIdMetadata } from '../zx'
import type { ZodvexCodec } from '../types'

// Concrete types — filled with z.ZodCodec / z.ZodType
type FullZxDate = ZxDate<z.ZodCodec<z.ZodNumber, z.ZodCustom<Date, Date>>>
type FullZxId<T extends string> = ZxId<T, z.ZodType<GenericId<T>>>
type FullZodvexCodec<W extends z.ZodType, R extends z.ZodType> = ZodvexCodec<W, R, z.ZodCodec<W, R>>

function date(): FullZxDate {
  return zodvexCodec(
    z.number(),
    z.custom<Date>(val => val instanceof Date, { message: 'Expected Date instance' }),
    dateTransforms
  )
}

function id<TableName extends string>(tableName: TableName): FullZxId<TableName> {
  const baseSchema = z.string().check(
    z.refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    }),
    z.describe(`convexId:${tableName}`)
  )
  return applyIdMetadata(baseSchema, tableName) as FullZxId<TableName>
}

function codec<W extends z.ZodType, R extends z.ZodType>(
  wire: W, runtime: R,
  transforms: { decode: (wire: any) => any; encode: (runtime: any) => any }
): FullZodvexCodec<W, R> {
  return zodvexCodec(wire, runtime, transforms)
}

export function zodvexCodec<W extends z.ZodType, R extends z.ZodType>(
  wire: W, runtime: R,
  transforms: { decode: (wire: any) => any; encode: (runtime: any) => any }
): FullZodvexCodec<W, R> {
  return z.codec(wire as any, runtime as any, transforms as any) as unknown as FullZodvexCodec<W, R>
}

export type { FullZxDate as ZxDate, FullZxId as ZxId }
export const zx = { date, id, codec } as const
```

`ZodvexCodec` is NOT re-exported from `core/zx.ts`. The constraint type from `types.ts` (with the `Base` generic) flows through `export * from '../types'` in `core/index.ts`. Consumers who need explicit codec type annotations use `ZodvexCodec<W, R, z.ZodCodec<W, R>>`. The concrete types flow through function return types — `zx.date()` returns `FullZxDate`, `zx.codec()` returns `FullZodvexCodec<W, R>`, etc.

### 4. Mini `zx` — zod/mini construction

**File:** `src/mini/zx.ts` (new file)

```typescript
import { z } from 'zod/mini'
import type { GenericId } from 'convex/values'
import { type ZxDate, type ZxId, dateTransforms, applyIdMetadata } from '../zx'
import type { ZodvexCodec } from '../types'
import type { $ZodCodec, $ZodCustom, $ZodNumber, $ZodType } from '../zod-core'

// Mini types — default Base ($ZodCodec / $ZodType), no method chaining
type MiniZxDate = ZxDate  // default Base = $ZodCodec<...>
type MiniZxId<T extends string> = ZxId<T>  // default Base = $ZodType<...>

function date(): MiniZxDate {
  return zodvexCodec(
    z.number(),
    z.custom<Date>(val => val instanceof Date, { error: 'Expected Date instance' }),
    dateTransforms
  )
}

function id<TableName extends string>(tableName: TableName): MiniZxId<TableName> {
  const baseSchema = z.string().check(
    z.refine(val => typeof val === 'string' && val.length > 0, {
      error: `Invalid ID for table "${tableName}"`
    }),
    z.describe(`convexId:${tableName}`)
  )
  return applyIdMetadata(baseSchema, tableName) as MiniZxId<TableName>
}

function codec<W extends $ZodType, R extends $ZodType>(
  wire: W, runtime: R,
  transforms: { decode: (wire: any) => any; encode: (runtime: any) => any }
): ZodvexCodec<W, R> {
  return zodvexCodec(wire, runtime, transforms)
}

export function zodvexCodec<W extends $ZodType, R extends $ZodType>(
  wire: W, runtime: R,
  transforms: { decode: (wire: any) => any; encode: (runtime: any) => any }
): ZodvexCodec<W, R> {
  return z.codec(wire as any, runtime as any, transforms as any) as unknown as ZodvexCodec<W, R>
}

export type { MiniZxDate as ZxDate, MiniZxId as ZxId }
export const zx = { date, id, codec } as const
```

### 5. Entrypoint updates

**`src/core/index.ts`:**
- Remove `export * from '../zx'`
- Remove `zodvexCodec` from `../codec` re-exports
- Add `export { zx, zodvexCodec, type ZxDate, type ZxId } from './zx'`
- `ZodvexCodec` type stays via `export * from '../types'` (the constraint with `Base` generic)

**`src/mini/index.ts`:**
- Remove the `zx` re-typing block (lines 139-169)
- Remove `ZxMiniId`, `ZxMiniDate` type definitions
- Add `export { zx, zodvexCodec, type ZxDate, type ZxId } from './zx'`
- `ZodvexCodec` stays via `export * from '../types'` (uses default `$ZodCodec` base)

### 6. Shared `codec.ts` cleanup

`zodvexCodec()` moves to each entrypoint's `zx.ts`. The shared `src/codec.ts` keeps only:
- `decodeDoc()`, `encodeDoc()`, `encodePartialDoc()` — these use `parse()`/`encode()` from `zod/v4/core` standalone functions, no construction needed
- `convexCodec()` (deprecated) — uses `z.object()` construction; leave for now, flag for future split
- `ZodvexCodec` type re-export stays (from `types.ts`)

### 7. CI smoke test

**`.github/workflows/ci.yml`** — add after the codegen staleness check:

```yaml
- name: Smoke test example apps (convex codegen)
  run: |
    bunx --cwd examples/task-manager convex codegen
    bunx --cwd examples/task-manager-mini convex codegen
```

This runs the full Convex pipeline (bundle, upload, tsc) on example apps that use method-chain patterns (`zx.date().optional()`, `zx.id('users').optional()`).

### 8. Example app changes (already done)

- `examples/task-manager/convex/models/task.ts` — uses `.optional()` method chains instead of `z.optional()` wrappers
- `examples/task-manager/convex/tasks.ts` — same
- `examples/task-manager/convex/api/reports.ts` — same
- `examples/task-manager/convex/cleanup.ts` — fixed `zod/mini` import back to `zod`

## What this does NOT change

- **Shared `src/codec.ts`** functions (`decodeDoc`, `encodeDoc`, `encodePartialDoc`) — these use standalone `parse()`/`encode()` from `zod/v4/core`, not construction. They're fine.
- **`src/model.ts`** — already follows the split pattern via `Schemas` generic.
- **Server-side builders** (`wrappers.ts`, `custom.ts`, `init.ts`, `builders.ts`) — return Convex `Registered*` types, not Zod schemas. No consumer-facing type issue.
- **Other shared source with `z.object()` construction** (`results.ts`, `utils.ts`) — should be migrated to split pattern in follow-up work, but don't cause consumer-facing type breakage today.

## Verification

1. `bun run type-check` — zero errors
2. `bun run test` — all tests pass (1746 tests: 873 zod + 873 mini)
3. `bunx --cwd examples/task-manager convex codegen` — zero errors
4. `bunx --cwd examples/task-manager-mini convex codegen` — zero errors
5. In task-manager, `zx.date().optional()` and `zx.id('users').optional()` compile
6. In task-manager-mini, `z.optional(zx.date())` and `z.optional(zx.id('users'))` compile
7. `bun run build` — clean, mini outputs import `zod/mini` not `zod`

## File summary

| File | Action |
|------|--------|
| `src/types.ts` | Add `Base` generic to `ZodvexCodec` |
| `src/zx.ts` | Strip to constraints + pure logic only |
| `src/core/zx.ts` | New — full-zod `zx` implementation |
| `src/mini/zx.ts` | New — zod/mini `zx` implementation |
| `src/core/index.ts` | Import `zx`, `zodvexCodec`, `ZxDate`, `ZxId` from `./zx`; remove `../zx` wildcard |
| `src/mini/index.ts` | Import `zx`, `zodvexCodec`, `ZxDate`, `ZxId` from `./zx`; remove re-typing block |
| `src/codec.ts` | Remove `zodvexCodec()` function (moved to entrypoint zx files) |
| `.github/workflows/ci.yml` | Add `convex codegen` smoke test |
