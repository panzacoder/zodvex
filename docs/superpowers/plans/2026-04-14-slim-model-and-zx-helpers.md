# Slim Model & zx Schema Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-model memory footprint by ~77 KB via on-demand `zx.*` schema helpers and a `schemaHelpers` flag on `defineZodModel`.

**Architecture:** Extract `ZodModelBase` as the internal constraint type (no `schema` property). Add `zx.doc()`, `zx.update()`, `zx.docArray()`, `zx.paginationResult()`, `zx.paginationOpts()` that derive schemas from `model.name` + `model.fields`. Refactor `defineZodSchema` internals to use helpers. Add a `schemaHelpers` flag to `defineZodModel` that selects between the current full bundle and a slim factory. Validate with stress test.

**Tech Stack:** TypeScript, Zod v4, Convex, vitest

**Spec:** `docs/superpowers/specs/2026-04-14-slim-model-and-zx-helpers-design.md`

---

## Revision Notes

**v3 (2026-04-14)** — Addresses union model, codegen, and mini findings:
1. **(High) Union models in zx helpers**: `ZxModelInput` now includes `schema` property. Helpers extract base schema from model for union models (`fields: {}`). `zx.update()` delegates to union-aware `createSchemaUpdateSchema`.
2. **(High) Task 7b compilation**: Removed async `import('zod')`, use `z` directly. `reconstructSchemas` uses `zx.*` helpers and `createSchemaUpdateSchema` for union-safe reconstruction. Pagination shape uses `zx.paginationResult()`.
3. **(Medium) Slim types for unions**: Split `SlimZodModel` into `SlimObjectModel` (concrete `z.ZodObject` doc) and `SlimUnionModel` (`AddSystemFieldsToUnion` doc). Overloads updated to return the correct type per input shape.
4. **(Medium) Mini slim types**: Mini entrypoint defines its own `SlimMiniObjectModel`/`SlimMiniUnionModel` using `ZodMiniObject` — does NOT import internal `SlimObjectModel`. Mini consumers use functional wrappers (`z.nullable(schema)`), not method chains.

