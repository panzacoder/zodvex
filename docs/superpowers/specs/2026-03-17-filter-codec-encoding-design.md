# Filter Builder Codec Encoding

Extend the codec boundary to `.filter()` — the last query method that passes runtime values through without encoding.

## Problem

`ZodvexQueryChain.filter()` passes the `FilterBuilder` straight through to Convex without encoding. If a handler receives decoded runtime values (e.g., `Date` from `zx.date()`) and uses them in filter comparisons, Convex gets the wrong type. `.withIndex()` and `.withSearchIndex()` already encode; `.filter()` is the gap.

### Type constraint challenge

Convex's `Expression<T>` constrains `T extends Value | undefined`, where `Value` is `null | bigint | number | boolean | string | ArrayBuffer | Value[] | { ... }`. `Date` does not satisfy `Value`, so `Expression<Date>` is invalid. This means we cannot simply override `field()` on `FilterBuilder` to return decoded types — the `Expression` wrapper rejects non-Value types.

The solution: define our own `ZodvexExpression<T>` with no `Value` constraint. At runtime, all values are still `ExpressionImpl` instances — `ZodvexExpression` is purely a type-level construct that the runtime never sees.

## Types: `ZodvexExpression` and `ZodvexFilterBuilder`

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

### `ZodvexFilterBuilder` — full interface replacement

Replaces (not extends) Convex's `FilterBuilder`. Same method names and call patterns, but uses `ZodvexExpression`/`ZodvexExpressionOrValue` instead of Convex's constrained versions.

```typescript
interface ZodvexFilterBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  TableInfo extends GenericTableInfo
> {
  // field() returns decoded types for codec fields via ZodvexIndexFieldValue
  field<FP extends FieldPaths<TableInfo>>(
    fieldPath: FP
  ): ZodvexExpression<ZodvexIndexFieldValue<WireDoc, DecodedDoc, FP>>

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

  // Arithmetic — stays numeric
  add(l: ZodvexExpressionOrValue<number>, r: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
  sub(l: ZodvexExpressionOrValue<number>, r: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
  mul(l: ZodvexExpressionOrValue<number>, r: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
  div(l: ZodvexExpressionOrValue<number>, r: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
  mod(l: ZodvexExpressionOrValue<number>, r: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
  neg(x: ZodvexExpressionOrValue<number>): ZodvexExpression<number>
}
```

Reuses `ZodvexIndexFieldValue` (db.ts:43-51) for the `field()` return type — decoded types for top-level codec fields, wire types for dot-paths and non-codec fields.

### How type inference flows

```typescript
// Codec field — Date
.filter(q => q.eq(q.field("createdAt"), new Date()))
// 1. q.field("createdAt") → ZodvexExpression<Date>  (via ZodvexIndexFieldValue)
// 2. T inferred as Date from left side
// 3. new Date() satisfies ZodvexExpressionOrValue<Date> = ZodvexExpression<Date> | Date  ✓

// Non-codec field — string
.filter(q => q.eq(q.field("name"), "Alice"))
// 1. q.field("name") → ZodvexExpression<string>  (no codec, wire = decoded)
// 2. T = string, "Alice" satisfies string  ✓

// Two field expressions
.filter(q => q.eq(q.field("startDate"), q.field("endDate")))
// Both sides are ZodvexExpression<Date>, T = Date  ✓

// Compound filter with logical operators
.filter(q => q.and(
  q.gte(q.field("createdAt"), new Date("2024-01-01")),
  q.eq(q.field("status"), "active")
))
// Each comparison resolves independently  ✓
```

### Boundary cast

`ZodvexQueryChain.filter()` passes the predicate to Convex's inner `.filter()`. The cast is implicit via `(q: any)` — same pattern used by `wrapIndexRangeBuilder`:

```typescript
filter(
  predicate: (q: ZodvexFilterBuilder<DocumentByInfo<TableInfo>, Doc, TableInfo>) => ZodvexExpressionOrValue<boolean>
): ZodvexQueryChain<TableInfo, Doc> {
  const wrappedPredicate = (q: any) => predicate(wrapFilterBuilder(q, this.schema))
  return this.createChain(this.inner.filter(wrappedPredicate))
}
```

At runtime, `q` is `filterBuilderImpl` wrapped by our proxy, and the return value is `ExpressionImpl` — Convex's `serializeExpression` handles it via `instanceof ExpressionImpl`.

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

### Known limitation

Raw values nested inside arithmetic expressions (e.g., `q.add(q.field("x"), someDate)`) are not encoded, because arithmetic methods are not intercepted. Arithmetic on codec fields is not a realistic pattern.

## Affected files

- `packages/zodvex/src/db.ts` — `ZodvexExpression`, `ZodvexExpressionOrValue`, `ZodvexFilterBuilder`, `extractFieldPath`, `wrapFilterBuilder`, updated `filter()` method signature and implementation. Add `FieldPaths` to the import from `convex/server`.
- `packages/zodvex/__tests__/db.test.ts` — runtime tests
- `packages/zodvex/typechecks/filter-builder.test-d.ts` — type tests

## Tests

### Runtime tests (db.test.ts)

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

### Type tests (filter-builder.test-d.ts)

1. `q.field("createdAt")` returns `ZodvexExpression<Date>` when `createdAt` is `zx.date()`
2. `q.eq(q.field("createdAt"), new Date())` type-checks (T inferred as Date)
3. `q.field("name")` returns `ZodvexExpression<string>` (non-codec, unchanged)
4. `q.eq(q.field("name"), "Alice")` type-checks (T inferred as string)
5. `q.eq(new Date(), q.field("createdAt"))` — reversed operand order type-checks
6. `q.eq(q.field("createdAt"), "not-a-date")` — `@ts-expect-error`, Date field rejects string
7. `q.and(q.eq(...), q.gte(...))` returns `ZodvexExpression<boolean>`
