# Filter Codec Encoding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend codec encoding to `.filter()` with full type support via `ZodvexExpression<T>` and `ZodvexFilterBuilder`.

**Architecture:** Define `ZodvexExpression<T>` (unconstrained branded type) and `ZodvexFilterBuilder` (parallel to Convex's `FilterBuilder`). Proxy-based runtime encoding via `wrapFilterBuilder` reuses `encodeIndexValue`. Overloaded `.filter()` accepts both Convex-native and decoded-aware predicates. Schema-derived helper types (`InferFilterBuilder`, etc.) enable reusable filter helpers.

**Tech Stack:** TypeScript 5.x, Zod v4, Convex 1.28+, Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-17-filter-codec-encoding-design.md`

**Testing approach:** All runtime tests go through `ZodvexQueryChain.filter()` — the public API. No internal functions (`wrapFilterBuilder`, `extractFieldPath`) are exported or tested directly. This keeps the public API surface clean since `server/index.ts` does `export * from '../db'`. One test uses a real Convex `filterBuilderImpl` (passed to the predicate via a mock inner query) to validate the `$field` serialization contract.

---

## Task 0: Runtime — `extractFieldPath`, `wrapFilterBuilder`, and `.filter()` integration

**Files:**
- Modify: `packages/zodvex/src/db.ts` (add functions after `wrapIndexRangeBuilder` at ~line 163, update `filter()` method at lines 251-255)
- Modify: `packages/zodvex/__tests__/db.test.ts` (add tests after line 809)

### Step group A: Implementation

- [ ] **Step 1: Add `extractFieldPath` and `wrapFilterBuilder` to `db.ts`**

In `packages/zodvex/src/db.ts`, add after the `wrapIndexRangeBuilder` function (after line ~163). These are module-private functions — NOT exported.

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

- [ ] **Step 2: Update `ZodvexQueryChain.filter()` to use `wrapFilterBuilder`**

In `packages/zodvex/src/db.ts`, replace the `filter` method at lines 251-255:

```typescript
  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.filter(predicate))
  }
```

with (implementation only for now — overloads added in Task 2):

```typescript
  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedPredicate = (q: any) => predicate(wrapFilterBuilder(q, this.schema))
    return this.createChain(this.inner.filter(wrappedPredicate))
  }
```

### Step group B: Tests through `ZodvexQueryChain.filter()`

- [ ] **Step 3: Add filter-capturing mock query helper**

Add to `packages/zodvex/__tests__/db.test.ts` after the `withSearchIndex encoding` describe block (after line 809). This creates a mock query whose `filter()` passes a mock `filterBuilderImpl` to the predicate and captures what the proxy does:

```typescript
/**
 * Creates a mock query with a filter builder that simulates Convex's expression API.
 * field() returns objects with serialize() matching ExpressionImpl behavior.
 * Comparison methods capture their arguments AFTER any proxy encoding.
 */
