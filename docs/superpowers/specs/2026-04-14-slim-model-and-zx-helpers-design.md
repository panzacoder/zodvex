# Slim Model & zx Schema Helpers

**Date:** 2026-04-14
**Branch:** `feat/memory-management`
**Status:** Design approved

## Problem

Each `defineZodModel()` call eagerly constructs 6 Zod schema instances in its `.schema` bundle: `doc`, `base`, `insert`, `update`, `docArray`, `paginatedDoc`. At ~106 KB per model (Zod v4 schemas carry 61-91 own properties each), this is a significant contributor to OOM in Convex's 64 MB V8 isolate.

Only 2 of the 6 are needed at module analysis time:
- `base` (for `defineZodSchema` → Convex table definition)
- `doc` (for DB wrapper decode)

The remaining 3 expensive schemas (`update`=39KB, `paginatedDoc`=35KB, `docArray`=3KB) are consumer conveniences that can be constructed on demand.

For comparison, vanilla Convex `defineTable()` carries **zero** derived schemas — just the validator and index methods. Convex validators cost ~2-4 own properties each vs Zod's 61-91.

## Solution

1. Add `zx.*` schema helper functions that derive schemas from `model.name` + `model.fields`
2. Refactor zodvex internals to use helpers + base fields (not the schema bundle)
3. Add a `schemaHelpers` flag to `defineZodModel` that switches between full and slim model factories
4. Add stress test coverage to prove memory reduction

## Design

### Type Hierarchy

```typescript
// Base type — what all internals constrain against.
// NO schema or doc properties. Internals must derive everything from name + fields.
type ZodModelBase<
  Name extends string,
  Fields extends $ZodShape,
  InsertSchema extends $ZodType,
  Indexes extends Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig>
> = {
  readonly name: Name
  readonly fields: Fields
  readonly indexes: Indexes
  readonly searchIndexes: SearchIndexes
  readonly vectorIndexes: VectorIndexes
  index(name, fields): ZodModelBase<...>
  searchIndex(name, config): ZodModelBase<...>
  vectorIndex(name, config): ZodModelBase<...>
}

// Full model — schemaHelpers: true (default, current behavior)
type FullZodModel<...> = ZodModelBase<...> & {
  readonly schema: FullZodModelSchemas<Name, Fields>
  // schema.doc, schema.base, schema.insert, schema.update, schema.docArray, schema.paginatedDoc
}

// Slim object model — schemaHelpers: false with raw shape
// doc carries a CONCRETE type (z.ZodObject<...>), not $ZodType,
// so .nullable()/.optional()/etc. work directly.
type SlimObjectModel<Name, Fields, InsertSchema, ...> = ZodModelBase<...> & {
  readonly schema: InsertSchema
  readonly doc: z.ZodObject<Fields & { _id: ZxId<Name>; _creationTime: z.ZodNumber }>
}

// Slim union model — schemaHelpers: false with pre-built schema
// doc preserves the union structure with system fields on each variant.
type SlimUnionModel<Name, Schema, ...> = ZodModelBase<...> & {
  readonly schema: Schema
  readonly doc: AddSystemFieldsToUnion<Name, Schema>
}

// Mini slim types mirror these but use ZodMiniObject/ZodMiniArray etc.
```

Excluding `schema` from `ZodModelBase` guarantees no internal code can depend on the bundle shape. The compiler enforces this — any internal that reaches for `.schema.doc` will fail to type-check against `ZodModelBase`.

`AnyZodModel`, `defineZodSchema`, `tableFromModel`, and downstream wrapper types all constrain against `ZodModelBase`.

### Type-Level Schema Inference

`ConvexTableFor` (in `schema.ts`) currently matches model entries via `schema: { base: infer Base }`. For slim models, `schema` is a bare `$ZodType`, not an object with `.base`. Similarly, `DecodedDocFor` matches `schema: { doc: $ZodType }`, which slim models don't have.

