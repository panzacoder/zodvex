# Filter Builder Codec Encoding

Extend the codec boundary to `.filter()` — the last query method that passes runtime values through without encoding.

## Problem

`ZodvexQueryChain.filter()` passes the `FilterBuilder` straight through to Convex without encoding. If a handler receives decoded runtime values (e.g., `Date` from `zx.date()`) and uses them in filter comparisons, Convex gets the wrong type. `.withIndex()` and `.withSearchIndex()` already encode; `.filter()` is the gap.

### Type constraint challenge

Convex's `Expression<T>` constrains `T extends Value | undefined`, where `Value` is `null | bigint | number | boolean | string | ArrayBuffer | Value[] | { ... }`. `Date` does not satisfy `Value`, so `Expression<Date>` is invalid. We cannot override `field()` on `FilterBuilder` to return decoded types — the `Expression` wrapper rejects non-Value types.

The root cause: the index builder works because field name and value are in the same call (`eq("createdAt", value)`), so the value type is resolved per-field. The filter builder separates them (`eq(field("createdAt"), value)`) — the field identity is erased into `Expression<number>` and `T` must unify across both arguments.

The solution: define `ZodvexExpression<T>` with no `Value` constraint, and a `ZodvexFilterBuilder` that uses it. At runtime, all values are still `ExpressionImpl` instances — `ZodvexExpression` is purely type-level.

## Types

### `ZodvexExpression<T>` — unconstrained expression type

```typescript
/**
 * Opaque expression type for decoded-aware filter builders.
 * Drops Convex's `T extends Value | undefined` constraint so codec
 * fields can carry decoded types (e.g., Date instead of number).
 * At runtime, these are Convex ExpressionImpl instances — the type
 * is erased and only serves the type checker.
 */
declare const _zodvexExpr: unique symbol
type ZodvexExpression<T> = { readonly [_zodvexExpr]: T }
type ZodvexExpressionOrValue<T> = ZodvexExpression<T> | T
```

### `ZodvexFilterBuilder` — decoded-aware filter interface

A parallel interface to Convex's `FilterBuilder` with the same method names and call patterns, but using `ZodvexExpression`/`ZodvexExpressionOrValue` instead of Convex's constrained versions. It is not a drop-in substitute for `FilterBuilder` — the two are structurally incompatible because `ZodvexExpression<T>` and `Expression<T>` are different branded types. The compatibility story lives at the `.filter()` overload boundary, not at the builder type level.

Simplified generic shape consistent with `ZodvexQueryChain<TableInfo, Doc>`:

```typescript
import type { NumericValue } from 'convex/values'  // bigint | number

interface ZodvexFilterBuilder<
  TableInfo extends GenericTableInfo,
  Doc = DocumentByInfo<TableInfo>
> {
  // field() returns decoded types for codec fields
  field<FP extends FieldPaths<TableInfo>>(
    fieldPath: FP
  ): ZodvexExpression<ZodvexIndexFieldValue<DocumentByInfo<TableInfo>, Doc, FP>>

  // Comparisons — unconstrained T, inferred from arguments
  eq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  neq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>

  // Logic — unchanged semantics
  and(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  or(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  not(x: ZodvexExpressionOrValue<boolean>): ZodvexExpression<boolean>

  // Arithmetic — preserves Convex's NumericValue (bigint | number)
  add<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  sub<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  mul<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  div<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  mod<T extends NumericValue>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
  neg<T extends NumericValue>(x: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
}
```

`WireDoc` is derived internally as `DocumentByInfo<TableInfo>`. The public surface is `ZodvexFilterBuilder<TableInfo, Doc>`, consistent with `ZodvexQueryChain<TableInfo, Doc>`.

### `.filter()` overloads — compatibility superset

`ZodvexQueryChain.filter()` accepts both Convex-native and decoded-aware predicates via overloads. This is the key compatibility promise — existing reusable filter helpers that type against `FilterBuilder<TableInfo>` continue to work unchanged.

```typescript
// Overload 1: decoded-aware predicate (tried first)
filter(
  predicate: (q: ZodvexFilterBuilder<TableInfo, Doc>) => ZodvexExpressionOrValue<boolean>
): ZodvexQueryChain<TableInfo, Doc>

// Overload 2: Convex-native predicate (backwards compatible)
filter(
  predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
): ZodvexQueryChain<TableInfo, Doc>
```

The decoded-aware overload is listed first so TypeScript tries it first. If the predicate uses `ZodvexFilterBuilder` features (decoded types), overload 1 matches. If it's a plain Convex `FilterBuilder` predicate, overload 2 matches.

At runtime, the implementation is the same for both — the proxy wraps `filterBuilderImpl` and encodes raw values regardless of which overload matched:

```typescript
filter(predicate: any): ZodvexQueryChain<TableInfo, Doc> {
  const wrappedPredicate = (q: any) => predicate(wrapFilterBuilder(q, this.schema))
  return this.createChain(this.inner.filter(wrappedPredicate))
}
```

### Schema-derived helper types

Utility types for deriving table-specific types from the output of `defineZodSchema`. These are for reusable filter helpers — inline `.filter()` usage infers everything automatically from the query chain.

