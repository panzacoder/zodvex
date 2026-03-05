# withIndex Codec Encoding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-encode comparison values in `.withIndex()` and `.withSearchIndex()` callbacks so users can pass decoded/runtime types (e.g., `Date`) instead of wire types (e.g., `number`).

**Architecture:** Custom builder interfaces (`ZodvexIndexRangeBuilder`, `ZodvexSearchFilterFinalizer`) mirror Convex's builder chain but use decoded types for top-level codec fields and wire types for dot-paths. A Proxy-based runtime wrapper intercepts `.eq()/.gt()/.lt()/.gte()/.lte()` and encodes values through the field's Zod schema before forwarding to Convex's real builder.

**Tech Stack:** TypeScript (type-level builder interfaces), Zod v4 (`z.encode()`), ES Proxy (runtime wrapping), convex-test + vitest (integration tests)

---

### Task 0: Set up convex-test integration tests in the example project

The make-or-break for this feature is that codec-indexed queries actually work against a real Convex runtime. Mock-based unit tests prove our Proxy works, but only convex-test proves Convex accepts the encoded values.

**Files:**
- Modify: `examples/task-manager/package.json` (add convex-test, vitest, @edge-runtime/vm)
- Create: `examples/task-manager/vitest.config.ts`
- Modify: `examples/task-manager/convex/models/task.ts` (add `by_created` index on `createdAt`)
- Create: `examples/task-manager/convex/withIndex.test.ts`

**Step 1: Install dependencies**

Run from `examples/task-manager/`:

```bash
cd examples/task-manager && bun add -d convex-test vitest @edge-runtime/vm
```

**Step 2: Create vitest config**

Create `examples/task-manager/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
  },
});
```

**Step 3: Add a `by_created` index to TaskModel**

In `examples/task-manager/convex/models/task.ts`, add a new index on the `createdAt` codec field:

```ts
export const TaskModel = defineZodModel('tasks', taskFields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_assignee', ['assigneeId'])
  .index('by_created', ['createdAt'])
```

This gives us a direct top-level index on a `zx.date()` codec field — the primary case we need to validate.

**Step 4: Write the failing integration tests**

Create `examples/task-manager/convex/withIndex.test.ts`:

```ts
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("withIndex codec encoding", () => {
  test("query tasks by createdAt using Date (top-level codec field)", async () => {
    const t = convexTest(schema, modules);

    // Create a user first (tasks require ownerId)
    const userId = await t.mutation(api.users.create, {
      name: "Alice",
      email: "alice@example.com",
    });

    // Create a task — createdAt is set to new Date() inside the handler
    const taskId = await t.mutation(api.tasks.create, {
      title: "Test task",
      ownerId: userId,
    });

    // Verify the task was created and createdAt is decoded to Date
    const task = await t.query(api.tasks.get, { id: taskId });
    expect(task).not.toBeNull();
    expect(task!.createdAt).toBeInstanceOf(Date);

    // Query by createdAt using the by_created index with a Date range
    // This is the critical test: .withIndex('by_created', q => q.gte('createdAt', date))
    // must encode the Date to a number before Convex sees it
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("tasks")
        .withIndex("by_created", (q) =>
          q.gte("createdAt", new Date(0)) // all tasks after epoch
        )
        .collect();
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // The result should be decoded (Date, not number)
    expect(results[0].createdAt).toBeInstanceOf(Date);
  });

  test("query users by email.value (dot-path into codec, pass-through)", async () => {
    const t = convexTest(schema, modules);

    // Create a user
    await t.mutation(api.users.create, {
      name: "Bob",
      email: "bob@example.com",
    });

    // Query by email.value — dot-path, should pass through unchanged
    const user = await t.query(api.users.getByEmail, {
      email: { value: "bob@example.com", tag: "work", displayValue: "[work] bob@example.com" },
    });

    expect(user).not.toBeNull();
    expect(user!.name).toBe("Bob");
  });
});
```

**Important:** The `t.run()` test uses the raw `ctx.db` which is the zodvex-wrapped DB. This directly exercises `ZodvexQueryChain.withIndex()` with a Date value. If encoding doesn't work, Convex will reject the Date object and the test will error.