function createFilterCapturingMockQuery(docs: any[]) {
  const captured: { method: string; left: any; right: any }[] = []

  function makeExpr(inner: any) {
    return {
      serialize: () => inner,
      _isExpression: undefined,
    }
  }

  const mockFilterBuilder: any = {
    field: (fieldPath: string) => makeExpr({ $field: fieldPath }),
    eq: (l: any, r: any) => { captured.push({ method: 'eq', left: l, right: r }); return makeExpr({ $eq: [l, r] }) },
    neq: (l: any, r: any) => { captured.push({ method: 'neq', left: l, right: r }); return makeExpr({ $neq: [l, r] }) },
    lt: (l: any, r: any) => { captured.push({ method: 'lt', left: l, right: r }); return makeExpr({ $lt: [l, r] }) },
    lte: (l: any, r: any) => { captured.push({ method: 'lte', left: l, right: r }); return makeExpr({ $lte: [l, r] }) },
    gt: (l: any, r: any) => { captured.push({ method: 'gt', left: l, right: r }); return makeExpr({ $gt: [l, r] }) },
    gte: (l: any, r: any) => { captured.push({ method: 'gte', left: l, right: r }); return makeExpr({ $gte: [l, r] }) },
    and: (...exprs: any[]) => makeExpr({ $and: exprs }),
    or: (...exprs: any[]) => makeExpr({ $or: exprs }),
    not: (x: any) => makeExpr({ $not: x }),
  }

  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: (_name: string, predicate?: any) => {
      // Convex's filter() takes a predicate callback and passes the filter builder to it
      // ZodvexQueryChain.filter() wraps this — it passes the predicate to inner.filter()
      // which calls predicate(filterBuilder). The proxy intercepts this.
      if (typeof _name === 'function') {
        _name(mockFilterBuilder)
      }
      return mockQuery
    },
    limit: () => mockQuery,
    first: async () => docs[0] ?? null,
    unique: async () => docs[0] ?? null,
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({ page: docs, isDone: true, continueCursor: 'cursor' }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    },
  }

  return { mockQuery, mockFilterBuilder, captured }
}
```

Note: The mock `filter()` receives the predicate function (not a string) because Convex's real `filter()` takes `(predicate: (q: FilterBuilder) => ExpressionOrValue<boolean>)`. The first parameter `_name` is actually the predicate callback.

- [ ] **Step 4: Write filter encoding tests**

Add to `packages/zodvex/__tests__/db.test.ts`:

```typescript
describe('filter encoding', () => {
  it('encodes a codec field (zx.date) via eq(field, value)', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('createdAt'), new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].left.serialize()).toEqual({ $field: 'createdAt' })
    expect(captured[0].right).toBe(1700000000000)
  })

  it('passes through non-codec field values unchanged', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('name'), 'Alice'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('Alice')
  })

  it('passes through dot-path values unchanged', async () => {
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

    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, objectCodecDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('email.value'), 'alice@example.com'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('alice@example.com')
  })

  it('encodes multiple comparisons inside and()', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) =>
        q.and(
          q.gte(q.field('createdAt'), new Date(1700000000000)),
          q.lt(q.field('createdAt'), new Date(1700100000000))
        )
      )
      .first()

    expect(captured).toHaveLength(2)
    expect(captured[0]).toMatchObject({ method: 'gte', right: 1700000000000 })
    expect(captured[1]).toMatchObject({ method: 'lt', right: 1700100000000 })
  })

  it('encodes discriminator literals on union schema', async () => {
    const unionDocSchema = z.discriminatedUnion('kind', [
      z.object({ _id: z.string(), _creationTime: z.number(), kind: z.literal('email'), createdAt: zx.date() }),
      z.object({ _id: z.string(), _creationTime: z.number(), kind: z.literal('push'), createdAt: zx.date() }),
    ])

    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('kind'), 'push'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('push')
  })

  it('encodes via neq()', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.neq(q.field('createdAt'), new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('neq')
    expect(captured[0].right).toBe(1700000000000)
  })

  it('does not intercept and/or/not', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => {
        const expr1 = q.eq(q.field('name'), 'Alice')
        const expr2 = q.eq(q.field('name'), 'Bob')
        return q.and(expr1, expr2)
      })
      .first()

    // Only the two eq() calls should be captured, not and()
    expect(captured).toHaveLength(2)
  })

  it('encodes reversed operand order (value, field)', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.eq(new Date(1700000000000), q.field('createdAt')))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].left).toBe(1700000000000)
    expect(captured[0].right.serialize()).toEqual({ $field: 'createdAt' })
  })

  it('passes through null for fields without a schema entry', async () => {
    // Use a schema where the queried field is not in the shape —
    // encodeIndexValue falls through to return value unchanged
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('unknownField'), null))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBeNull()
  })
})

describe('filter encoding — real Convex boundary', () => {
  it('encodes Date to timestamp through real filterBuilderImpl and produces valid serialized expression', async () => {
    // Use real Convex filterBuilderImpl via a mock inner query that passes it
    // to the predicate. This validates the $field serialization contract.
    const { filterBuilderImpl } = await import(
      // Dynamic import — relative to this test file's location in __tests__/
      '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
    )

    let capturedResult: any = null
    const mockQuery: any = {
      fullTableScan: () => mockQuery,
      withIndex: () => mockQuery,
      withSearchIndex: () => mockQuery,
      order: () => mockQuery,
      filter: (predicate: any) => {
        // Pass the REAL filterBuilderImpl — the proxy wraps it
        capturedResult = predicate(filterBuilderImpl)
        return mockQuery
      },
      limit: () => mockQuery,
      first: async () => null,
      unique: async () => null,
      collect: async () => [],
      take: async () => [],
      paginate: async () => ({ page: [], isDone: true, continueCursor: '' }),
      [Symbol.asyncIterator]: async function* () {},
    }

    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .filter((q: any) => q.eq(q.field('createdAt'), new Date(1700000000000)))
      .first()

    // The result is a real ExpressionImpl — verify its serialized form
    expect(capturedResult).toBeDefined()
    expect(capturedResult.serialize()).toEqual({
      $eq: [
        { $field: 'createdAt' },
        { $literal: 1700000000000 }, // Date encoded to timestamp, then $literal-wrapped by Convex
      ],
    })
  })
})
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: PASS — all filter encoding tests pass through `ZodvexQueryChain.filter()`.