```typescript
import type { DataModelFromSchemaDefinition, NamedTableInfo, TableNamesInDataModel } from 'convex/server'

/** Extract the DataModel from a defineZodSchema result */
type InferDataModel<Schema extends ReturnType<typeof defineZodSchema>> =
  DataModelFromSchemaDefinition<Schema>

/** Extract TableInfo for a specific table */
type InferTableInfo<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = NamedTableInfo<InferDataModel<Schema>, TableName>

/** Extract the decoded document type for a specific table */
type InferDecodedDoc<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = Schema extends { __decodedDocs: infer DD }
  ? TableName extends keyof DD ? DD[TableName] : never
  : never

/** A ZodvexFilterBuilder typed for a specific table */
type InferFilterBuilder<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = ZodvexFilterBuilder<
  InferTableInfo<Schema, TableName>,
  InferDecodedDoc<Schema, TableName>
>
```

### How type inference flows

**Inline usage — no manual generics needed:**

```typescript
// Codec field — Date
ctx.db.query("users")
  .filter(q => q.gte(q.field("createdAt"), new Date()))
// ZodvexQueryChain infers TableInfo + Doc, ZodvexFilterBuilder resolves field types  ✓

// Non-codec field — string
ctx.db.query("users")
  .filter(q => q.eq(q.field("name"), "Alice"))
// T = string, inferred from field expression  ✓
```

**Reusable helper — schema-derived types:**

```typescript
import type { InferFilterBuilder } from 'zodvex'
import type schema from './schema'

type UsersFilter = InferFilterBuilder<typeof schema, "users">

const createdAfter = (q: UsersFilter, after: Date) =>
  q.gte(q.field("createdAt"), after)

// Usage in query:
ctx.db.query("users").filter(q => createdAfter(q, new Date("2024-01-01")))
```

**Existing Convex-native helpers — still work via overload 2:**

```typescript
import type { FilterBuilder } from 'convex/server'

// Legacy helper typed against Convex's FilterBuilder
const isActive = <T extends GenericTableInfo>(q: FilterBuilder<T>) =>
  q.eq(q.field("status"), "active")

// Still works — overload 2 matches
ctx.db.query("users").filter(isActive)
```

**Chaining both modes — use separate `.filter()` calls:**

```typescript
import type { FilterBuilder, GenericTableInfo } from 'convex/server'

const isActive = <T extends GenericTableInfo>(q: FilterBuilder<T>) =>
  q.eq(q.field("status"), "active")

ctx.db.query("users")
  .filter(isActive) // Convex-native overload
  .filter(q => q.gte(q.field("createdAt"), new Date("2024-01-01"))) // decoded-aware overload
```

## Runtime: `wrapFilterBuilder` proxy

New function in `src/db.ts` alongside the existing `wrapIndexRangeBuilder`.

### `extractFieldPath`

Inspects an expression via `serialize()` to check if it's a `$field` reference:

```typescript
function extractFieldPath(expr: any): string | null {
  if (expr && typeof expr.serialize === 'function') {
    const inner = expr.serialize()
    if (inner && typeof inner === 'object' && '$field' in inner) {
      return inner.$field
    }
  }
  return null
}
```

Uses the public `serialize()` method on `ExpressionImpl`. The `{ $field: fieldPath }` JSON structure is Convex's filter expression wire format — verified identical across convex 1.28 through 1.33.1.

### `wrapFilterBuilder`