The `getByEmail` test exercises the dot-path case via the existing query function.

**Step 5: Run tests to verify they fail**

Run: `cd examples/task-manager && bunx vitest run`

Expected: The `by_created` test should fail because `withIndex` currently passes the Date through to Convex without encoding, and Convex will reject it (expects a number for the indexed field).

The `email.value` test may or may not fail — it depends on whether the existing pass-through works with convex-test's mock runtime.

**Step 6: Add test script to package.json**

In `examples/task-manager/package.json`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 7: Commit**

```
test(example): add convex-test integration tests for withIndex encoding

Sets up convex-test + vitest in the example project. Adds a by_created
index on tasks.createdAt (zx.date() codec field) and integration tests
that exercise .withIndex() with Date values and dot-path codec fields.

These tests are expected to fail until the encoding implementation lands.
```

---

### Task 1: Add `encodeIndexValue` and `wrapIndexRangeBuilder` runtime helpers

**Files:**
- Modify: `packages/zodvex/src/db.ts:1-26` (add import for `z`)
- Modify: `packages/zodvex/src/db.ts` (add helpers before class definition, around line 27)
- Test: `packages/zodvex/__tests__/db.test.ts`

**Step 1: Write the failing tests**

Add a new `describe('withIndex encoding')` block at the end of `packages/zodvex/__tests__/db.test.ts`. These tests exercise the runtime encoding via the `ZodvexQueryChain.withIndex()` path. The mock needs to capture what values are passed to `.eq()` etc.

```ts
// Add at the end of db.test.ts

/**
 * Mock query chain that captures withIndex callback args.
 * Unlike the basic mock, this one records what .eq()/.gt()/.lt() receive.
 */
function createIndexCapturingMockQuery(docs: any[]) {
  const captured: { method: string; field: string; value: any }[] = []

  const mockIndexBuilder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop as string)) {
          return (fieldName: string, value: any) => {
            captured.push({ method: prop as string, field: fieldName, value })
            return mockIndexBuilder // chainable
          }
        }
        return undefined
      }
    }
  )

  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: (_name: string, rangeFn?: (q: any) => any) => {
      if (rangeFn) rangeFn(mockIndexBuilder)
      return mockQuery
    },
    withSearchIndex: (_name: string, filterFn?: (q: any) => any) => {
      if (filterFn) filterFn(mockIndexBuilder)
      return mockQuery
    },
    order: () => mockQuery,
    filter: () => mockQuery,
    limit: () => mockQuery,
    first: async () => docs[0] ?? null,
    unique: async () => docs[0] ?? null,
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({ page: docs, isDone: true, continueCursor: 'cursor' }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    }
  }

  return { mockQuery, captured }
}

describe('withIndex encoding', () => {
  const wireDocs = [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }
  ]

  it('encodes a Date value to timestamp for a top-level codec field via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .withIndex('byDate' as any, (q: any) => q.eq('createdAt', new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('createdAt')
    expect(captured[0].value).toBe(1700000000000) // encoded: Date → number
  })

  it('passes through non-codec field values unchanged via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .withIndex('byName' as any, (q: any) => q.eq('name', 'Alice'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('Alice') // string → string (identity)
  })

  it('passes through dot-path values unchanged (wire sub-field)', async () => {
    // Schema with an object codec (simulating sensitive() from hotpot)
    const objectCodecDocSchema = z.object({
      _id: z.string(),
      _creationTime: z.number(),
      email: zodvexCodec(
        z.object({ value: z.string(), encrypted: z.string() }),
        z.custom<{ expose: () => string }>(() => true),
        {
          decode: (wire: any) => ({ expose: () => wire.value }),
          encode: (rt: any) => ({ value: rt.expose(), encrypted: 'enc' })
        }
      )
    })

    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, objectCodecDocSchema)

    await chain
      .withIndex('byEmail' as any, (q: any) => q.eq('email.value', 'alice@example.com'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('alice@example.com') // string passes through
  })

  it('encodes values through .gt(), .gte(), .lt(), .lte()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    const start = new Date(1700000000000)
    const end = new Date(1700100000000)

    await chain
      .withIndex('byDate' as any, (q: any) =>
        q.gte('createdAt', start).lt('createdAt', end)
      )
      .first()

    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual({ method: 'gte', field: 'createdAt', value: 1700000000000 })
    expect(captured[1]).toEqual({ method: 'lt', field: 'createdAt', value: 1700100000000 })
  })

  it('passes through when no indexRange callback is provided', async () => {
    const { mockQuery } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    // Should not throw — undefined callback is valid
    const result = await chain.withIndex('byName' as any).first()
    expect(result).not.toBeNull()
  })
})
```