Both mapped types need additional structural branches:

```typescript
// ConvexTableFor — add branch for slim models (schema is $ZodType, doc is top-level)
E extends {
  fields: infer F extends Record<string, $ZodType>
  schema: infer Base extends $ZodType  // slim: base schema directly
  indexes: infer I extends Record<string, readonly string[]>
  ...
}

// DecodedDocFor — handle both shapes
T[K] extends { schema: { doc: infer D extends $ZodType } }
  ? zoutput<D>
  : T[K] extends { doc: infer D extends $ZodType }
    ? zoutput<D>
    : never
```

This ensures `ctx.db` type safety, `withIndex` constraints, and decoded-doc inference all work for slim models.

### `zx.*` Helper Functions

All helpers accept a model-like object with `name`, `fields`, and `schema`. For object models, schemas are derived from `fields`. For union models (where `fields` is `{}`), the helper extracts the base schema from the `schema` property — which works for both full models (`model.schema.base`) and slim models (`model.schema` directly).

No memoization — constructed on demand, GC'd if not retained. Consumers who need a stable reference assign to a module-level const.

```typescript
// Construct doc schema: base fields + _id + _creationTime
// Object models: derived from fields. Union models: adds system fields to each variant.
zx.doc(model): $ZodType

// Construct update schema: _id (required) + _creationTime (optional) + partial(fields)
// Union models: maps partial over each variant via createSchemaUpdateSchema.
zx.update(model): $ZodType

// Construct doc array: z.array(zx.doc(model))
zx.docArray(model: ZodModelBase): $ZodType

// Construct paginated result wrapper from any item schema.
// Modeled after Vova's hotpot implementation.
zx.paginationResult(itemSchema: $ZodType): $ZodType
// Returns: z.object({
//   page: z.array(itemSchema),
//   isDone: z.boolean(),
//   continueCursor: z.string(),
//   splitCursor: z.string().nullable().optional(),
// })

// Construct pagination options (standalone, no model needed).
zx.paginationOpts(): $ZodType
// Returns: z.object({
//   numItems: z.number(),
//   cursor: z.string().nullable(),
//   endCursor: z.string().nullable().optional(),
//   id: z.number().optional(),
//   maximumRowsRead: z.number().optional(),
//   maximumBytesRead: z.number().optional(),
// })
```

`insert` does not need a helper — for object models it's the same reference as `model.schema` (the base). For union models it's `model.schema` directly.

### `schemaHelpers` Flag

```typescript
// Full bundle (default — backwards compatible)
const Users = defineZodModel('users', { name: z.string(), email: z.string() })
Users.schema.doc           // works
Users.schema.paginatedDoc  // works

// Slim mode (opt-in — lower memory)
const Users = defineZodModel('users', { name: z.string(), email: z.string() }, { schemaHelpers: false })
Users.schema               // the base ZodObject
Users.doc                  // ZodObject with system fields
zx.update(Users)           // on-demand
zx.paginationResult(Users.doc)  // on-demand
```

Two internal `createModel` variants selected by the flag. The slim variant constructs only `schema` (base) and `doc` — 2 Zod instances (~29 KB) instead of 6 (~106 KB).

When `schemaHelpers: false`, `model.schema` is the base `$ZodType` (not a nested object), so there are no nested properties to access. If a consumer somehow accesses `model.schema` as if it were the old bundle (e.g., `model.schema.doc`), it will naturally fail because `$ZodType` doesn't have those properties — TypeScript catches this at compile time, and at runtime it returns `undefined`. No throwing getters needed.

### Internal Migration

`defineZodSchema` currently copies 6 properties from `model.schema` into `zodTableMap`. After this change:

1. `tableFromModel()` uses `model.fields` + `model.name` to build the Convex table definition (via `zodToConvexFields(model.fields)` or `zodToConvex(model.schema)` for union models). This is already the case — no change needed.
2. `defineZodSchema` constructs `zodTableMap` entries using the `zx.*` helpers: `{ doc: zx.doc(model), insert: model.schema, ... }` — derived from `ZodModelBase` properties only.
3. The DB wrapper (`ZodvexDatabaseReader`/`Writer`) continues reading `zodTableMap.doc` and `zodTableMap.insert` unchanged.

### Codegen Compatibility

Codegen discovery stores `meta.schemas` for each model and walks those schemas for codecs. Generation builds an identity map from schema objects to `Model.schema.<key>` source strings.

For slim models:
1. **Discovery**: When `meta.schemas` is absent, reconstruct schemas from the model object — `doc` from the top-level `model.doc`, `insert` from `model.schema` (the base). Walk these for codecs as normal. The memory cost is irrelevant since codegen runs at build time, not module analysis time.
2. **Identity map**: Map slim model schemas to their actual access paths — `Model.doc` instead of `Model.schema.doc`, `Model.schema` instead of `Model.schema.insert`. Skip `update`/`docArray`/`paginatedDoc` since they don't exist on the slim model.
3. **Generated references**: For codecs found in slim model schemas, emit the correct access path (e.g., `Model.doc.shape.email` instead of `Model.schema.doc.shape.email`).

### Pagination Shape Unification

The existing `zPaginated()` helper (`runtimeHelpers.ts`) and `createPaginatedDocSchema()` (`modelSchemaBundle.ts`) use `{ continueCursor: optional(nullable(string)) }`. The new `zx.paginationResult()` uses Convex's actual `PaginationResult` shape: `{ continueCursor: string, splitCursor: optional(nullable(string)) }`.

These must be unified. Update `zPaginated` and `createPaginatedDocSchema` to match the new `zx.paginationResult` shape. This is a breaking change for anyone relying on `continueCursor` being nullable, but it aligns with Convex's actual type.

### Stress Test

Add a `--slim` flag to the stress test generator that produces models with `{ schemaHelpers: false }`. The existing binary-search OOM test measures the endpoint ceiling for baseline vs slim, proving actual memory reduction.

Expected impact: ~77 KB saved per model. At 100 models = ~7.5 MB freed (~12% of 64 MB budget). At 200 models = ~15 MB freed (~23%).

## Migration Path

### For consumers

```typescript
// Before (schemaHelpers: true, current default)
const Users = defineZodModel('users', fields)
export const list = zq({
  returns: Users.schema.paginatedDoc,
  handler: async (ctx, args) => { ... }
})

// After (schemaHelpers: false)
const Users = defineZodModel('users', fields, { schemaHelpers: false })
export const list = zq({
  returns: zx.paginationResult(Users.doc),
  handler: async (ctx, args) => { ... }
})
```

### Versioning plan

- `schemaHelpers` defaults to `true` now (fully backwards compatible)
- Future minor version: default flips to `false`
- Future major version: full bundle removed entirely

## Scope

### In scope
- `zx.doc()`, `zx.update()`, `zx.docArray()` helpers
- `zx.paginationResult()`, `zx.paginationOpts()` helpers
- `ZodModelBase` type extraction
- `schemaHelpers` flag on `defineZodModel`
- Slim `createModel` factory
- Internal migration to use `ZodModelBase` constraints (both runtime and type-level)
- Type-level `ConvexTableFor` and `DecodedDocFor` branches for slim models
- Codegen discovery/generation compatibility with slim models
- Pagination shape unification (`zPaginated`, `createPaginatedDocSchema` → match `zx.paginationResult`)
- Concrete `doc` typing on `SlimZodModel` (preserves `.nullable()` etc.)
- Stress test `--slim` flag
- Documentation for experimental mode

### Out of scope
- Changing the default to `false` (future version)
- Removing the full bundle entirely (future major)
- Changes to `zodTable()` (legacy, already deprecated)
- zod/mini-specific optimizations (orthogonal)

## Open Questions

None — all design decisions resolved during brainstorming.