Proxy that intercepts comparison methods (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`). For each call, if one argument is a `$field` expression and the other is a raw value, encodes the raw value through `encodeIndexValue(schema, fieldPath, value)`:

```typescript
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

- Reuses `encodeIndexValue` which already handles object and union schemas
- `q.eq(q.field("a"), q.field("b"))` passes through unchanged (both sides are expressions)
- `and()`, `or()`, `not()`, `field()`, arithmetic methods are not intercepted — they don't take raw comparison values

### Known limitations

1. **Mixed composition within a single callback.** A callback cannot combine a legacy helper typed as `FilterBuilder<TableInfo>` with decoded-aware comparisons from `ZodvexFilterBuilder` in the same callback. `ZodvexFilterBuilder` and `FilterBuilder` are structurally incompatible (different expression brands), so `q` cannot satisfy both types simultaneously. For example:

   ```typescript
   // ❌ Does NOT work — isActive expects FilterBuilder, but q is ZodvexFilterBuilder
   const isActive = (q: FilterBuilder<TableInfo>) => q.eq(q.field("status"), "active")
   ctx.db.query("users").filter(q => q.and(isActive(q), q.gte(q.field("createdAt"), new Date())))
   ```

   **Workarounds:**
   - Re-type the helper to accept `ZodvexFilterBuilder` (or the table-specific `InferFilterBuilder` type)
   - Use separate `.filter()` calls so each callback can resolve against its own overload:

     ```typescript
     ctx.db.query("users")
       .filter(isActive)
       .filter(q => q.gte(q.field("createdAt"), new Date()))
     ```

   This works because each `.filter()` call resolves independently: the first callback can use the Convex-native overload, and the second can use the decoded-aware overload. The limitation is only within a single callback that tries to use both type systems.

2. **Arithmetic on codec fields:** Raw values nested inside arithmetic expressions (e.g., `q.add(q.field("x"), someDate)`) are not encoded, because arithmetic methods are not intercepted. Arithmetic on codec fields is not a realistic pattern.

3. **Both sides are raw decoded values:** `q.eq(new Date(), new Date())` without any field reference — neither side is encoded. The raw `Date` would reach `convexOrUndefinedToJson` and throw. This pattern is not useful in practice (comparing two literals without fields), but it is not guarded against.

## Affected files

- `packages/zodvex/src/db.ts` — `ZodvexExpression`, `ZodvexExpressionOrValue`, `ZodvexFilterBuilder`, `extractFieldPath`, `wrapFilterBuilder`, updated `filter()` method with overloads. Add `FieldPaths` to the import from `convex/server`.
- `packages/zodvex/src/schema.ts` — `InferDataModel`, `InferTableInfo`, `InferDecodedDoc`, `InferFilterBuilder` helper types (these depend on `convex/server` types, so they belong in schema.ts, not types.ts which is client-safe)
- `packages/zodvex/src/server/index.ts` — export new types (server-only, NOT from core/index.ts)
- `packages/zodvex/__tests__/db.test.ts` — runtime tests (mock-based)
- `examples/task-manager/convex/` — integration test with real Convex `ExpressionImpl`
- `packages/zodvex/typechecks/filter-builder.test-d.ts` — type tests

## Tests

### Runtime tests — mock-based (db.test.ts)

Using a mock FilterBuilder that simulates the expression API (`field()` returns objects with `serialize()`, comparison methods capture arguments):

1. `q.eq(q.field("createdAt"), new Date(...))` — codec field value encoded to timestamp
2. `q.eq(q.field("name"), "Alice")` — non-codec field passes through unchanged
3. `q.eq(q.field("email.value"), "alice@example.com")` — dot-path passes through
4. `q.and(q.eq(q.field("createdAt"), date1), q.gte(q.field("createdAt"), date2))` — multiple comparisons inside logical operators all encode
5. `q.eq(q.field("kind"), "push")` on union schema — discriminator literal encodes through per-field union
6. `q.neq(q.field("createdAt"), new Date(...))` — neq also encodes
7. `q.and(expr1, expr2)` — logical operators pass through without intercepting
8. `q.eq(new Date(...), q.field("createdAt"))` — reversed operand order, encodes the left side
9. `q.eq(q.field("deletedAt"), null)` — null comparison passes through unchanged

### Runtime tests — real Convex boundary (example app)

At least one integration test using real Convex `ExpressionImpl` and `filterBuilderImpl` to validate `extractFieldPath` and the `serialize()` → `$field` detection against the actual Convex implementation, not just mocks. This test should:

- Import `filterBuilderImpl` from Convex's impl module
- Call `wrapFilterBuilder(filterBuilderImpl, schema)` with a real schema
- Verify the returned expression serializes correctly (encoded values in `$literal` nodes)

Note: example app integration tests currently blocked by `import.meta.glob` issue. This test can use a direct import of the Convex impl in the library's test suite instead.

### Type tests (filter-builder.test-d.ts)

1. `q.field("createdAt")` returns `ZodvexExpression<Date>` when `createdAt` is `zx.date()`
2. `q.eq(q.field("createdAt"), new Date())` type-checks (T inferred as Date)
3. `q.field("name")` returns `ZodvexExpression<string>` (non-codec, unchanged)
4. `q.eq(q.field("name"), "Alice")` type-checks (T inferred as string)
5. `q.eq(new Date(), q.field("createdAt"))` — reversed operand order type-checks
6. `q.eq(q.field("createdAt"), "not-a-date")` — `@ts-expect-error`, Date field rejects string
7. `q.and(q.eq(...), q.gte(...))` returns `ZodvexExpression<boolean>`
8. Convex-native `FilterBuilder<TableInfo>` predicate accepted by `.filter()` overload 2 when passed directly as `.filter(isActive)`
9. Chained `.filter(isActive).filter(q => q.gte(...))` works because each callback resolves independently
10. `InferFilterBuilder<typeof schema, "users">` resolves to correct `ZodvexFilterBuilder` type

### Example app (examples/task-manager/)

Demonstrate both usage patterns:

```typescript
// Inline — no manual generics
ctx.db.query("users").filter(q => q.gte(q.field("createdAt"), new Date()))

// Reusable helper — schema-derived type
type UsersFilter = InferFilterBuilder<typeof schema, "users">
const createdAfter = (q: UsersFilter, date: Date) =>
  q.gte(q.field("createdAt"), date)
ctx.db.query("users").filter(q => createdAfter(q, new Date()))

// Mix legacy + decoded-aware helpers by chaining filters
const isActive = <T extends GenericTableInfo>(q: FilterBuilder<T>) =>
  q.eq(q.field("status"), "active")
ctx.db.query("users")
  .filter(isActive)
  .filter(q => q.gte(q.field("createdAt"), new Date()))
```