You will also need to add `zodvexCodec` to the imports at the top of the test file:

```ts
import { zodvexCodec } from '../src/codec'
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: The "encodes a Date value" test should fail because `captured[0].value` will be a `Date` object (not yet encoded to number), since `withIndex` currently passes the callback through without wrapping.

**Step 3: Implement `encodeIndexValue` and `wrapIndexRangeBuilder` in db.ts**

Add the following to `packages/zodvex/src/db.ts`, after the imports and before the `ZodvexQueryChain` class (around line 27):

```ts
import { z } from 'zod'
```

Change the existing `import type { z } from 'zod'` (line 23) to the runtime import above, since we now need `z.encode()` and `z.ZodObject` at runtime.

Then add these helpers before the class:

```ts
/**
 * Encodes a comparison value for an index field through its Zod schema.
 *
 * - Top-level fields: encoded through their schema (codec fields transform,
 *   non-codec fields are identity).
 * - Dot-paths: pass through unchanged (they target wire-format sub-fields
 *   where the comparison value is already the correct primitive type).
 */
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value
  // Top-level: encode through the field's schema
  if (schema instanceof z.ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }
  return value
}

/**
 * Wraps a Convex IndexRangeBuilder (or any builder with eq/gt/gte/lt/lte methods)
 * with automatic value encoding. Each comparison method encodes its value through
 * the table's doc schema before forwarding to the real builder.
 *
 * Returns another wrapped builder so chained calls (e.g., .eq().gte().lt()) are
 * all encoded.
 */
function wrapIndexRangeBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop)) {
        return (fieldName: string, value: any) => {
          const encoded = encodeIndexValue(schema, fieldName, value)
          const result = target[prop](fieldName, encoded)
          // The result is another builder (or IndexRange) — wrap it too
          // so chained calls like .eq().gte().lt() are all encoded.
          return wrapIndexRangeBuilder(result, schema)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}
```

**Step 4: Update `ZodvexQueryChain.withIndex()` to wrap the callback**

Replace the current `withIndex` method (lines 69-76) with:

```ts
  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    indexRange?: (
      q: IndexRangeBuilder<DocumentByInfo<TableInfo>, NamedIndex<TableInfo, IndexName>>
    ) => IndexRange
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedRange = indexRange
      ? (q: any) => indexRange(wrapIndexRangeBuilder(q, this.schema))
      : undefined
    return this.createChain(this.inner.withIndex(indexName, wrappedRange))
  }
```

Note: we keep the TYPE signature unchanged for now — Convex's `IndexRangeBuilder` types. The custom decoded types are Task 2.

**Step 5: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: All tests pass, including the new `withIndex encoding` tests.

**Step 6: Commit**

```
feat(db): add runtime encoding for withIndex comparison values

Wraps Convex's IndexRangeBuilder with a Proxy that encodes values
through the field's Zod schema before forwarding. Top-level codec
fields (e.g., zx.date()) are transformed; dot-paths and non-codec
fields pass through unchanged.
```

---

### Task 2: Add custom builder type interfaces

**Files:**
- Modify: `packages/zodvex/src/db.ts` (add type definitions after imports)

**Step 1: Add the `ZodvexIndexFieldValue` path resolution type and builder interfaces**

Add after the imports in `db.ts`, before the `encodeIndexValue` function:

```ts
import type {
  DocumentByInfo,
  ExpressionOrValue,
  FieldTypeFromFieldPath,
  FilterBuilder,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericDataModel,
  GenericDocument,
  GenericIndexFields,
  GenericTableInfo,
  IndexNames,
  IndexRange,
  NamedIndex,
  NamedSearchIndex,
  NamedTableInfo,
  PaginationOptions,
  PaginationResult,
  SearchFilter,
  SearchFilterBuilder,
  SearchIndexNames,
  TableNamesInDataModel
} from 'convex/server'
```

Note: `FieldTypeFromFieldPath`, `GenericDocument`, and `GenericIndexFields` are new imports needed for the builder types. Update the existing `import type` block to include them.

Then add these types:

```ts
// ============================================================================
// Index builder types — decoded-aware replacements for Convex's IndexRangeBuilder
// ============================================================================

