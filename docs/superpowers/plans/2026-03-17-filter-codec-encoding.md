# Filter Codec Encoding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend codec encoding to `.filter()` with full type support via `ZodvexExpression<T>` and `ZodvexFilterBuilder`.

**Architecture:** Define `ZodvexExpression<T>` (unconstrained branded type) and `ZodvexFilterBuilder` (parallel to Convex's `FilterBuilder`). Proxy-based runtime encoding via `wrapFilterBuilder` reuses `encodeIndexValue`. Overloaded `.filter()` accepts both Convex-native and decoded-aware predicates. Schema-derived helper types (`InferFilterBuilder`, etc.) enable reusable filter helpers.

**Tech Stack:** TypeScript 5.x, Zod v4, Convex 1.28+, Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-17-filter-codec-encoding-design.md`

---

## Task 0: Runtime — `extractFieldPath` + `wrapFilterBuilder`

**Files:**
- Modify: `packages/zodvex/src/db.ts` (add after `wrapIndexRangeBuilder` at ~line 163)

- [ ] **Step 1: Write failing runtime tests**

Add to `packages/zodvex/__tests__/db.test.ts` after the `withSearchIndex encoding` describe block (after line 809). First, add a mock filter builder factory before the new describe block:

```typescript
/**
 * Creates a mock FilterBuilder that simulates Convex's expression API.
 * field() returns objects with serialize() matching ExpressionImpl behavior.
 * Comparison methods capture their arguments after any proxy encoding.
 */
function createFilterCapturingMock() {
  const captured: { method: string; left: any; right: any }[] = []

  // Simulate ExpressionImpl — serialize() returns the inner JSON
  function makeExpr(inner: any) {
    return {
      serialize: () => inner,
      _isExpression: undefined,
    }
  }

  const mockFilterBuilder: any = {
    field: (fieldPath: string) => makeExpr({ $field: fieldPath }),
    eq: (l: any, r: any) => {
      captured.push({ method: 'eq', left: l, right: r })
      return makeExpr({ $eq: [l, r] })
    },
    neq: (l: any, r: any) => {
      captured.push({ method: 'neq', left: l, right: r })
      return makeExpr({ $neq: [l, r] })
    },
    lt: (l: any, r: any) => {
      captured.push({ method: 'lt', left: l, right: r })
      return makeExpr({ $lt: [l, r] })
    },
    lte: (l: any, r: any) => {
      captured.push({ method: 'lte', left: l, right: r })
      return makeExpr({ $lte: [l, r] })
    },
    gt: (l: any, r: any) => {
      captured.push({ method: 'gt', left: l, right: r })
      return makeExpr({ $gt: [l, r] })
    },
    gte: (l: any, r: any) => {
      captured.push({ method: 'gte', left: l, right: r })
      return makeExpr({ $gte: [l, r] })
    },
    and: (...exprs: any[]) => makeExpr({ $and: exprs }),
    or: (...exprs: any[]) => makeExpr({ $or: exprs }),
    not: (x: any) => makeExpr({ $not: x }),
  }

  return { mockFilterBuilder, captured }
}
```

Then the test suite — note: `wrapFilterBuilder` is not exported yet, so these tests will import it after we add it. For now write them referencing the import that will exist:

```typescript
// Import at top of file — add alongside existing imports:
// import { wrapFilterBuilder } from '../src/db'
// (or test through ZodvexQueryChain.filter() once integrated)

describe('filter encoding', () => {
  it('encodes a codec field (zx.date) via eq(field, value)', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    const fieldExpr = wrapped.field('createdAt')
    wrapped.eq(fieldExpr, new Date(1700000000000))

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    // left should be the field expression (unchanged)
    expect(captured[0].left.serialize()).toEqual({ $field: 'createdAt' })
    // right should be encoded from Date to timestamp
    expect(captured[0].right).toBe(1700000000000)
  })

  it('passes through non-codec field values unchanged', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    wrapped.eq(wrapped.field('name'), 'Alice')

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('Alice')
  })

  it('passes through dot-path values unchanged', () => {
    const objectCodecDocSchema = z.object({
      _id: z.string(),
      _creationTime: z.number(),
      email: zodvexCodec(
        z.object({ value: z.string(), encrypted: z.string() }),
        z.custom<{ expose: () => string }>(() => true),
        {
          decode: (wire: any) => ({ expose: () => wire.value }),
          encode: (rt: any) => ({ value: rt.expose(), encrypted: 'enc' }),
        }
      ),
    })

    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, objectCodecDocSchema)

    wrapped.eq(wrapped.field('email.value'), 'alice@example.com')

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('alice@example.com')
  })

  it('encodes multiple comparisons inside and()', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    const date1 = new Date(1700000000000)
    const date2 = new Date(1700100000000)
    wrapped.and(
      wrapped.gte(wrapped.field('createdAt'), date1),
      wrapped.lt(wrapped.field('createdAt'), date2)
    )

    expect(captured).toHaveLength(2)
    expect(captured[0]).toMatchObject({ method: 'gte', right: 1700000000000 })
    expect(captured[1]).toMatchObject({ method: 'lt', right: 1700100000000 })
  })

  it('encodes discriminator literals on union schema', () => {
    const unionDocSchema = z.discriminatedUnion('kind', [
      z.object({ _id: z.string(), _creationTime: z.number(), kind: z.literal('email'), createdAt: zx.date() }),
      z.object({ _id: z.string(), _creationTime: z.number(), kind: z.literal('push'), createdAt: zx.date() }),
    ])

    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, unionDocSchema)

    wrapped.eq(wrapped.field('kind'), 'push')

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('push')
  })

  it('encodes via neq()', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    wrapped.neq(wrapped.field('createdAt'), new Date(1700000000000))

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('neq')
    expect(captured[0].right).toBe(1700000000000)
  })

  it('does not intercept and/or/not', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    const expr1 = wrapped.eq(wrapped.field('name'), 'Alice')
    const expr2 = wrapped.eq(wrapped.field('name'), 'Bob')
    const result = wrapped.and(expr1, expr2)

    // and() should return an expression, not be captured as a comparison
    expect(result.serialize()).toBeDefined()
    // Only the two eq() calls should be captured
    expect(captured).toHaveLength(2)
  })

  it('encodes reversed operand order (value, field)', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    wrapped.eq(new Date(1700000000000), wrapped.field('createdAt'))

    expect(captured).toHaveLength(1)
    // left should be encoded (was Date, now number)
    expect(captured[0].left).toBe(1700000000000)
    // right should be the field expression (unchanged)
    expect(captured[0].right.serialize()).toEqual({ $field: 'createdAt' })
  })

  it('passes through null comparison unchanged', () => {
    const { mockFilterBuilder, captured } = createFilterCapturingMock()
    const wrapped = wrapFilterBuilder(mockFilterBuilder, userDocSchema)

    wrapped.eq(wrapped.field('name'), null)

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: FAIL — `wrapFilterBuilder` is not defined/exported yet.

- [ ] **Step 3: Implement `extractFieldPath` and `wrapFilterBuilder`**

In `packages/zodvex/src/db.ts`, add after the `wrapIndexRangeBuilder` function (after line ~163):

```typescript
/**
 * Extracts a field path from an expression if it's a $field reference.
 * Uses the public serialize() method on ExpressionImpl.
 * Returns null for non-expression values or non-field expressions.
 *
 * Depends on Convex's filter expression wire format where field()
 * produces { $field: fieldPath }. Verified stable across convex 1.28–1.33.1.
 */
function extractFieldPath(expr: any): string | null {
  if (expr && typeof expr.serialize === 'function') {
    const inner = expr.serialize()
    if (inner && typeof inner === 'object' && '$field' in inner) {
      return inner.$field
    }
  }
  return null
}

/**
 * Wraps a Convex FilterBuilder with automatic value encoding.
 * Intercepts comparison methods (eq, neq, lt, lte, gt, gte).
 * When one argument is a $field expression and the other is a raw value,
 * encodes the raw value through the table's doc schema.
 *
 * Does NOT intercept and/or/not (boolean composition), field() (expression
 * creation), or arithmetic methods (numeric only, no codec fields).
 */
function wrapFilterBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(prop)) {
        return (l: any, r: any) => {
          const lField = extractFieldPath(l)
          const rField = extractFieldPath(r)
          if (lField && !rField) {
            r = encodeIndexValue(schema, lField, r)
          } else if (rField && !lField) {
            l = encodeIndexValue(schema, rField, l)
          }
          return target[prop](l, r)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}
```

The function must be exported for testing. Add `export` keyword:

```typescript
/** @internal Exported for testing only — not part of the public API. */
export function wrapFilterBuilder(inner: any, schema: z.ZodTypeAny): any {
```

Also export `ZodvexIndexFieldValue` (currently unexported at line 43) for use in type tests:

```typescript
export type ZodvexIndexFieldValue<
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: PASS — all 9 filter encoding tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/src/db.ts packages/zodvex/__tests__/db.test.ts
git commit -m "feat: add wrapFilterBuilder with codec encoding for filter comparisons

Proxy intercepts eq/neq/lt/lte/gt/gte on FilterBuilder. When one arg
is a \$field expression and the other is a raw value, encodes through
encodeIndexValue. Reuses existing object + union schema encoding.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Runtime — real Convex boundary test

**Files:**
- Modify: `packages/zodvex/__tests__/db.test.ts`

- [ ] **Step 1: Write boundary test using real Convex ExpressionImpl**

Add to `packages/zodvex/__tests__/db.test.ts`:

```typescript
describe('filter encoding — real Convex boundary', () => {
  it('encodes values through real filterBuilderImpl and produces valid serialized expressions', async () => {
    // Dynamic import of Convex internal — pinned to convex >=1.28
    const { filterBuilderImpl } = await import(
      '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
    )

    const wrapped = wrapFilterBuilder(filterBuilderImpl, userDocSchema)

    // Build: eq(field("createdAt"), new Date(...))
    const fieldExpr = wrapped.field('createdAt')
    const eqExpr = wrapped.eq(fieldExpr, new Date(1700000000000))

    // The result should be a real ExpressionImpl with valid serialized JSON
    const serialized = eqExpr.serialize()
    expect(serialized).toEqual({
      $eq: [
        { $field: 'createdAt' },
        { $literal: 1700000000000 }, // Date encoded to timestamp, then wrapped in $literal by Convex
      ],
    })
  })

  it('non-codec fields serialize correctly through real filterBuilderImpl', async () => {
    const { filterBuilderImpl } = await import(
      '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
    )

    const wrapped = wrapFilterBuilder(filterBuilderImpl, userDocSchema)
    const expr = wrapped.eq(wrapped.field('name'), 'Alice')

    expect(expr.serialize()).toEqual({
      $eq: [
        { $field: 'name' },
        { $literal: 'Alice' },
      ],
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: PASS — the real Convex `ExpressionImpl` serializes the encoded values correctly.

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/__tests__/db.test.ts
git commit -m "test: add real Convex boundary test for filter encoding

Validates extractFieldPath and wrapFilterBuilder against actual
ExpressionImpl.serialize() behavior, not just mocks.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Types — `ZodvexExpression`, `ZodvexFilterBuilder`, filter overloads

**Files:**
- Modify: `packages/zodvex/src/db.ts` (add types + update filter method)
- Create: `packages/zodvex/typechecks/filter-builder.test-d.ts`

- [ ] **Step 1: Add type definitions to `db.ts`**

Add the `FieldPaths` import at the top of `packages/zodvex/src/db.ts` (line 1-23). Add `FieldPaths` to the existing import block:

```typescript
import type {
  DocumentByInfo,
  ExpressionOrValue,
  FieldPaths,             // ← ADD THIS
  FieldTypeFromFieldPath,
  FilterBuilder,
  // ... rest unchanged
} from 'convex/server'
```

Also add `NumericValue` import from `convex/values`:

```typescript
import type { GenericId, NumericValue } from 'convex/values'
```

Then add the type definitions after the existing `ZodvexUpperBoundBuilder` interface (after line ~114, before `encodeIndexValue`):

```typescript
// ============================================================================
// Filter builder types — decoded-aware replacements for Convex's FilterBuilder
// ============================================================================

/**
 * Opaque expression type for decoded-aware filter builders.
 * Drops Convex's `T extends Value | undefined` constraint so codec
 * fields can carry decoded types (e.g., Date instead of number).
 * At runtime, these are Convex ExpressionImpl instances — the type
 * is erased and only serves the type checker.
 */
declare const _zodvexExpr: unique symbol
export type ZodvexExpression<T> = { readonly [_zodvexExpr]: T }
export type ZodvexExpressionOrValue<T> = ZodvexExpression<T> | T

/**
 * Decoded-aware filter builder. Parallel to Convex's FilterBuilder with the
 * same method names and call patterns, but using ZodvexExpression (unconstrained)
 * instead of Convex's Expression (constrained to Value | undefined).
 *
 * NOT a drop-in substitute for FilterBuilder — the two are structurally
 * incompatible due to different expression brands. The compatibility story
 * lives at the .filter() overload boundary on ZodvexQueryChain.
 */
export interface ZodvexFilterBuilder<
  TableInfo extends GenericTableInfo,
  Doc = DocumentByInfo<TableInfo>
> {
  field<FP extends FieldPaths<TableInfo>>(
    fieldPath: FP
  ): ZodvexExpression<ZodvexIndexFieldValue<DocumentByInfo<TableInfo>, Doc, FP>>

  eq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  neq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>

  and(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  or(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  not(x: ZodvexExpressionOrValue<boolean>): ZodvexExpression<boolean>

  add<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  sub<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  mul<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  div<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  mod<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  neg<T extends NumericValue>(x: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
}
```

- [ ] **Step 2: Update `ZodvexQueryChain.filter()` with overloads**

In `packages/zodvex/src/db.ts`, replace the `filter` method at lines 251-255:

```typescript
  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.filter(predicate))
  }
```

with:

```typescript
  // Overload 1: decoded-aware predicate (tried first)
  filter(
    predicate: (q: ZodvexFilterBuilder<TableInfo, Doc>) => ZodvexExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc>
  // Overload 2: Convex-native predicate (backwards compatible)
  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc>
  // Implementation
  filter(predicate: any): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedPredicate = (q: any) => predicate(wrapFilterBuilder(q, this.schema))
    return this.createChain(this.inner.filter(wrappedPredicate))
  }
```

- [ ] **Step 3: Write type tests**

Create `packages/zodvex/typechecks/filter-builder.test-d.ts`:

```typescript
import type {
  DocumentByInfo,
  ExpressionOrValue,
  FieldPaths,
  FilterBuilder,
  GenericTableInfo,
} from 'convex/server'
import type { ZodvexExpression, ZodvexExpressionOrValue, ZodvexFilterBuilder } from '../src/db'
import type { ZodvexIndexFieldValue } from '../src/db'
import type { Equal, Expect } from './test-helpers'

// --- Mock table types for testing ---
// Simulates a table with a zx.date() codec field (createdAt) and a string field (name)
type MockDoc = { _id: string; _creationTime: number; name: string; createdAt: number }
type MockDecodedDoc = { _id: string; _creationTime: number; name: string; createdAt: Date }
type MockTableInfo = {
  document: MockDoc
  fieldPaths: keyof MockDoc
  indexes: {}
  searchIndexes: {}
  vectorIndexes: {}
}

type QB = ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>

// --- Test 1: ZodvexIndexFieldValue resolves decoded type for codec fields ---
type _T1 = Expect<Equal<
  ZodvexIndexFieldValue<MockDoc, MockDecodedDoc, 'createdAt'>,
  Date
>>

// --- Test 2: field() returns ZodvexExpression with wire type for non-codec fields ---
type _T2 = Expect<Equal<
  ZodvexIndexFieldValue<MockDoc, MockDecodedDoc, 'name'>,
  string
>>

// --- Test 3: eq() returns ZodvexExpression<boolean> ---
// (validated structurally — eq's return type should carry boolean)
type EqReturn = ReturnType<QB['eq']>
type _T3 = Expect<Equal<EqReturn, ZodvexExpression<boolean>>>

// --- Test 4: and() returns ZodvexExpression<boolean> ---
type AndReturn = ReturnType<QB['and']>
type _T4 = Expect<Equal<AndReturn, ZodvexExpression<boolean>>>
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`

Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun test`

Expected: same pass count + new filter tests, same pre-existing failures.

- [ ] **Step 6: Lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/zodvex/src/db.ts packages/zodvex/typechecks/filter-builder.test-d.ts
git commit -m "feat: add ZodvexExpression, ZodvexFilterBuilder types + filter overloads

ZodvexExpression<T> drops Value constraint for decoded types.
ZodvexFilterBuilder provides decoded-aware field() types.
.filter() overloads accept both Convex-native and decoded-aware predicates.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Schema-derived helper types

**Files:**
- Modify: `packages/zodvex/src/schema.ts`
- Modify: `packages/zodvex/src/server/index.ts`

- [ ] **Step 1: Add helper types to `schema.ts`**

Add at the end of `packages/zodvex/src/schema.ts`, after the `defineZodSchema` function:

```typescript
// ============================================================================
// Schema-derived helper types
// ============================================================================

import type {
  DataModelFromSchemaDefinition,
  NamedTableInfo,
  TableNamesInDataModel,
} from 'convex/server'
import type { ZodvexFilterBuilder } from './db'

/** Extract the DataModel from a defineZodSchema result */
export type InferDataModel<Schema extends ReturnType<typeof defineZodSchema>> =
  DataModelFromSchemaDefinition<Schema>

/** Extract TableInfo for a specific table */
export type InferTableInfo<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = NamedTableInfo<InferDataModel<Schema>, TableName>

/** Extract the decoded document type for a specific table */
export type InferDecodedDoc<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = Schema extends { __decodedDocs: infer DD }
  ? TableName extends keyof DD ? DD[TableName] : never
  : never

/** A ZodvexFilterBuilder typed for a specific table */
export type InferFilterBuilder<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = ZodvexFilterBuilder<
  InferTableInfo<Schema, TableName>,
  InferDecodedDoc<Schema, TableName>
>
```

Note: The `convex/server` imports may need to be moved to the top of the file if there is an existing import block from `convex/server`. Check the file's existing imports first.

- [ ] **Step 2: Export from `server/index.ts`**

Add to `packages/zodvex/src/server/index.ts` in the schema re-export section (line ~55):

The `export * from '../schema'` at line 55 already barrel-exports everything from schema.ts. Since the new types are exported from schema.ts, they will automatically be available via `zodvex/server`. Verify this is the case — if schema.ts uses named exports for the helpers, they should flow through.

No changes needed if `export * from '../schema'` is already present.

- [ ] **Step 3: Verify server-only export (NOT from core)**

Check that `packages/zodvex/src/core/index.ts` does NOT re-export the `Infer*` types. The core entry has `export type { ZodTableMap, ZodTableSchemas } from '../schema'` (named type exports only). The new `Infer*` types are also type-only exports, but they depend on `convex/server` types (`DataModelFromSchemaDefinition`, etc.) which are NOT available from `zodvex/core`.

Verify: `bun run type-check` should pass. If the core entry point somehow pulls in the `Infer*` types and their `convex/server` dependencies, the `zodvex/core has no server runtime imports` test would catch it. But since these are type-only exports and schema.ts is only re-exported as types from core, this should be safe.

- [ ] **Step 4: Run type-check and tests**

Run: `bun run type-check && bun test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/src/schema.ts packages/zodvex/src/server/index.ts
git commit -m "feat: add schema-derived helper types for reusable filter predicates

InferDataModel, InferTableInfo, InferDecodedDoc, InferFilterBuilder
enable typed reusable filter helpers without manual generic threading.
Exported via zodvex/server only (not core — depends on convex/server).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Example app coverage

**Files:**
- Modify: `examples/task-manager/convex/users.ts` (or create a new query file)

- [ ] **Step 1: Add filter usage examples**

Add filter examples to the example app. Check what query files exist in `examples/task-manager/convex/` and add to the most appropriate file (likely `users.ts` if it has queries, or create `filters.ts`):

```typescript
import { z } from 'zod'
import type { FilterBuilder, GenericTableInfo } from 'convex/server'
import type { InferFilterBuilder } from 'zodvex/server'
import { zx } from 'zodvex/core'
import { zq } from './functions'
import schema from './schema'

// --- Inline filter — no manual generics ---
// Users table has createdAt: zx.date() — the filter accepts Date directly
export const recentUsers = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(q => q.gte(q.field('createdAt'), after))
      .collect()
  },
})

// --- Reusable helper with schema-derived type ---
type UsersFilter = InferFilterBuilder<typeof schema, 'users'>

const createdAfter = (q: UsersFilter, date: Date) =>
  q.gte(q.field('createdAt'), date)

export const recentUsersWithHelper = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(q => createdAfter(q, after))
      .collect()
  },
})

// --- Chained filters mixing legacy + decoded-aware ---
// Legacy helper uses Convex's FilterBuilder — works on any table with a 'name' field
const hasName = <T extends GenericTableInfo>(q: FilterBuilder<T>) =>
  q.neq(q.field('name' as any), null)

export const namedRecentUsers = zq({
  args: { after: zx.date() },
  handler: async (ctx, { after }) => {
    return await ctx.db
      .query('users')
      .filter(hasName)                                                // Convex-native overload
      .filter(q => q.gte(q.field('createdAt'), after))                // decoded-aware overload
      .collect()
  },
})
```

- [ ] **Step 2: Type-check the example app**

Run: `cd examples/task-manager && npx tsc --noEmit`

If this doesn't work cleanly due to other pre-existing issues, just verify the library type-check passes.

- [ ] **Step 3: Commit**

```bash
git add examples/task-manager/convex/
git commit -m "feat(example): add filter encoding usage examples

Demonstrates inline filters, schema-derived reusable helpers,
and chained legacy + decoded-aware filter composition.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full type-check**

Run: `bun run type-check`

Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun test`

Expected: all existing tests pass + new filter tests

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 4: Build**

Run: `bun run build`

Expected: PASS