- [ ] **Step 6: Commit**

```bash
git add packages/zodvex/src/db.ts packages/zodvex/__tests__/db.test.ts
git commit -m "feat: add filter codec encoding via wrapFilterBuilder proxy

Proxy intercepts eq/neq/lt/lte/gt/gte on FilterBuilder. When one arg
is a \$field expression and the other is a raw value, encodes through
encodeIndexValue. Internal functions not exported — tested through
ZodvexQueryChain.filter() public API.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Types — `ZodvexExpression`, `ZodvexFilterBuilder`, filter overloads

**Files:**
- Modify: `packages/zodvex/src/db.ts` (add types + update filter method with overloads)
- Create: `packages/zodvex/typechecks/filter-builder.test-d.ts`

- [ ] **Step 1: Add imports to `db.ts`**

Add `FieldPaths` to the existing `convex/server` import at lines 1-23:

```typescript
import type {
  DocumentByInfo,
  ExpressionOrValue,
  FieldPaths,             // ← ADD
  FieldTypeFromFieldPath,
  FilterBuilder,
  // ... rest unchanged
} from 'convex/server'
```

Add `NumericValue` to the `convex/values` import at line 24:

```typescript
import type { GenericId, NumericValue } from 'convex/values'
```

- [ ] **Step 2: Add type definitions to `db.ts`**

Add after the existing `ZodvexUpperBoundBuilder` interface (after line ~114, before `encodeIndexValue`):

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

- [ ] **Step 3: Update `filter()` with overloads**

Replace the `filter` method (updated in Task 0) with overloaded version:

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

- [ ] **Step 4: Write type tests**

Create `packages/zodvex/typechecks/filter-builder.test-d.ts`:

```typescript
import type {
  ExpressionOrValue,
  FilterBuilder,
} from 'convex/server'
import type {
  ZodvexExpression,
  ZodvexExpressionOrValue,
  ZodvexFilterBuilder,
  ZodvexQueryChain,
} from '../src/db'
import type { Equal, Expect } from './test-helpers'

// --- Mock table types for testing ---
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

// --- Test 1: eq() returns ZodvexExpression<boolean> ---
type _T1 = Expect<Equal<ReturnType<QB['eq']>, ZodvexExpression<boolean>>>

// --- Test 2: and() returns ZodvexExpression<boolean> ---
type _T2 = Expect<Equal<ReturnType<QB['and']>, ZodvexExpression<boolean>>>

// ============================================================================
// Call-site overload resolution tests
// These use actual call expressions to prove overloads resolve correctly.
// ============================================================================

declare const chain: ZodvexQueryChain<MockTableInfo, MockDecodedDoc>

// --- Test 3: Inline decoded-aware filter compiles WITHOUT annotation (overload 1) ---
// This is the core DX test — q's type is inferred from the overload, not annotated.
const _inlineDecoded = chain.filter(q => q.gte(q.field('createdAt'), new Date()))

// --- Test 4: Convex-native predicate compiles when passed directly (overload 2) ---
const isNamed = (q: FilterBuilder<MockTableInfo>) =>
  q.neq(q.field('name'), null)
const _nativeDirect = chain.filter(isNamed)

// --- Test 5: Chained filters — legacy then decoded-aware (no annotation) ---
const _chained = chain
  .filter(isNamed)
  .filter(q => q.gte(q.field('createdAt'), new Date()))