/**
 * Resolves the accepted value type for an index field comparison.
 *
 * - Dot-paths (e.g., "email.value"): resolve through the wire document,
 *   since dot-paths navigate into wire-format sub-structures.
 * - Top-level fields present in DecodedDoc: use the decoded (runtime) type,
 *   so codec fields accept decoded values (e.g., Date instead of number).
 * - Everything else: fall back to wire type via FieldTypeFromFieldPath.
 */
type ZodvexIndexFieldValue<
  WireDoc extends GenericDocument,
  DecodedDoc,
  FieldPath extends string
> = FieldPath extends `${string}.${string}`
  ? FieldTypeFromFieldPath<WireDoc, FieldPath>
  : FieldPath extends keyof DecodedDoc
    ? DecodedDoc[FieldPath]
    : FieldTypeFromFieldPath<WireDoc, FieldPath>

/** Increments a numeric type literal by 1 (up to 15). Mirrors Convex's internal PlusOne. */
type PlusOne<N extends number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15][N]

/**
 * Decoded-aware index range builder. Mirrors Convex's IndexRangeBuilder but uses
 * ZodvexIndexFieldValue for comparison value types, so codec fields accept
 * decoded/runtime types (e.g., Date) instead of requiring wire types (e.g., number).
 */
export interface ZodvexIndexRangeBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number = 0
> extends ZodvexLowerBoundBuilder<WireDoc, DecodedDoc, IndexFields[FieldNum]> {
  eq(
    fieldName: IndexFields[FieldNum],
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFields[FieldNum]>
  ): ZodvexNextBuilder<WireDoc, DecodedDoc, IndexFields, FieldNum>
}

/** After .eq(), either another ZodvexIndexRangeBuilder (more fields) or IndexRange (done). */
type ZodvexNextBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number
> = PlusOne<FieldNum> extends IndexFields['length']
  ? IndexRange
  : ZodvexIndexRangeBuilder<WireDoc, DecodedDoc, IndexFields, PlusOne<FieldNum>>

/** Lower bound builder with decoded-aware value types. */
export interface ZodvexLowerBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName> {
  gt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
  gte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
}

/** Upper bound builder with decoded-aware value types. */
export interface ZodvexUpperBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends IndexRange {
  lt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
  lte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
}
```

**Step 2: Update `ZodvexQueryChain.withIndex()` type signature to use the new builder**

Replace the `withIndex` type signature to use `ZodvexIndexRangeBuilder`:

```ts
  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    indexRange?: (
      q: ZodvexIndexRangeBuilder<
        DocumentByInfo<TableInfo>,
        Doc,
        NamedIndex<TableInfo, IndexName>
      >
    ) => IndexRange
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedRange = indexRange
      ? (q: any) => indexRange(wrapIndexRangeBuilder(q, this.schema))
      : undefined
    return this.createChain(this.inner.withIndex(indexName, wrappedRange))
  }
```

**Step 3: Run type-check and tests**

Run: `bun run type-check && bun test packages/zodvex/__tests__/db.test.ts`

Expected: Type check passes. All tests pass. The `IndexRangeBuilder` import may now be unused — remove it from the import block if so.

**Step 4: Commit**

```
feat(db): add decoded-aware ZodvexIndexRangeBuilder types

