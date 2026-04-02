# `as any` Cast Remediation — Design Spec

## Problem

The zod/v4/core migration (PR #54) introduced pervasive `as any` casts throughout `packages/zodvex/src/`. These casts exist because the migration replaced method calls (`.unwrap()`, `.parse()`, `.options`) and direct property accessors (`.shape`, `.element`, `.def`) with `._zod.def.*` access paths — but cast everything to `any` instead of relying on TypeScript's type narrowing after `instanceof` checks.

This is unsafe, obscures real type errors, and contradicts [Zod's library author guidance](https://zod.dev/library-authors) which says to use `$ZodType` and its subclasses from `zod/v4/core` — these provide fully typed `_zod.def` access after `instanceof` narrowing.

### Baseline

- **Total `as any` in `src/` (excluding `transform/`):** 173 across 32 files
- **Target fixable (migration debt):** ~80
- **Structural (Convex bridging, generic escapes):** ~93
- **`transform/` module (excluded):** 46 across 2 files — no consumers, will be removed in follow-up PR

## Root Cause

After `instanceof $ZodObject`, TypeScript narrows the type to `$ZodObject` which has `_zod: $ZodObjectInternals` with a typed `def.shape`. The same applies to all core subclasses:

| Guard | Typed access |
|---|---|
| `instanceof $ZodObject` | `schema._zod.def.shape`, `.catchall` |
| `instanceof $ZodOptional` | `schema._zod.def.innerType` |
| `instanceof $ZodNullable` | `schema._zod.def.innerType` |
| `instanceof $ZodUnion` | `schema._zod.def.options` |
| `instanceof $ZodDiscriminatedUnion` | `schema._zod.def.options`, `.discriminator` |
| `instanceof $ZodEnum` | `schema._zod.def.entries` |
| `instanceof $ZodArray` | `schema._zod.def.element` |
| `instanceof $ZodRecord` | `schema._zod.def.keyType`, `.valueType` |
| `instanceof $ZodTuple` | `schema._zod.def.items` |
| `instanceof $ZodLazy` | `schema._zod.def.getter` |
| `instanceof $ZodCodec` | `schema._zod.def.in`, `.out` |
| `instanceof $ZodDefault` | `schema._zod.def.innerType`, `.defaultValue` |
| `instanceof $ZodLiteral` | `schema._zod.def.values` |

The casts were never needed — they were a shortcut during the migration.

## Approach

Direct inline fixes. No new abstractions, no helper functions, no wrapper types. Every fixable cast site falls into one of five mechanical patterns:

### Pattern 1 — Remove unnecessary cast (instanceof already narrows)

```typescript
// Before:
if (schema instanceof $ZodObject) {
  const shape = (schema as any)._zod.def.shape
}
// After:
if (schema instanceof $ZodObject) {
  const shape = schema._zod.def.shape
}
```

The instanceof guard is already present; the `as any` is simply redundant.

### Pattern 2 — Migrate untyped direct accessor to `_zod.def`

```typescript
// Before:
if (schema instanceof $ZodObject) {
  const shape = (schema as any).shape
}
// After:
if (schema instanceof $ZodObject) {
  const shape = schema._zod.def.shape
}
```

Properties like `.shape`, `.element`, `.value` exist at runtime as getters but are **not typed** on the `zod/v4/core` interfaces — only `._zod.def.*` is typed. The fix is to use the typed path.

### Pattern 3 — Migrate `.def` to `._zod.def`

```typescript
// Before:
if (zodValidator instanceof $ZodDefault) {
  defaultValue = (zodValidator as any).def?.defaultValue
  actualValidator = (zodValidator as any).def?.innerType
}
// After:
if (zodValidator instanceof $ZodDefault) {
  defaultValue = zodValidator._zod.def.defaultValue
  actualValidator = zodValidator._zod.def.innerType
}
```

Legacy pattern accessing `.def` directly instead of `._zod.def`. Concentrated in `mapping/core.ts`.

### Pattern 4 — Remove cast from `$ZodOptional` constructor

```typescript
// Before:
return new ($ZodOptional as any)({ type: 'optional', innerType: schema })
// After:
return new $ZodOptional({ type: 'optional', innerType: schema })
```

2 sites (`model.ts:31`, `tables.ts:20`). `$ZodOptional` from core is directly constructable — verified via `bun run type-check`.

### Pattern 5 — Replace convenience methods with `_zod.def` access

```typescript
// Before (wrappers.ts, normalizeCodecPaths.ts, utils.ts):
const inner = (schema as any).removeDefault()
// After:
const inner = schema._zod.def.innerType  // after instanceof $ZodDefault

// Before (codec.ts):
const pickedSchema = (schema as any).pick(pickObj)
const partialSchema = (schema as any).partial()
// After: retain cast with comment — .pick()/.partial() are full-zod convenience
// methods with no core equivalent. These are structural casts.
```

`.removeDefault()` is a convenience method that returns `._zod.def.innerType` — replace with typed access. `.pick()` and `.partial()` have no `zod/v4/core` equivalent and must remain as structural casts (documented).

### Not in scope

- **`transform/` module** (46 casts) — no consumers, will be removed in a follow-up PR
- **Structural casts** (~93 sites) — Convex type bridging, generic constraint escapes, `.pick()`/`.partial()` convenience methods, cross-module interop. Not migration debt. Each should have a comment explaining why.

## File Scope

All 32 files with `as any` (excluding `transform/`), grouped by execution batch:

### Batch 1 — Core mapping pipeline (45 casts)

| File | Casts | Patterns |
|---|---|---|
| `mapping/core.ts` | 29 | P2, P3 |
| `mapping/handlers/record.ts` | 8 | P1, P3 |
| `mapping/handlers/union.ts` | 3 | P1 |
| `mapping/handlers/enum.ts` | 2 | P1 |
| `mapping/handlers/nullable.ts` | 2 | P1 |
| `mapping/utils.ts` | 1 | P2 |

### Batch 2 — Schema definition & helpers (14 casts)

| File | Casts | Patterns |
|---|---|---|
| `schemaHelpers.ts` | 5 | P1 |
| `tables.ts` | 6 | P1, P4 |
| `model.ts` | 3 | P2, P4 |

### Batch 3 — Function wrappers (46 casts)

| File | Casts | Patterns |
|---|---|---|
| `wrappers.ts` | 20 | P1, P2, P5 |
| `custom.ts` | 11 | P1, P2 |
| `builders.ts` | 15 | investigate |

### Batch 4 — Codegen & utilities (41 casts)

| File | Casts | Patterns |
|---|---|---|
| `codegen/generate.ts` | 5 | P1, P2 |
| `codegen/discover.ts` | 3 | P1 |
| `codegen/zodToSource.ts` | 4 | P1 |
| `codegen/extractCodec.ts` | 2 | P1 |
| `normalizeCodecPaths.ts` | 4 | P1, P2, P5 |
| `utils.ts` | 12 | P1, P2, P5 |
| `db.ts` | 7 | P1 |
| `codec.ts` | 4 | P5, structural |

### Batch 5 — Remaining (27 casts)

| File | Casts | Patterns |
|---|---|---|
| `schema.ts` | 4 | investigate |
| `rules.ts` | 6 | investigate |
| `registry.ts` | 3 | investigate |
| `cli/init.ts` | 3 | likely structural |
| `__type-tests__/zodTable-inference.ts` | 3 | likely structural |
| `init.ts` | 2 | investigate |
| `zx.ts` | 1 | investigate |
| `react/zodvexReactClient.ts` | 1 | investigate |
| `react/hooks.ts` | 1 | investigate |
| `mini/index.ts` | 1 | investigate |
| `ids.ts` | 1 | investigate |
| `boundaryHelpers.ts` | 1 | investigate |

## Verification

Each batch:
1. `bun run type-check` — no type errors
2. `bun run test` — all tests pass
3. Commit

Final verification:
1. Zero `as any` casts that exist solely to access `_zod.def` properties or call convenience methods with typed equivalents
2. Remaining structural casts each have a comment explaining why
3. `bun run lint:fix` — clean

## Success Criteria

- Zero `as any` casts that exist solely to access `_zod.def` properties (Patterns 1-4)
- Zero `.removeDefault()` convenience method casts where `._zod.def.innerType` suffices (Pattern 5)
- All remaining `as any` casts are structural (Convex bridging, `.pick()`/`.partial()`, generic escapes) and documented with a comment
- No new modules, helpers, or abstractions introduced
- No runtime behavior changes — purely type-level fixes