**v2 (2026-04-14)** — Addresses code review findings:
1. **(High) Type-level schema.ts**: Added Task 3b for `ConvexTableFor` and `DecodedDocFor` slim model branches.
2. **(High) Codegen compatibility**: Added Task 7b for discovery/generation with slim models.
3. **(Medium) Concrete doc typing**: `SlimZodModel.doc` now carries `z.ZodObject<...>` not `$ZodType`. Updated Task 4.
4. **(Medium) Getters vs undefined**: Aligned on no throwing getters — `model.schema` is a bare `$ZodType`, so `.doc`/`.update` access returns `undefined` naturally. TS catches this at compile time. Updated Task 4 tests.
5. **(Open) Pagination shape**: Added Task 1b to unify existing `zPaginated`/`createPaginatedDocSchema` with the new `zx.paginationResult` shape.

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/zodvex/src/internal/zx.ts` | Modify | Add `doc()`, `update()`, `docArray()`, `paginationResult()`, `paginationOpts()` helpers |
| `packages/zodvex/src/internal/model.ts` | Modify | Extract `ZodModelBase`, add `SlimZodModel` (concrete doc type), add `schemaHelpers` option, slim factory |
| `packages/zodvex/src/internal/meta.ts` | Modify | Make `schemas` field on `ZodvexModelMeta` optional (slim models don't carry full bundle) |
| `packages/zodvex/src/internal/schema.ts` | Modify | Constrain against `ZodModelBase`, use `zx.*` helpers to build `zodTableMap` entries, add `ConvexTableFor`/`DecodedDocFor` branches for slim models |
| `packages/zodvex/src/internal/schema/runtimeHelpers.ts` | Modify | Unify `zPaginated` with `zx.paginationResult` shape |
| `packages/zodvex/src/internal/modelSchemaBundle.ts` | Modify | Unify `createPaginatedDocSchema` with `zx.paginationResult` shape |
| `packages/zodvex/src/public/index.ts` | No change | Already re-exports `zx` — new helpers auto-visible |
| `packages/zodvex/src/public/model.ts` | Modify | Export new types, update `SlimZodModel` overloads |
| `packages/zodvex/src/public/mini/model.ts` | Modify | Add slim model overloads matching new `schemaHelpers` option |
| `packages/zodvex/src/public/codegen/discover.ts` | Modify | Handle slim models (missing `meta.schemas`) by reconstructing from model object |
| `packages/zodvex/src/public/codegen/generate.ts` | Modify | Handle slim model access paths in identity map (`Model.doc` vs `Model.schema.doc`) |
| `packages/zodvex/__tests__/zx.test.ts` | Modify | Add tests for new `zx.*` helpers |
| `packages/zodvex/__tests__/defineZodModel.test.ts` | Modify | Add `schemaHelpers: false` tests |
| `packages/zodvex/__tests__/slim-model-schema.test.ts` | Create | Integration tests: slim model → defineZodSchema → DB wrapper round-trip |
| `packages/zodvex/__tests__/slim-model-codegen.test.ts` | Create | Codegen discovery/generation tests with slim models |
| `examples/stress-test/templates/zod/model-small-slim.ts.tmpl` | Create | Slim model template |
| `examples/stress-test/templates/zod/functions-shared-slim.ts.tmpl` | Create | Functions using `zx.*` helpers |
| `examples/stress-test/generate.ts` | Modify | Add `--slim` flag |

---

### Task 1: Add `zx.paginationResult()` and `zx.paginationOpts()`

These are standalone helpers with no model dependency — good warm-up that delivers immediate value.

**Files:**
- Modify: `packages/zodvex/src/internal/zx.ts`
- Modify: `packages/zodvex/__tests__/zx.test.ts`

- [ ] **Step 1: Write failing tests for `zx.paginationOpts()`**

In `packages/zodvex/__tests__/zx.test.ts`, add inside the `describe('zx namespace', ...)` block, after the existing `describe('integration: mixed zx and z types', ...)`:

```typescript
describe('zx.paginationOpts()', () => {
  it('creates a ZodObject with numItems and cursor fields', () => {
    const opts = zx.paginationOpts()
    const result = opts.safeParse({ numItems: 10, cursor: null })
    expect(result.success).toBe(true)
  })

  it('accepts full pagination options', () => {
    const opts = zx.paginationOpts()
    const result = opts.safeParse({
      numItems: 25,
      cursor: 'abc123',
      endCursor: null,
      id: 42,
      maximumRowsRead: 1000,
      maximumBytesRead: 8_000_000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required fields', () => {
    const opts = zx.paginationOpts()
    const result = opts.safeParse({})
    expect(result.success).toBe(false)
  })

  it('works with zodToConvex', () => {
    const opts = zx.paginationOpts()
    const validator = zodToConvex(opts)
    expect(validator).toEqual(
      v.object({
        numItems: v.float64(),
        cursor: v.union(v.string(), v.null()),
        endCursor: v.optional(v.union(v.string(), v.null())),
        id: v.optional(v.float64()),
        maximumRowsRead: v.optional(v.float64()),
        maximumBytesRead: v.optional(v.float64()),
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts -t "paginationOpts"`
Expected: FAIL — `zx.paginationOpts is not a function`

- [ ] **Step 3: Write failing tests for `zx.paginationResult()`**

Append to the same test file:

```typescript
describe('zx.paginationResult()', () => {
  it('wraps an item schema in a paginated response', () => {
    const itemSchema = z.object({ name: z.string() })
    const paginated = zx.paginationResult(itemSchema)
    const result = paginated.safeParse({
      page: [{ name: 'Alice' }],
      isDone: false,
      continueCursor: 'cursor_abc',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional splitCursor', () => {
    const itemSchema = z.object({ id: z.number() })
    const paginated = zx.paginationResult(itemSchema)
    const result = paginated.safeParse({
      page: [{ id: 1 }],
      isDone: true,
      continueCursor: 'done',
      splitCursor: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid page items', () => {
    const itemSchema = z.object({ name: z.string() })
    const paginated = zx.paginationResult(itemSchema)
    const result = paginated.safeParse({
      page: [{ wrong: 123 }],
      isDone: false,
      continueCursor: '',
    })
    expect(result.success).toBe(false)
  })

  it('works with zodToConvex', () => {
    const itemSchema = z.object({ title: z.string(), count: z.number() })
    const paginated = zx.paginationResult(itemSchema)
    const validator = zodToConvex(paginated)
    expect(validator).toEqual(
      v.object({
        page: v.array(v.object({ title: v.string(), count: v.float64() })),
        isDone: v.boolean(),
        continueCursor: v.string(),
        splitCursor: v.optional(v.union(v.string(), v.null())),
      })
    )
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts -t "paginationResult"`
Expected: FAIL — `zx.paginationResult is not a function`

- [ ] **Step 5: Implement `paginationOpts()` and `paginationResult()` in `zx.ts`**

In `packages/zodvex/src/internal/zx.ts`, add two functions before the `export const zx = { ... }` block:

```typescript
/**
 * Pagination options schema — matches Convex's PaginationOptions type.
 *
 * Use as `args` in paginated queries.
 *
 * @example
 * ```typescript
 * export const listUsers = zq({
 *   args: { paginationOpts: zx.paginationOpts() },
 *   handler: async (ctx, { paginationOpts }) => {
 *     return await ctx.db.query('users').paginate(paginationOpts)
 *   },
 *   returns: zx.paginationResult(UserModel.doc),
 * })
 * ```
 */
function paginationOpts() {
  return z.object({
    numItems: z.number(),
    cursor: z.string().nullable(),
    endCursor: z.string().nullable().optional(),
    id: z.number().optional(),
    maximumRowsRead: z.number().optional(),
    maximumBytesRead: z.number().optional(),
  })
}

/**
 * Paginated result schema — wraps any item schema in Convex's PaginationResult shape.
 *
 * @param itemSchema - The Zod schema for each page item (typically `model.doc` or `zx.doc(model)`)
 *
 * @example
 * ```typescript
 * export const listUsers = zq({
 *   returns: zx.paginationResult(UserModel.doc),
 *   handler: async (ctx, args) => { ... },
 * })
 * ```
 */
function paginationResult<T extends $ZodType>(itemSchema: T) {
  return z.object({
    page: z.array(itemSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
  })
}
```

Then update the `zx` export object to include the new helpers:

```typescript
export const zx = {
  date,
  id,
  codec,
  paginationOpts,
  paginationResult,
} as const
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/zodvex/src/internal/zx.ts packages/zodvex/__tests__/zx.test.ts
git commit -m "feat: add zx.paginationResult() and zx.paginationOpts() helpers"
```

---

### Task 1b: Unify existing pagination shapes with `zx.paginationResult`

The existing `zPaginated` and `createPaginatedDocSchema` use `continueCursor: optional(nullable(string))`. The new `zx.paginationResult` uses `continueCursor: string` + `splitCursor: optional(nullable(string))`, matching Convex's actual `PaginationResult` type. Unify them.

**Files:**
- Modify: `packages/zodvex/src/internal/schema/runtimeHelpers.ts`
- Modify: `packages/zodvex/src/internal/modelSchemaBundle.ts`
- Modify: `packages/zodvex/src/public/model.ts` (the `FullPaginatedShape` type)
- Modify: `packages/zodvex/src/public/mini/model.ts` (the `MiniModelSchemas` paginatedDoc type)

- [ ] **Step 1: Update `zPaginated` in `runtimeHelpers.ts`**

Change `packages/zodvex/src/internal/schema/runtimeHelpers.ts`:

```typescript
export function zPaginated<T extends $ZodType>(item: T) {
  return z.object({
    page: z.array(item),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
  })
}
```

- [ ] **Step 2: Update `createPaginatedDocSchema` in `modelSchemaBundle.ts`**

Change `packages/zodvex/src/internal/modelSchemaBundle.ts`:

```typescript
export function createPaginatedDocSchema(docSchema: $ZodType): z.ZodObject<any> {
  return z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
  })
}
```

- [ ] **Step 3: Update `FullPaginatedShape` type in `public/model.ts`**

Change the `FullPaginatedShape` type:

```typescript
type FullPaginatedShape<Name extends string, Fields extends $ZodShape> = {
  page: z.ZodArray<z.ZodObject<FullDocShape<Name, Fields>>>
  isDone: z.ZodBoolean
  continueCursor: z.ZodString
  splitCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
}
```

- [ ] **Step 4: Update mini paginatedDoc type in `public/mini/model.ts`**

Update the `MiniModelSchemas` paginatedDoc shape to match:

```typescript
readonly paginatedDoc: ZodMiniObject<
  {
    page: ZodMiniArray<...>
    isDone: ZodMiniBoolean
    continueCursor: ZodMiniString
    splitCursor: ZodMiniOptional<ZodMiniNullable<ZodMiniString>>
  },
  $strip
>
```

- [ ] **Step 5: Run existing pagination tests to check for breakage**

Run: `bun run test -- --grep "paginated\|pagination"`
Fix any test expectations that assumed `continueCursor` was nullable/optional.

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/zodvex/src/internal/schema/runtimeHelpers.ts \
  packages/zodvex/src/internal/modelSchemaBundle.ts \
  packages/zodvex/src/public/model.ts \
  packages/zodvex/src/public/mini/model.ts
git commit -m "fix: unify pagination shapes to match Convex PaginationResult type"
```

---

### Task 2: Add `zx.doc()`, `zx.update()`, `zx.docArray()` model helpers

These helpers derive schemas from a model's `name` + `fields`, using existing `addSystemFields` and `createPartialShape`/`createUpdateObjectSchema` from `modelSchemaBundle.ts` and `schemaHelpers.ts`.

**Files:**
- Modify: `packages/zodvex/src/internal/zx.ts`
- Modify: `packages/zodvex/__tests__/zx.test.ts`

- [ ] **Step 1: Write failing tests for `zx.doc()`**

Append to `packages/zodvex/__tests__/zx.test.ts`:

```typescript
describe('zx.doc()', () => {
  it('adds _id and _creationTime to model fields', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string(),
    })
    const docSchema = zx.doc(model)
    const result = docSchema.safeParse({
      _id: 'user123',
      _creationTime: 1718452800000,
      name: 'Alice',
      email: 'alice@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects docs missing system fields', () => {
    const model = defineZodModel('users', {
      name: z.string(),
    })
    const docSchema = zx.doc(model)
    const result = docSchema.safeParse({ name: 'Alice' })
    expect(result.success).toBe(false)
  })

  it('works with zodToConvex', () => {
    const model = defineZodModel('items', {
      title: z.string(),
      count: z.number(),
    })
    const docSchema = zx.doc(model)
    const validator = zodToConvex(docSchema)
    expect(validator).toEqual(
      v.object({
        _id: v.id('items'),
        _creationTime: v.float64(),
        title: v.string(),
        count: v.float64(),
      })
    )
  })
})
```

Add the import for `defineZodModel` at the top of the test file:

```typescript
import { defineZodModel } from '../src/internal/model'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts -t "zx.doc"`
Expected: FAIL — `zx.doc is not a function`

- [ ] **Step 3: Write failing tests for `zx.update()`**

```typescript
describe('zx.update()', () => {
  it('creates update schema with _id required and fields optional', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      done: z.boolean(),
    })
    const updateSchema = zx.update(model)

    // _id is required
    const noId = updateSchema.safeParse({ title: 'New title' })
    expect(noId.success).toBe(false)

    // With _id, fields are optional
    const withId = updateSchema.safeParse({ _id: 'task123' })
    expect(withId.success).toBe(true)

    // With partial fields
    const partial = updateSchema.safeParse({ _id: 'task123', title: 'Updated' })
    expect(partial.success).toBe(true)
  })

  it('works with zodToConvex', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      count: z.number(),
    })
    const updateSchema = zx.update(model)
    const validator = zodToConvex(updateSchema)
    expect(validator).toEqual(
      v.object({
        _id: v.id('tasks'),
        _creationTime: v.optional(v.float64()),
        title: v.optional(v.string()),
        count: v.optional(v.float64()),
      })
    )
  })
})
```

- [ ] **Step 4: Write failing tests for `zx.docArray()`**

```typescript
describe('zx.docArray()', () => {
  it('creates array of doc schemas', () => {
    const model = defineZodModel('items', {
      name: z.string(),
    })
    const arraySchema = zx.docArray(model)
    const result = arraySchema.safeParse([
      { _id: 'item1', _creationTime: 100, name: 'First' },
      { _id: 'item2', _creationTime: 200, name: 'Second' },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects invalid items in the array', () => {
    const model = defineZodModel('items', {
      name: z.string(),
    })
    const arraySchema = zx.docArray(model)
    const result = arraySchema.safeParse([{ wrong: true }])
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts -t "zx.doc|zx.update|zx.docArray"`
Expected: FAIL — functions not defined

- [ ] **Step 6: Implement `doc()`, `update()`, `docArray()` in `zx.ts`**

Add the following imports at the top of `packages/zodvex/src/internal/zx.ts`:

```typescript
import { addSystemFields } from './schemaHelpers'
import { createUpdateObjectSchema, createSchemaUpdateSchema } from './modelSchemaBundle'
```

Add the following type and functions before the `export const zx` block:

```typescript
/**
 * Minimal model shape accepted by zx helpers.
 * Both full and slim models satisfy this at runtime — both have
 * name, fields, and some schema property.
 *
 * For object models: fields has entries, schema is reconstructible from fields.
 * For union models: fields is {}, schema carries the union type.
 * The helpers check fields.length to determine which path to take.
 */
type ZxModelInput = {
  readonly name: string
  readonly fields: Record<string, $ZodType>
  // Both model types have schema at runtime:
  // - Full: { doc, base, insert, ... } bundle object
  // - Slim: bare $ZodType (the base schema)
  // Typed as unknown here — helpers extract the base schema at runtime.
  readonly schema?: unknown
}

/**
 * Extracts the base schema from a model input.
 * Object models: reconstructs from fields. Union models: extracts from schema property.
 */
function getBaseSchemaFromModel(model: ZxModelInput): $ZodType {
  const hasFields = Object.keys(model.fields).length > 0
  if (hasFields) {
    return z.object(model.fields) as any
  }
  // Union model — need the base schema from model.schema
  const s = model.schema as any
  if (s instanceof $ZodType) return s        // slim model: .schema IS the base
  if (s?.base instanceof $ZodType) return s.base  // full model: .schema.base
  throw new Error('[zodvex] Union model passed to zx helper without a base schema')
}

/**
 * Constructs a doc schema: base fields + _id + _creationTime.
 * For object models: extends fields with system fields.
 * For union models: adds system fields to each variant via addSystemFields.
 *
 * @param model - Any ZodModel (full or slim)
 */
function doc(model: ZxModelInput) {
  const baseSchema = getBaseSchemaFromModel(model)
  // addSystemFields handles object, union, and discriminated union
  return addSystemFields(model.name, baseSchema)
}

/**
 * Constructs an update schema: _id required + _creationTime optional + all user fields optional.
 * For union models: maps partial over each variant via createSchemaUpdateSchema.
 * For object models: creates partial object with _id via createUpdateObjectSchema.
 *
 * @param model - Any ZodModel (full or slim)
 */
function update(model: ZxModelInput) {
  const baseSchema = getBaseSchemaFromModel(model)
  // createSchemaUpdateSchema is union-aware: handles both unions and objects
  return createSchemaUpdateSchema(model.name, baseSchema)
}

/**
 * Constructs a doc array schema: z.array(doc(model)).
 *
 * @param model - Any ZodModel (full or slim)
 */
function docArray(model: ZxModelInput) {
  return z.array(doc(model))
}
```

Update the `zx` export:

```typescript
export const zx = {
  date,
  id,
  codec,
  paginationOpts,
  paginationResult,
  doc,
  update,
  docArray,
} as const
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run test -- packages/zodvex/__tests__/zx.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/zodvex/src/internal/zx.ts packages/zodvex/__tests__/zx.test.ts
git commit -m "feat: add zx.doc(), zx.update(), zx.docArray() model helpers"
```

---

### Task 3: Extract `ZodModelBase` type and update internal constraints

The core type refactor. `ZodModelBase` has no `schema` property — internals are forced to use `name` + `fields`.

**Files:**
- Modify: `packages/zodvex/src/internal/model.ts`
- Modify: `packages/zodvex/src/internal/meta.ts`
- Modify: `packages/zodvex/src/internal/schema.ts`

- [ ] **Step 1: Extract `ZodModelBase` in `model.ts`**

In `packages/zodvex/src/internal/model.ts`, add a new type after the existing `ModelSchemas` type (around line 140):

```typescript
/**
 * Base model type — the contract that all zodvex internals constrain against.
 *
 * Deliberately excludes `schema` so that internal code (defineZodSchema,
 * tableFromModel, DB wrapper) cannot depend on the schema bundle shape.
 * This guarantees both full and slim models work with all internals.
 */
export type ZodModelBase<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = $ZodType,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = {
  readonly name: Name
  readonly fields: Fields
  readonly indexes: Indexes
  readonly searchIndexes: SearchIndexes
  readonly vectorIndexes: VectorIndexes

  index<
    IndexName extends string,
    First extends ModelFieldPaths<InsertSchema>,
    Rest extends ModelFieldPaths<InsertSchema>[]
  >(
    name: IndexName,
    fields: readonly [First, ...Rest]
  ): ZodModelBase<
    Name,
    Fields,
    InsertSchema,
    Indexes & Record<IndexName, readonly [First, ...Rest, '_creationTime']>,
    SearchIndexes,
    VectorIndexes
  >

  searchIndex<IndexName extends string>(
    name: IndexName,
    config: SearchIndexConfig
  ): ZodModelBase<
    Name,
    Fields,
    InsertSchema,
    Indexes,
    SearchIndexes & Record<IndexName, SearchIndexConfig>,
    VectorIndexes
  >

  vectorIndex<IndexName extends string>(
    name: IndexName,
    config: VectorIndexConfig
  ): ZodModelBase<
    Name,
    Fields,
    InsertSchema,
    Indexes,
    SearchIndexes,
    VectorIndexes & Record<IndexName, VectorIndexConfig>
  >
}

/** Widened base type for internal constraints. */
export type AnyZodModelBase = ZodModelBase<string, $ZodShape, $ZodType>
```

Update `AnyZodModel` (currently line 264) to extend the base:

```typescript
export type AnyZodModel = ZodModel<string, $ZodShape, $ZodType, ModelSchemas>
```

Keep `AnyZodModel` unchanged for now — consumers may reference it. The new `AnyZodModelBase` is for internal use.

- [ ] **Step 2: Make `schemas` optional in `ZodvexModelMeta`**

In `packages/zodvex/src/internal/meta.ts`, change the `schemas` field to be optional:

```typescript
export type ZodvexModelMeta = {
  type: 'model'
  tableName: string
  definitionSource?: ZodvexModelDefinitionSource
  schemas?: {
    doc: $ZodType
    insert: $ZodType
    update: $ZodType
    docArray: $ZodType
    paginatedDoc: $ZodType
  }
}
```

- [ ] **Step 3: Update `schema.ts` to constrain against `ZodModelBase`**

In `packages/zodvex/src/internal/schema.ts`:

Change the import to include `AnyZodModelBase`:

```typescript
import type { AnyZodModel, AnyZodModelBase, SearchIndexConfig, VectorIndexConfig } from './model'
```

Add import for `zx` helpers:

```typescript
import { zx } from './zx'
```

Change `ZodModelEntry` to use `AnyZodModelBase`:

```typescript
export type ZodModelEntry = AnyZodModelBase
```

Update `tableFromModel` (line 154) to use `ZodModelEntry` (which is now `AnyZodModelBase`). The function already uses `model.fields` and `model.name` — the key change is how it gets the base schema for union models. Currently it reads `model.schema.base`. We need to get this from meta or reconstruct it:

```typescript
function tableFromModel(model: ZodModelEntry) {
  const meta = getZodModelMeta(model)
  const usesBaseSchema =
    meta.definitionSource === 'schema' ||
    (meta.definitionSource == null && Object.keys(model.fields).length === 0)

  let table = usesBaseSchema
    ? defineTable(zodToConvex(getBaseSchema(model)) as any)
    : defineTable(zodToConvexFields(model.fields))

  for (const [indexName, indexFields] of Object.entries(model.indexes)) {
    const userFields = indexFields.filter(f => f !== '_creationTime')
    table = table.index(indexName, userFields as any)
  }

  for (const [indexName, config] of Object.entries(model.searchIndexes)) {
    table = table.searchIndex(indexName, config as any)
  }

  for (const [indexName, config] of Object.entries(model.vectorIndexes)) {
    table = table.vectorIndex(indexName, config as any)
  }

  return table
}
```

Add the `getBaseSchema` helper near the top of the function section:

```typescript
/**
 * Extracts the base schema from a model entry.
 * Full models: reads from schema bundle. Slim models: reads top-level .schema property.
 * Falls back to z.object(fields) if neither is available.
 */
function getBaseSchema(model: ZodModelEntry): $ZodType {
  // Try schema bundle first (full model)
  const asAny = model as any
  if (asAny.schema?.base instanceof $ZodType) return asAny.schema.base
  // Slim model: .schema IS the base
  if (asAny.schema instanceof $ZodType) return asAny.schema
  // Fallback: reconstruct from fields
  return z.object(model.fields) as any
}
```

Update `defineZodSchema`'s model entry handling (lines 234-242) to use `zx.*` helpers:

```typescript
if (isZodModelEntry(entry)) {
  if (entry.name !== name) {
    throw new Error(
      `Model name '${entry.name}' does not match key '${name}'. ` +
        `The model name must match the key in the schema definition.`
    )
  }
  convexTables[name] = tableFromModel(entry)

  // Build zodTableMap from model base properties using zx helpers.
  // Works for both full and slim models — no dependency on schema bundle.
  const baseSchema = getBaseSchema(entry)
  zodTableMap[name] = {
    doc: zx.doc(entry),
    docArray: zx.docArray(entry),
    paginatedDoc: zx.paginationResult(zx.doc(entry)),
    base: baseSchema,
    insert: baseSchema,
    update: zx.update(entry)
  }
} else {
  convexTables[name] = entry.table
  zodTableMap[name] = entry.schema
}
```

- [ ] **Step 4: Run all tests to verify nothing is broken**

Run: `bun run test`
Expected: ALL PASS — this is a refactor that changes internal constraints but preserves behavior.

- [ ] **Step 5: Run type check**

Run: `bun run type-check`
Expected: PASS — if any internal code was reaching for `model.schema.doc` through a `ZodModelEntry` constraint, this will catch it.

- [ ] **Step 6: Commit**

```bash
git add packages/zodvex/src/internal/model.ts packages/zodvex/src/internal/meta.ts packages/zodvex/src/internal/schema.ts
git commit -m "refactor: extract ZodModelBase, decouple internals from schema bundle"
```

---

### Task 3b: Add type-level `ConvexTableFor` and `DecodedDocFor` branches for slim models

`ConvexTableFor` currently matches model entries via `schema: { base: infer Base }` and `DecodedDocFor` matches `{ schema: { doc: $ZodType } }`. Slim models have flat `schema: $ZodType` + `doc: $ZodType`, so neither structural match works. Without this fix, slim models lose `ctx.db` type safety and decoded-doc inference.

**Files:**
- Modify: `packages/zodvex/src/internal/schema.ts`

- [ ] **Step 1: Update `ConvexTableFor` to handle slim models**

In `packages/zodvex/src/internal/schema.ts`, the `ConvexTableFor` type needs an additional branch. After the existing model entry branch (which matches `schema: { base: infer Base }`), add a branch for slim models where `schema` is a bare `$ZodType`:

```typescript
type ConvexTableFor<E> =
  // zodTable entry — extract .table with full VObject type
  E extends { table: infer T extends TableDefinition }
    ? T
    : // Full model entry — schema is nested bundle with .base
      E extends {
          fields: infer F extends Record<string, $ZodType>
          schema: { base: infer Base extends $ZodType }
          indexes: infer I extends Record<string, readonly string[]>
          searchIndexes: infer SI extends Record<string, SearchIndexConfig>
          vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
        }
      ? Base extends $ZodUnion<any> | $ZodDiscriminatedUnion<any, any>
        ? TableDefinition<
            ConvexValidatorFromZod<Base, 'required'>,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
        : TableDefinition<
            VObject<
              ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
              ConvexValidatorFromZodFieldsAuto<F>
            >,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
      : // Slim model entry — schema is bare $ZodType (the base), compute from fields
        E extends {
            fields: infer F extends Record<string, $ZodType>
            schema: infer Base extends $ZodType
            indexes: infer I extends Record<string, readonly string[]>
            searchIndexes: infer SI extends Record<string, SearchIndexConfig>
            vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
          }
        ? Base extends $ZodUnion<any> | $ZodDiscriminatedUnion<any, any>
          ? TableDefinition<
              ConvexValidatorFromZod<Base, 'required'>,
              { [K in keyof I]: [...I[K]] },
              { [K in keyof SI]: { searchField: string; filterFields: string } },
              { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
            >
          : TableDefinition<
              VObject<
                ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
                ConvexValidatorFromZodFieldsAuto<F>
              >,
              { [K in keyof I]: [...I[K]] },
              { [K in keyof SI]: { searchField: string; filterFields: string } },
              { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
            >
        : TableDefinition
```

Note: The full model branch matches first (more specific structural match `schema: { base: ... }` before `schema: $ZodType`). TypeScript will prefer the more specific branch. Verify with a type test in Task 5.

- [ ] **Step 2: Update `DecodedDocFor` to handle slim models**

```typescript
export type DecodedDocFor<T extends Record<string, { schema: { doc: $ZodType } } | { doc: $ZodType }>> = {
  [K in keyof T & string]: T[K] extends { schema: { doc: infer D extends $ZodType } }
    ? zoutput<D>
    : T[K] extends { doc: infer D extends $ZodType }
      ? zoutput<D>
      : never
}
```

- [ ] **Step 3: Run type check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/src/internal/schema.ts
git commit -m "fix: add ConvexTableFor and DecodedDocFor type branches for slim models"
```

---

### Task 4: Add `schemaHelpers` flag and slim model factory

The consumer-facing feature. `defineZodModel('name', fields, { schemaHelpers: false })` produces a slim model.

**Files:**
- Modify: `packages/zodvex/src/internal/model.ts`
- Modify: `packages/zodvex/__tests__/defineZodModel.test.ts`

- [ ] **Step 1: Write failing tests for `schemaHelpers: false`**

Append to `packages/zodvex/__tests__/defineZodModel.test.ts`:

```typescript
describe('defineZodModel with schemaHelpers: false', () => {
  it('creates a slim model with flat schema and doc', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string(),
    }, { schemaHelpers: false })

    expect(model.name).toBe('users')
    expect(model.fields).toHaveProperty('name')
    expect(model.fields).toHaveProperty('email')

    // schema is the base ZodObject (not a nested bundle)
    const baseResult = model.schema.safeParse({ name: 'Alice', email: 'a@b.com' })
    expect(baseResult.success).toBe(true)

    // doc has system fields
    const docResult = model.doc.safeParse({
      _id: 'user123',
      _creationTime: 100,
      name: 'Alice',
      email: 'a@b.com',
    })
    expect(docResult.success).toBe(true)
  })

  it('does not have nested schema bundle properties', () => {
    const model = defineZodModel('items', {
      title: z.string(),
    }, { schemaHelpers: false })

    // schema is a ZodType, not an object with .doc/.base/.update
    expect((model.schema as any).doc).toBeUndefined()
    expect((model.schema as any).base).toBeUndefined()
    expect((model.schema as any).update).toBeUndefined()
  })

  it('supports .index() chaining', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      priority: z.number(),
    }, { schemaHelpers: false })
      .index('by_priority', ['priority'])

    expect(model.indexes).toHaveProperty('by_priority')
    // Model still has schema and doc after chaining
    expect(model.schema).toBeDefined()
    expect(model.doc).toBeDefined()
  })

  it('slim model has correct metadata', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
    }, { schemaHelpers: false })

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.type).toBe('model')
    expect(meta.tableName).toBe('tasks')
    expect(meta.definitionSource).toBe('shape')
  })

  it('doc has concrete type — .nullable() works', () => {
    const model = defineZodModel('users', {
      name: z.string(),
    }, { schemaHelpers: false })

    // .nullable() works because doc is z.ZodObject, not $ZodType
    const nullableDoc = model.doc.nullable()
    expect(nullableDoc.safeParse(null).success).toBe(true)
    expect(nullableDoc.safeParse({
      _id: 'u1', _creationTime: 100, name: 'Alice'
    }).success).toBe(true)
  })

  it('doc works with zx.paginationResult()', () => {
    const model = defineZodModel('items', {
      title: z.string(),
    }, { schemaHelpers: false })

    const paginated = zx.paginationResult(model.doc)
    expect(paginated.safeParse({
      page: [{ _id: 'i1', _creationTime: 100, title: 'Hello' }],
      isDone: false,
      continueCursor: 'abc',
    }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- packages/zodvex/__tests__/defineZodModel.test.ts -t "schemaHelpers"`
Expected: FAIL — `defineZodModel` does not accept a third argument

- [ ] **Step 3: Add options type and `SlimZodModel` type to `model.ts`**

In `packages/zodvex/src/internal/model.ts`, add the options type and slim model type after the existing `ZodModel` type:

```typescript
/** Options for defineZodModel. */
export type DefineZodModelOptions = {
  /**
   * When `true` (default), the model carries a full schema bundle with
   * `doc`, `base`, `insert`, `update`, `docArray`, `paginatedDoc`.
   *
   * When `false`, the model carries only `schema` (the base) and `doc`.
   * Use `zx.update(model)`, `zx.docArray(model)`, `zx.paginationResult(model.doc)`
   * to derive schemas on demand.
   *
   * @default true
   */
  schemaHelpers?: boolean
}

/**
 * Slim model for object shapes — produced when `schemaHelpers: false` with a raw shape.
 * `doc` uses concrete z.ZodObject type so .nullable()/.optional()/etc. work.
 */
export type SlimObjectModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = $ZodType,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = ZodModelBase<Name, Fields, InsertSchema, Indexes, SearchIndexes, VectorIndexes> & {
  readonly schema: InsertSchema
  readonly doc: z.ZodObject<Fields & { _id: ZxId<Name>; _creationTime: z.ZodNumber }>
}

/**
 * Slim model for union/discriminated union schemas — produced when `schemaHelpers: false`
 * with a pre-built schema. `doc` uses AddSystemFieldsToUnion to preserve the union structure
 * with system fields on each variant.
 */
export type SlimUnionModel<
  Name extends string = string,
  Schema extends $ZodType = $ZodType,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = ZodModelBase<Name, $ZodShape, Schema, Indexes, SearchIndexes, VectorIndexes> & {
  readonly schema: Schema
  readonly doc: AddSystemFieldsToUnion<Name, Schema>
}
```

- [ ] **Step 4: Add slim `createModel` factory**

Add `createSlimModel` function alongside the existing `createModel`:

```typescript
function createSlimModel<Name extends string>(
  name: Name,
  fields: $ZodShape,
  baseSchema: $ZodType,
  definitionSource: ZodvexModelDefinitionSource,
  indexes: Record<string, readonly string[]> = {},
  searchIndexes: Record<string, SearchIndexConfig> = {},
  vectorIndexes: Record<string, VectorIndexConfig> = {}
): any {
  const docSchema = addSystemFields(name, baseSchema)
  const model = {
    name,
    fields,
    schema: baseSchema,
    doc: docSchema,
    indexes,
    searchIndexes,
    vectorIndexes,
    index(indexName: string, indexFields: readonly string[]) {
      return createSlimModel(
        name,
        fields,
        baseSchema,
        definitionSource,
        { ...indexes, [indexName]: [...indexFields, '_creationTime'] },
        searchIndexes,
        vectorIndexes
      )
    },
    searchIndex(indexName: string, config: SearchIndexConfig) {
      return createSlimModel(
        name,
        fields,
        baseSchema,
        definitionSource,
        indexes,
        { ...searchIndexes, [indexName]: config },
        vectorIndexes
      )
    },
    vectorIndex(indexName: string, config: VectorIndexConfig) {
      return createSlimModel(name, fields, baseSchema, definitionSource, indexes, searchIndexes, {
        ...vectorIndexes,
        [indexName]: config
      })
    }
  }

  attachMeta(model, { type: 'model', tableName: name, definitionSource })
  return model
}
```

Add the import for `addSystemFields`:

```typescript
import { addSystemFields } from './schemaHelpers'
```

- [ ] **Step 5: Add `defineZodModel` overloads for `schemaHelpers: false`**

Add two new overloads before the implementation (after the existing overloads):

```typescript
// Overload 3: raw shape with schemaHelpers: false → SlimObjectModel
export function defineZodModel<Name extends string, Fields extends $ZodShape>(
  name: Name,
  fields: Fields,
  options: { schemaHelpers: false }
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional
): SlimObjectModel<Name, Fields, z.ZodObject<Fields>, {}, {}, {}>

// Overload 4: pre-built schema with schemaHelpers: false → SlimUnionModel
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema,
  options: { schemaHelpers: false }
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional
): SlimUnionModel<Name, Schema, {}, {}, {}>
```

Update the implementation signature and body:

```typescript
// Implementation
export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType,
  options?: DefineZodModelOptions
): any {
  const slim = options?.schemaHelpers === false

  if (fieldsOrSchema instanceof $ZodType) {
    if (slim) {
      return createSlimModel(name, {}, fieldsOrSchema as $ZodType, 'schema')
    }
    return createModel(name, {}, createSchemaBundle(name, fieldsOrSchema as $ZodType), 'schema')
  }

  const fields = fieldsOrSchema as $ZodShape
  if (slim) {
    return createSlimModel(name, fields, z.object(fields) as any, 'shape')
  }
  return createModel(name, fields, createObjectSchemaBundle(name, fields), 'shape')
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- packages/zodvex/__tests__/defineZodModel.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run type check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/zodvex/src/internal/model.ts packages/zodvex/__tests__/defineZodModel.test.ts
git commit -m "feat: add schemaHelpers option to defineZodModel for slim models"
```

---

### Task 5: Integration test — slim model through defineZodSchema

Verify that a slim model works end-to-end through schema registration and the DB wrapper.

**Files:**
- Create: `packages/zodvex/__tests__/slim-model-schema.test.ts`

- [ ] **Step 1: Write integration tests**

Create `packages/zodvex/__tests__/slim-model-schema.test.ts`:

```typescript
/**
 * Integration tests for slim models (schemaHelpers: false) through
 * defineZodSchema and the DB wrapper pipeline.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineZodModel } from '../src/internal/model'
import { defineZodSchema } from '../src/internal/schema'
import { zx } from '../src/internal/zx'

describe('slim model → defineZodSchema integration', () => {
  it('slim model registers successfully in defineZodSchema', () => {
    const TaskModel = defineZodModel('tasks', {
      title: z.string(),
      done: z.boolean(),
    }, { schemaHelpers: false })

    const schema = defineZodSchema({ tasks: TaskModel })
    expect(schema).toBeDefined()
    expect(schema.__zodTableMap).toHaveProperty('tasks')
  })

  it('zodTableMap has doc and insert for slim model', () => {
    const ItemModel = defineZodModel('items', {
      name: z.string(),
      count: z.number(),
    }, { schemaHelpers: false })

    const schema = defineZodSchema({ items: ItemModel })
    const tableSchemas = schema.__zodTableMap.items

    expect(tableSchemas.doc).toBeDefined()
    expect(tableSchemas.insert).toBeDefined()
    expect(tableSchemas.base).toBeDefined()
    expect(tableSchemas.update).toBeDefined()

    // Verify doc has system fields
    const docResult = tableSchemas.doc.safeParse({
      _id: 'item123',
      _creationTime: 100,
      name: 'Test',
      count: 42,
    })
    expect(docResult.success).toBe(true)

    // Verify insert validates user fields only
    const insertResult = tableSchemas.insert.safeParse({
      name: 'Test',
      count: 42,
    })
    expect(insertResult.success).toBe(true)
  })

  it('slim and full models can coexist in the same schema', () => {
    const SlimModel = defineZodModel('slim_table', {
      title: z.string(),
    }, { schemaHelpers: false })

    const FullModel = defineZodModel('full_table', {
      name: z.string(),
      email: z.string(),
    })

    const schema = defineZodSchema({
      slim_table: SlimModel,
      full_table: FullModel,
    })

    expect(schema.__zodTableMap).toHaveProperty('slim_table')
    expect(schema.__zodTableMap).toHaveProperty('full_table')
  })

  it('zx helpers work with slim models', () => {
    const Model = defineZodModel('docs', {
      content: z.string(),
    }, { schemaHelpers: false })

    // zx.doc() should produce same result as Model.doc
    const helperDoc = zx.doc(Model)
    const modelDoc = Model.doc

    const testData = {
      _id: 'doc123',
      _creationTime: 100,
      content: 'Hello',
    }

    expect(helperDoc.safeParse(testData).success).toBe(true)
    expect(modelDoc.safeParse(testData).success).toBe(true)

    // zx.update() should work
    const updateSchema = zx.update(Model)
    expect(updateSchema.safeParse({ _id: 'doc123' }).success).toBe(true)

    // zx.paginationResult() should work with Model.doc
    const paginated = zx.paginationResult(Model.doc)
    expect(paginated.safeParse({
      page: [testData],
      isDone: false,
      continueCursor: 'cursor',
    }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun run test -- packages/zodvex/__tests__/slim-model-schema.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/__tests__/slim-model-schema.test.ts
git commit -m "test: add slim model integration tests through defineZodSchema"
```

---

### Task 6: Update mini entrypoint for `schemaHelpers` support

The `zodvex/mini` entrypoint re-declares `defineZodModel` with mini-typed overloads. It needs its own mini-specific slim types (using `ZodMiniObject` etc. instead of `z.ZodObject`) and matching `schemaHelpers: false` overloads.

Mini consumers use functional wrappers (`z.nullable(schema)`) not method chains (`schema.nullable()`), so the slim doc type must use `ZodMiniObject` — not `z.ZodObject` from full zod.

**Files:**
- Modify: `packages/zodvex/src/public/mini/model.ts`

- [ ] **Step 1: Add mini-specific slim model types**

In `packages/zodvex/src/public/mini/model.ts`, add slim types that mirror `SlimObjectModel`/`SlimUnionModel` but use mini types:

```typescript
import {
  defineZodModel as _defineZodModel,
  type DefineZodModelOptions,
  type ZodModelBase
} from '../../internal/model'
import type { AddSystemFieldsToMiniUnion } from './model' // already in this file
```

```typescript
/** Slim object model for zod/mini consumers. */
export type SlimMiniObjectModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = ZodMiniObject<Fields, $strip>,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = ZodModelBase<Name, Fields, InsertSchema, Indexes, SearchIndexes, VectorIndexes> & {
  readonly schema: InsertSchema
  readonly doc: ZodMiniObject<
    Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber },
    $strip
  >
}

/** Slim union model for zod/mini consumers. */
export type SlimMiniUnionModel<
  Name extends string = string,
  Schema extends $ZodType = $ZodType,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = ZodModelBase<Name, $ZodShape, Schema, Indexes, SearchIndexes, VectorIndexes> & {
  readonly schema: Schema
  readonly doc: AddSystemFieldsToMiniUnion<Name, Schema>
}
```

Export `DefineZodModelOptions`:

```typescript
export type { DefineZodModelOptions }
```

- [ ] **Step 2: Add overloads for `schemaHelpers: false`**

```typescript
// Overload 3: raw shape with schemaHelpers: false
export function defineZodModel<Name extends string, Fields extends $ZodShape>(
  name: Name,
  fields: Fields,
  options: { schemaHelpers: false }
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional
): SlimMiniObjectModel<Name, Fields, ZodMiniObject<Fields, $strip>, {}, {}, {}>

// Overload 4: pre-built schema with schemaHelpers: false
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema,
  options: { schemaHelpers: false }
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional
): SlimMiniUnionModel<Name, Schema, {}, {}, {}>
```

Update the implementation to pass through options:

```typescript
export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType,
  options?: DefineZodModelOptions
): any {
  if (fieldsOrSchema instanceof $ZodType) {
    return _defineZodModel(name, fieldsOrSchema, options)
  }
  return _defineZodModel(name, fieldsOrSchema, options)
}
```

- [ ] **Step 2: Run type check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/src/public/mini/model.ts
git commit -m "feat: add schemaHelpers option to zodvex/mini defineZodModel"
```

---

### Task 7: Export new types from public API

Ensure `ZodModelBase`, `AnyZodModelBase`, `SlimZodModel`, and `DefineZodModelOptions` are exported.

**Files:**
- Modify: `packages/zodvex/src/public/model.ts`

- [ ] **Step 1: Check current exports**

Read `packages/zodvex/src/public/model.ts` to see what's currently exported from the main entrypoint's model surface.

- [ ] **Step 2: Add exports for new types**

Add the new types to the re-export list:

```typescript
export type {
  AnyZodModelBase,
  DefineZodModelOptions,
  SlimZodModel,
  ZodModelBase
} from '../internal/model'
```

- [ ] **Step 3: Run existing export tests**

Run: `bun run test -- packages/zodvex/__tests__/exports.test.ts`
Expected: PASS (new exports don't break existing ones)

- [ ] **Step 4: Run type check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/src/public/model.ts
git commit -m "feat: export ZodModelBase, SlimZodModel, DefineZodModelOptions from public API"
```

---

### Task 7b: Codegen compatibility with slim models

Codegen discovery stores `meta.schemas` and walks them for codecs. Generation builds an identity map from schema objects to `Model.schema.<key>` source strings. Slim models have no `meta.schemas` and no `Model.schema.doc`. This task makes codegen work with both model types.

**Files:**
- Modify: `packages/zodvex/src/public/codegen/discover.ts`
- Modify: `packages/zodvex/src/public/codegen/generate.ts`
- Create: `packages/zodvex/__tests__/slim-model-codegen.test.ts`

- [ ] **Step 1: Write failing tests for codegen with slim models**

Create `packages/zodvex/__tests__/slim-model-codegen.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineZodModel } from '../src/internal/model'
import { readMeta, type ZodvexModelMeta } from '../src/internal/meta'
import { walkModelCodecs } from '../src/public/codegen/discover'
import { zx } from '../src/internal/zx'
import { zodvexCodec } from '../src/internal/codec'

describe('codegen with slim models', () => {
  it('walkModelCodecs handles slim model (no meta.schemas)', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      createdAt: zx.date(),
    }, { schemaHelpers: false })

    const meta = readMeta(model) as ZodvexModelMeta
    // Slim models don't have meta.schemas
    expect(meta.schemas).toBeUndefined()

    // walkModelCodecs should still find codecs by reconstructing schemas
    // from the model's name + fields
    const codecs = walkModelCodecs('UserModel', 'models/user.ts', meta.schemas, model)
    expect(codecs.length).toBeGreaterThan(0)
    // Should find the zx.date() codec in the model fields
  })

  it('walkModelCodecs finds codecs in full model normally', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      createdAt: zx.date(),
    })

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.schemas).toBeDefined()

    const codecs = walkModelCodecs('TaskModel', 'models/task.ts', meta.schemas!, model)
    expect(codecs.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Update `walkModelCodecs` to accept model fallback**

In `packages/zodvex/src/public/codegen/discover.ts`, update `walkModelCodecs` to accept an optional model object for reconstructing schemas when `meta.schemas` is absent:

```typescript
export function walkModelCodecs(
  modelExportName: string,
  sourceFile: string,
  schemas: ZodvexModelMeta['schemas'] | undefined,
  model?: { name: string; fields: Record<string, $ZodType>; schema?: $ZodType; doc?: $ZodType }
): ModelEmbeddedCodec[] {
  // Reconstruct schemas from model if meta.schemas is absent (slim model)
  const effectiveSchemas = schemas ?? reconstructSchemas(model)
  if (!effectiveSchemas) return []

  // ... rest of existing logic using effectiveSchemas ...
}
```

Add a `reconstructSchemas` helper. Uses `zx.*` helpers (which internally use `z` from `zod`, already imported in the module) so union models are handled correctly and the pagination shape matches `zx.paginationResult()`:

```typescript
import { zx } from '../../internal/zx'
import { createSchemaUpdateSchema } from '../../internal/modelSchemaBundle'
import { z } from 'zod'

function reconstructSchemas(
  model?: { name: string; fields: Record<string, $ZodType>; schema?: unknown; doc?: unknown }
): ZodvexModelMeta['schemas'] | null {
  if (!model) return null
  // Use zx helpers — they handle both object and union models via getBaseSchemaFromModel
  const modelInput = model as any
  const docSchema = modelInput.doc instanceof $ZodType
    ? modelInput.doc
    : zx.doc(modelInput)
  const baseSchema = modelInput.schema instanceof $ZodType
    ? modelInput.schema
    : z.object(model.fields)
  return {
    doc: docSchema,
    insert: baseSchema,
    update: createSchemaUpdateSchema(model.name, baseSchema),
    docArray: z.array(docSchema),
    paginatedDoc: zx.paginationResult(docSchema),
  }
}
```

Note: The memory cost of reconstructed schemas is irrelevant at codegen (build) time.

- [ ] **Step 3: Update `discoverModules` to pass model object to `walkModelCodecs`**

In the `discoverModules` function, when building `DiscoveredModel`, also store a reference to the model object for slim model fallback:

```typescript
if (meta.type === 'model') {
  // ... existing dedup logic ...
  models.push({
    exportName,
    tableName: meta.tableName,
    sourceFile: file,
    schemas: meta.schemas,
    // For slim models: store model ref for schema reconstruction at codegen time
    _modelRef: meta.schemas ? undefined : value,
  })
}
```

Update `DiscoveredModel` type to include the optional ref:

```typescript
export type DiscoveredModel = {
  exportName: string
  tableName: string
  sourceFile: string
  schemas: ZodvexModelMeta['schemas']
  /** @internal For slim models — used to reconstruct schemas at codegen time. */
  _modelRef?: unknown
}
```

Then in the codec walking loop:

```typescript
for (const model of models) {
  const found = walkModelCodecs(
    model.exportName,
    model.sourceFile,
    model.schemas,
    model._modelRef as any
  )
  modelCodecs.push(...found)
}
```

- [ ] **Step 4: Update identity map in `generateApiFile` for slim models**

In `packages/zodvex/src/public/codegen/generate.ts`, the identity map currently builds paths like `Model.schema.doc`. For slim models, the paths differ:

```typescript
for (const model of models) {
  const importPath = `../${model.sourceFile.replace(/\.ts$/, '.js')}`
  const isSlim = !model.schemas // slim models have no schemas in meta
  
  if (isSlim && model._modelRef) {
    // Slim model: map .doc and .schema directly
    const ref = model._modelRef as any
    if (ref.doc instanceof $ZodType) {
      identityMap.set(ref.doc, {
        importPath,
        exportName: model.exportName,
        schemaKey: 'doc' // emits Model.doc
      })
    }
    if (ref.schema instanceof $ZodType) {
      identityMap.set(ref.schema, {
        importPath,
        exportName: model.exportName,
        schemaKey: 'schema' // emits Model.schema (the base)
      })
    }
  } else if (model.schemas) {
    // Full model: existing behavior
    for (const key of ['doc', 'insert', 'update', 'docArray', 'paginatedDoc'] as const) {
      identityMap.set(model.schemas[key] as $ZodType, {
        importPath,
        exportName: model.exportName,
        schemaKey: `schema.${key}` // emits Model.schema.doc etc.
      })
    }
  }
}
```

And update the `resolveSchema` function to use the schemaKey directly:

```typescript
// Currently: `${ref.exportName}.schema.${ref.schemaKey}`
// Change to: `${ref.exportName}.${ref.schemaKey}`
// This works for both: full model → "Model.schema.doc", slim → "Model.doc"
```

- [ ] **Step 5: Run codegen tests**

Run: `bun run test -- packages/zodvex/__tests__/slim-model-codegen.test.ts`
Run: `bun run test -- packages/zodvex/__tests__/codegen-generate.test.ts`
Run: `bun run test -- packages/zodvex/__tests__/codegen-discover.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/zodvex/src/public/codegen/discover.ts \
  packages/zodvex/src/public/codegen/generate.ts \
  packages/zodvex/__tests__/slim-model-codegen.test.ts
git commit -m "feat: codegen discovery and generation compatibility with slim models"
```

---

### Task 8: Stress test `--slim` flag

Add slim model generation to the stress test to measure actual memory savings.

**Files:**
- Create: `examples/stress-test/templates/zod/model-small-slim.ts.tmpl`
- Create: `examples/stress-test/templates/zod/functions-shared-slim.ts.tmpl`
- Modify: `examples/stress-test/generate.ts`

- [ ] **Step 1: Create slim model template**

Create `examples/stress-test/templates/zod/model-small-slim.ts.tmpl`:

```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const {{NAME}}Fields = {
  title: z.string(),
  active: z.boolean(),
  count: z.number(),
  createdAt: zx.date(),
}

export const {{NAME}}Model = defineZodModel('{{TABLE_NAME}}', {{NAME}}Fields, { schemaHelpers: false })
  .index('by_created', ['createdAt'])
```

- [ ] **Step 2: Create slim functions template**

Create `examples/stress-test/templates/zod/functions-shared-slim.ts.tmpl`:

```typescript
import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { {{NAME}}Model, {{NAME}}Fields } from '../models/{{FILE_NAME}}'

// Shared arg objects — same Zod instances reused across functions
const byIdArgs = { id: zx.id('{{TABLE_NAME}}') }

export const get{{NAME}} = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: {{NAME}}Model.doc.nullable(),
})

export const delete{{NAME}} = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
  },
})

export const list{{NAME}} = zq({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('{{TABLE_NAME}}').collect()
  },
  returns: zx.docArray({{NAME}}Model),
})

export const update{{NAME}} = zm({
  args: {
    id: zx.id('{{TABLE_NAME}}'),
    title: {{NAME}}Fields.title,
    {{EXTRA_ARGS}}
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})

export const create{{NAME}} = zm({
  args: {
    title: {{NAME}}Fields.title,
    {{EXTRA_ARGS}}
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('{{TABLE_NAME}}', {
      ...args,
      createdAt: new Date(),
    })
  },
  returns: zx.id('{{TABLE_NAME}}'),
})
```

Key differences from non-slim template:
- `{{NAME}}Model.doc.nullable()` instead of `{{NAME}}Model.schema.doc.nullable()`
- `zx.docArray({{NAME}}Model)` instead of `{{NAME}}Model.schema.docArray`

- [ ] **Step 3: Add `--slim` flag to `generate.ts`**

In `examples/stress-test/generate.ts`, update `parseArgs()`:

```typescript
function parseArgs(): GenerateConfig {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const mode = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'both') as GenerateConfig['mode']
  const variant = (args.find(a => a.startsWith('--variant='))?.split('=')[1] ?? 'baseline') as GenerateConfig['variant']
  const shared = args.includes('--shared')
  const slim = args.includes('--slim')
  const convex = args.includes('--convex')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(EXAMPLE_DIR, 'convex', 'generated')

  return { count, mode, variant, shared, slim, convex, outputDir }
}
```

Add `slim: boolean` to the `GenerateConfig` interface.

In the `generate()` function, select slim templates when the flag is set. Update the template loading section:

```typescript
// Load templates
const functionsTemplate = config.shared
  ? (config.slim ? 'functions-shared-slim' : 'functions-shared')
  : 'functions'
const templates = {
  small: loadTemplate(templateDir, config.slim ? 'model-small-slim' : 'model-small'),
  medium: loadTemplate(templateDir, config.slim ? 'model-medium-slim' : 'model-medium'),
  large: loadTemplate(templateDir, config.slim ? 'model-large-slim' : 'model-large'),
  functions: loadTemplate(templateDir, functionsTemplate),
  schema: loadTemplate(templateDir, 'schema'),
}
```

Note: For this initial task, only `model-small-slim` and `functions-shared-slim` templates are created. Medium and large slim templates can be added later — the generator will error if `--slim` is used without them, which is acceptable for an experimental feature. Alternatively, fall back to non-slim templates for medium/large:

```typescript
const templates = {
  small: loadTemplate(templateDir, config.slim ? 'model-small-slim' : 'model-small'),
  medium: loadTemplate(templateDir, existsSync(join(EXAMPLE_DIR, 'templates', templateDir, 'model-medium-slim.ts.tmpl'))
    ? 'model-medium-slim' : 'model-medium'),
  large: loadTemplate(templateDir, existsSync(join(EXAMPLE_DIR, 'templates', templateDir, 'model-large-slim.ts.tmpl'))
    ? 'model-large-slim' : 'model-large'),
  functions: loadTemplate(templateDir, functionsTemplate),
  schema: loadTemplate(templateDir, 'schema'),
}
```

Actually, simpler — just create the medium and large slim variants too. They're identical to the small slim template except for the field count. Copy `model-small-slim.ts.tmpl` and adjust fields to match the existing medium and large templates but with `{ schemaHelpers: false }`.

- [ ] **Step 4: Create medium and large slim model templates**

Create `examples/stress-test/templates/zod/model-medium-slim.ts.tmpl` — copy from the existing `model-medium.ts.tmpl` but change the `defineZodModel` call to include `{ schemaHelpers: false }` as the third argument.

Create `examples/stress-test/templates/zod/model-large-slim.ts.tmpl` — same pattern with the existing large template.

- [ ] **Step 5: Verify generation works**

Run: `cd examples/stress-test && bun run generate -- --count=10 --shared --slim`
Expected: Files generated in `convex/generated/` with slim model definitions

- [ ] **Step 6: Commit**

```bash
git add examples/stress-test/templates/zod/model-small-slim.ts.tmpl \
  examples/stress-test/templates/zod/model-medium-slim.ts.tmpl \
  examples/stress-test/templates/zod/model-large-slim.ts.tmpl \
  examples/stress-test/templates/zod/functions-shared-slim.ts.tmpl \
  examples/stress-test/generate.ts
git commit -m "feat: add --slim flag to stress test generator"
```

---

### Task 9: Run stress test comparison and verify memory savings

Run the stress test with and without `--slim` to measure actual memory delta.

**Files:** None — this is a measurement task

- [ ] **Step 1: Generate baseline**

```bash
cd examples/stress-test
bun run generate -- --count=100 --mode=both --variant=baseline --shared
```

- [ ] **Step 2: Measure baseline heap**

```bash
bun run measure -- --variant=baseline --count=100
```

Record the heap delta.

- [ ] **Step 3: Generate slim variant**

```bash
bun run generate -- --count=100 --mode=both --variant=baseline --shared --slim
```

- [ ] **Step 4: Measure slim heap**

```bash
bun run measure -- --variant=baseline --count=100
```

Record the heap delta. Compare with baseline.

- [ ] **Step 5: Document results**

Expected: ~7.5 MB savings at 100 models (~77 KB/model). If the delta is significantly different, investigate.

- [ ] **Step 6: Commit measurement notes**

If the results are added to an existing report file, commit them. Otherwise, note the results in the PR description.

---

### Task 10: Final lint, type-check, and full test run

**Files:** None — validation only

- [ ] **Step 1: Run linter**

Run: `bun run lint`
Expected: PASS (or fix issues)

- [ ] **Step 2: Run full type check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 4: Fix any issues and commit**

If any issues found, fix and commit with descriptive messages.