Custom builder interfaces that use decoded types for top-level codec
fields and wire types for dot-paths. Replaces Convex's IndexRangeBuilder
in the ZodvexQueryChain.withIndex() signature.
```

---

### Task 3: Add `withSearchIndex` encoding

**Files:**
- Modify: `packages/zodvex/src/db.ts:78-85` (update `withSearchIndex`)
- Test: `packages/zodvex/__tests__/db.test.ts`

**Step 1: Write the failing test**

Add to the `withIndex encoding` describe block in `db.test.ts`:

```ts
  it('encodes values in withSearchIndex .eq() filter fields', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)

    // Reuse the mockIndexBuilder pattern — withSearchIndex's builder also has .eq()
    // The mock's withSearchIndex passes the builder to the filterFn
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .withSearchIndex('search' as any, (q: any) =>
        q.search('name', 'Alice').eq('createdAt', new Date(1700000000000))
      )
      .first()

    // .search() doesn't get captured (not an eq/gt/lt method), but .eq() does
    expect(captured.some((c: any) => c.method === 'eq' && c.value === 1700000000000)).toBe(true)
  })
```

Note: The mock's `withSearchIndex` already passes the builder to the callback (from the mock in Task 1). The mock builder's `.search()` returns itself, and `.eq()` captures + returns itself. This test verifies the Proxy wrapping works for search filter builders too.

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: FAIL — `.eq()` value will be a `Date` object, not a number.

**Step 3: Update `withSearchIndex` to wrap the callback**

In `db.ts`, update the `withSearchIndex` method (lines 78-85). The search filter builder has `.search()` (which returns a finalizer) and `.eq()` (on the finalizer). The same `wrapIndexRangeBuilder` Proxy works because it intercepts `eq` (which SearchFilterFinalizer has) and passes through `search` (which it doesn't intercept).

```ts
  withSearchIndex<IndexName extends SearchIndexNames<TableInfo>>(
    indexName: IndexName,
    searchFilter: (
      q: SearchFilterBuilder<DocumentByInfo<TableInfo>, NamedSearchIndex<TableInfo, IndexName>>
    ) => SearchFilter
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedFilter = (q: any) => searchFilter(wrapIndexRangeBuilder(q, this.schema))
    return this.createChain(this.inner.withSearchIndex(indexName, wrappedFilter))
  }