// --- Test 6: Mixed composition in single callback does NOT compile ---
// @ts-expect-error — isNamed expects FilterBuilder, but q is ZodvexFilterBuilder
const _mixedFail = chain.filter(
  (q: ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>) =>
    q.and(isNamed(q), q.gte(q.field('createdAt'), new Date()))
)

// --- Test 7: filter() returns ZodvexQueryChain (chainable) ---
type FilterReturn = typeof _inlineDecoded
type _T7 = Expect<Equal<FilterReturn, ZodvexQueryChain<MockTableInfo, MockDecodedDoc>>>

// --- Test 8: Type error for wrong value type ---
// @ts-expect-error — createdAt resolves to Date, "not-a-date" is string
const _wrongType = chain.filter(
  (q: ZodvexFilterBuilder<MockTableInfo, MockDecodedDoc>) =>
    q.eq(q.field('createdAt'), 'not-a-date')
)
```

- [ ] **Step 5: Run type-check**

Run: `bun run type-check`

Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`

Expected: all existing + filter tests pass.

- [ ] **Step 7: Lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/zodvex/src/db.ts packages/zodvex/typechecks/filter-builder.test-d.ts
git commit -m "feat: add ZodvexExpression, ZodvexFilterBuilder types + filter overloads

ZodvexExpression<T> drops Value constraint for decoded types.
ZodvexFilterBuilder provides decoded-aware field() types.
.filter() overloads accept both Convex-native and decoded-aware predicates.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Schema-derived helper types

**Files:**
- Modify: `packages/zodvex/src/schema.ts`

- [ ] **Step 1: Add helper types to `schema.ts`**

Add at the end of `packages/zodvex/src/schema.ts`, after the `defineZodSchema` function. Add the necessary imports to the existing `convex/server` import block at line 1:

```typescript
// Add to existing import at line 1:
import {
  defineSchema,
  defineTable,
  type DataModelFromSchemaDefinition,  // ← ADD
  type NamedTableInfo,                  // ← ADD
  type TableDefinition,
  type TableNamesInDataModel,           // ← ADD
} from 'convex/server'
```

Add the import for `ZodvexFilterBuilder` from `db.ts` (type-only, safe for the circular import since both sides are type-only):

```typescript
import type { ZodvexFilterBuilder } from './db'
```

Then add the helper types at the end of the file:

```typescript
// ============================================================================
// Schema-derived helper types
// ============================================================================

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

Note: `server/index.ts` already does `export * from '../schema'` at line 55, so these types will automatically be available via `zodvex/server`. The `core/index.ts` only re-exports `type { ZodTableMap, ZodTableSchemas }` from schema.ts (named type exports), so the new `Infer*` types will NOT leak to `zodvex/core`.

- [ ] **Step 2: Run type-check and tests**

Run: `bun run type-check && bun test`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/src/schema.ts
git commit -m "feat: add schema-derived helper types for reusable filter predicates

InferDataModel, InferTableInfo, InferDecodedDoc, InferFilterBuilder
enable typed reusable filter helpers without manual generic threading.
Exported via zodvex/server only (not core — depends on convex/server).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Example app coverage

**Files:**
- Create: `examples/task-manager/convex/filters.ts`

- [ ] **Step 1: Add filter usage examples**

Create `examples/task-manager/convex/filters.ts`:

```typescript
import type { FilterBuilder } from 'convex/server'
import type { InferFilterBuilder, InferTableInfo } from 'zodvex/server'
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
// Legacy helper typed against Convex's FilterBuilder for the users table.
// Uses InferTableInfo so the field paths are correctly constrained —
// no `as any` needed. This proves the overload compatibility story.
type UsersTableInfo = InferTableInfo<typeof schema, 'users'>

const hasName = (q: FilterBuilder<UsersTableInfo>) =>
  q.neq(q.field('name'), '')

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

- [ ] **Step 2: Type-check**

Run: `bun run type-check`

If the example app has its own tsconfig, also: `cd examples/task-manager && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add examples/task-manager/convex/filters.ts
git commit -m "feat(example): add filter encoding usage examples

Demonstrates inline filters, schema-derived reusable helpers,
and chained legacy + decoded-aware filter composition.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Final verification

- [ ] **Step 1: Run full type-check**

Run: `bun run type-check`

Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun test`

Expected: all existing tests pass + new filter encoding tests

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 4: Build**

Run: `bun run build`

Expected: PASS
