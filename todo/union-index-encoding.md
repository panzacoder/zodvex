# Union Index Encoding

## Problem

`encodeIndexValue()` in `packages/zodvex/src/db.ts` only handles `ZodObject` schemas.
When a table uses a top-level discriminated union (e.g., `z.discriminatedUnion('kind', [...])`),
the doc schema is a union, not an object — so `encodeIndexValue` falls through to `return value`
without encoding.

This means:
- **Codec fields** (e.g., `zx.date()` on `createdAt`) won't be encoded back to wire format
  when used in `.withIndex()` comparisons. A real Convex backend would reject a `Date` where
  it expects a `number`.
- **Non-codec fields** (strings, numbers, IDs) happen to work because they're already in wire
  format, but they bypass Zod validation that object-schema fields get.

## Why the naive fix doesn't work

The obvious approach — find the field in the first matching variant and `z.encode()` through it —
breaks on discriminator fields. Each variant has a different `z.literal()` for the discriminator:

```
variant 1: kind → z.literal('email')
variant 2: kind → z.literal('push')
variant 3: kind → z.literal('in_app')
```

`z.encode(z.literal('email'), 'push')` throws a validation error because `z.encode()` validates
before transforming.

## Correct design

For each indexed field in a union schema, construct a **per-field union** of that field's schema
across all variants, then `z.encode()` against that union:

```typescript
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  if (fieldPath.includes('.')) return value

  if (schema instanceof z.ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }

  // Union schemas: build a per-field union from all variants
  const options = (schema as any)._zod?.def?.options as z.ZodTypeAny[] | undefined
  if (options) {
    const fieldSchemas: z.ZodTypeAny[] = []
    for (const variant of options) {
      if (variant instanceof z.ZodObject) {
        const fs = (variant as z.ZodObject<any>).shape[fieldPath]
        if (fs) fieldSchemas.push(fs)
      }
    }
    if (fieldSchemas.length > 0) {
      // Deduplicate identical schemas? Or just let z.union handle it.
      const fieldUnion = fieldSchemas.length === 1
        ? fieldSchemas[0]
        : z.union(fieldSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
      return z.encode(fieldUnion, value)
    }
  }

  return value
}
```

This preserves validation guarantees:
- `z.encode(z.union([z.literal('email'), z.literal('push'), z.literal('in_app')]), 'push')` succeeds
- `z.encode(z.union([zx.date(), zx.date(), zx.date()]), new Date())` encodes to number
- `z.encode(z.union([...]), 'invalid')` still throws

## Performance consideration

The per-field union could be cached per (schema, fieldPath) pair to avoid rebuilding on every
index query. A `WeakMap<z.ZodTypeAny, Map<string, z.ZodTypeAny>>` would work.

## Test coverage

`examples/task-manager/convex/notifications.test.ts` has tests for:
- `by_kind` — discriminator field index (exercises the literal union case)
- `by_recipient_and_kind` — compound index with discriminator
- `by_created` — codec field (`zx.date()`) through union

These pass in convex-test (lenient in-memory engine) but would fail on a real Convex backend
without this fix.

## Level of effort

Small — ~20 lines of code change in `encodeIndexValue`, plus caching if desired.