```

Note: `wrapIndexRangeBuilder` wraps any object by intercepting `eq/gt/gte/lt/lte`. For `SearchFilterBuilder`, `.search()` isn't intercepted (passes through), and the returned `SearchFilterFinalizer` is also wrapped (because the Proxy wraps the return value of any intercepted method, and `.search()` passes through to return the real finalizer — but we need the finalizer wrapped too).

Actually, `.search()` is NOT intercepted by the Proxy (it's not in the `['eq', 'gt', 'gte', 'lt', 'lte']` list), so it calls through to the real builder's `.search()` which returns the real `SearchFilterFinalizer`. But that finalizer is NOT wrapped.

We need to also intercept `.search()` to wrap its return value. Update `wrapIndexRangeBuilder`:

```ts
function wrapIndexRangeBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop)) {
        return (fieldName: string, value: any) => {
          const encoded = encodeIndexValue(schema, fieldName, value)
          const result = target[prop](fieldName, encoded)
          return wrapIndexRangeBuilder(result, schema)
        }
      }
      // Wrap .search() return value so SearchFilterFinalizer.eq() is encoded
      if (prop === 'search') {
        return (...args: any[]) => {
          const result = target.search(...args)
          return wrapIndexRangeBuilder(result, schema)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: All tests pass.

**Step 5: Commit**

```
feat(db): add encoding for withSearchIndex filter values

Extends the Proxy wrapper to also intercept .search() return values,
ensuring SearchFilterFinalizer.eq() encodes comparison values through
the field's codec schema.
```

---

### Task 4: Remove codec-index warning from `model.ts`

**Files:**
- Modify: `packages/zodvex/src/model.ts:21-40` (remove `isCodecField` function)
- Modify: `packages/zodvex/src/model.ts:276-291` (remove `warnCodecIndexFields` function)
- Modify: `packages/zodvex/src/model.ts:305-306` (remove call to `warnCodecIndexFields`)
- Modify: `packages/zodvex/__tests__/defineZodModel.test.ts:460-540` (update warning tests)

**Step 1: Update the warning tests to verify NO warning is emitted**

In `packages/zodvex/__tests__/defineZodModel.test.ts`, replace the four warning tests (lines ~460-540) with tests that verify warnings are NOT emitted:

```ts
  it('does not warn when indexing a codec field (encoding is now automatic)', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined)

    defineZodModel('events', {
      title: z.string(),
      startDate: zx.date()
    }).index('byDate', ['startDate'])

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not warn when indexing a dot-path into a codec field', () => {
    const customString = zodvexCodec(
      z.object({
        value: z.string().nullable(),
        status: z.enum(['full', 'hidden'])
      }),
      z.custom<{ _brand: 'CustomField' }>(() => true),
      {
        decode: (_wire: any) => ({ _brand: 'CustomField' as const }),
        encode: () => ({ value: null, status: 'full' as const })
      }
    )

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined)

    defineZodModel('patients', {
      clinicId: z.string(),
      email: customString
    })
      .index('byEmail', ['email'])
      .index('byEmailValue', ['email.value'])

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
```

**Step 2: Remove `isCodecField` and `warnCodecIndexFields` from model.ts**

In `packages/zodvex/src/model.ts`:

1. Remove the `isCodecField` function (lines 22-40) and its JSDoc comment (lines 21-25).
2. Remove the `warnCodecIndexFields` function (lines 276-291) from inside `defineZodModel`.
3. Remove the call to `warnCodecIndexFields(indexName, indexFields)` on line 306.

The `index()` method inside `createModel` should become simply:

```ts
      index(indexName: string, indexFields: readonly string[]) {
        return createModel(
          { ...indexes, [indexName]: [...indexFields, '_creationTime'] },
          searchIndexes,
          vectorIndexes
        )
      },
```

**Step 3: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/defineZodModel.test.ts && bun test packages/zodvex/__tests__/db.test.ts`

Expected: All tests pass. No codec-index warnings emitted.

**Step 4: Commit**

```
refactor(model): remove codec-index warnings

withIndex now auto-encodes comparison values through the field's Zod
schema, making the "must pass pre-encoded wire values" warning obsolete.
```

---

### Task 5: Full test suite + type-check + lint + integration tests

**Files:** None (verification only)

**Step 1: Run the library test suite**

Run: `bun test`

Expected: All tests pass (unit + mock-based withIndex encoding tests).

**Step 2: Run the convex-test integration tests**

Run: `cd examples/task-manager && bunx vitest run`

Expected: All integration tests pass — the `by_created` Date query and `email.value` dot-path query both succeed against convex-test's runtime. **This is the make-or-break moment:** if Convex accepts the encoded values and returns correct results, the feature works end-to-end.

**Step 3: Run type-check**

Run: `bun run type-check`

Expected: No errors. If there are errors related to unused imports (e.g., `IndexRangeBuilder` no longer used in `db.ts`), remove them.

**Step 4: Run lint**

Run: `bun run lint`

Expected: No lint errors. Fix any that arise.

**Step 5: Commit any fixes**

```
chore: fix lint/type-check issues from withIndex encoding
```

---

### Task 6: Update exports and verify public API

**Files:**
- Verify: `packages/zodvex/src/server/index.ts:31` (`export * from '../db'` already exports everything from db.ts)

**Step 1: Verify new types are exported**

The builder interfaces (`ZodvexIndexRangeBuilder`, `ZodvexLowerBoundBuilder`, `ZodvexUpperBoundBuilder`) are exported from `db.ts` via `export interface`. Since `server/index.ts` has `export * from '../db'`, they'll be available to consumers.

Run: `bun run build`

Expected: Build succeeds.

**Step 2: Verify the example project still compiles**

Run: `bun run type-check` from the repo root (this checks all workspaces).

If the example project uses `.withIndex()` with wire values, it should still work since the new types accept both wire AND decoded values (wire values are a valid decoded value for non-codec fields, and for codec fields the wire value still parses through `z.encode()`).

**Step 3: Commit if any changes**

```
chore: verify build and exports for withIndex encoding
```
