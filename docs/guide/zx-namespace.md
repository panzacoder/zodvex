# The zx Namespace

The `zx` namespace provides zodvex-specific validators and codecs. The name signals "zodvex" or "zod + convex" — explicit handling for Convex compatibility. See the [README](../../README.md) for a full overview of zodvex.

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'

const schema = z.object({
  id: zx.id('users'),      // Typed ID validator
  createdAt: zx.date(),    // Date ↔ timestamp codec
  secret: zx.codec(...)    // Custom codec
})
```

## Helpers Overview

| Helper | Wire Format | Runtime Format | Type | Use Case |
|--------|------------|----------------|------|----------|
| `zx.id('table')` | `string` | `GenericId<T>` | Validator (no wire transformation) | Convex document IDs |
| `zx.date()` | `number` | `Date` | Codec (transforms wire ↔ runtime) | Timestamps |
| `zx.codec(wire, runtime, transforms)` | Custom | Custom | Codec (transforms wire ↔ runtime) | Custom transformations |

> **Important distinction:** `zx.id()` is a **typed validator** — it validates that a value is a Convex ID string and brands the TypeScript type, but performs no wire format transformation. `zx.date()` and `zx.codec()` are **codecs** — they transform data between wire format (stored in Convex) and runtime format (used in your code).

## Why `zx.*` instead of `z.*`?

- Makes Convex-specific behavior explicit (no "magic")
- Clearly distinct from standard Zod types
- Discoverable via IDE autocomplete on `zx.`
- Signals to readers that wire format handling is involved (for codecs)

## Convex IDs — `zx.id()`

`zx.id('tableName')` is a **typed validator**, not a codec. It validates that a string is a valid Convex document ID and brands the TypeScript type as `GenericId<'tableName'>`. No data transformation happens at the wire level — the value is stored and retrieved as-is.

```ts
import { zx } from 'zodvex/core'

// Basic usage
zx.id('users')             // Validates string, types as GenericId<'users'>
zx.id('users').optional()  // → v.optional(v.id('users'))
zx.id('users').nullable()  // → v.union(v.id('users'), v.null())

// In a schema
const schema = z.object({
  userId: zx.id('users'),
  teamId: zx.id('teams').optional()
})
```

**Convex validator mapping:**
```ts
zx.id('tableName')  // → v.id('tableName')
```

**AI SDK compatibility:** Because `zx.id()` uses type-level branding instead of `.transform()`, it works with Vercel's AI SDK, which rejects schemas containing transforms.

## Dates — `zx.date()`

`zx.date()` is a **codec** that transforms between JavaScript `Date` objects (runtime) and Convex timestamps stored as `v.float64()` (wire format).

```ts
import { zx } from 'zodvex/core'

zx.date()            // → v.float64() (timestamp on wire)
zx.date().optional() // → v.optional(v.float64())
zx.date().nullable() // → v.union(v.float64(), v.null())
```

**How it works:**
- **Args (inbound):** Timestamps from the client → decoded to `Date` objects in your handler
- **Returns (outbound):** `Date` objects from your handler → encoded to timestamps for the client
- **Storage:** Always stored as `v.float64()` (Convex has no native Date type)

```ts
const eventShape = {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().nullable(),
  createdAt: zx.date().optional()
}
```

> **Note:** Native `z.date()` is **not supported** — use `zx.date()` instead. Using `z.date()` will throw an error at runtime with guidance to migrate.

## Custom Codecs — `zx.codec()`

`zx.codec()` is a **codec** for custom wire format transformations. Use it when you need to transform data between storage format and runtime format beyond what `zx.date()` provides.

```ts
import { zx } from 'zodvex/core'

const myCodec = zx.codec(
  z.object({ encrypted: z.string() }),  // Wire schema (stored in Convex)
  z.custom<string>(() => true),         // Runtime schema (used in code)
  {
    decode: (wire) => decrypt(wire.encrypted),
    encode: (value) => ({ encrypted: encrypt(value) })
  }
)
```

See [Custom Codecs](./custom-codecs.md) for full documentation.

## Supported Type Mappings

For reference, here are all Zod types supported by zodvex and their Convex validator equivalents:

| Zod Type             | Convex Validator                            |
| -------------------- | ------------------------------------------- |
| `z.string()`         | `v.string()`                                |
| `z.number()`         | `v.float64()`                               |
| `z.bigint()`         | `v.int64()`                                 |
| `z.boolean()`        | `v.boolean()`                               |
| `z.null()`           | `v.null()`                                  |
| `z.array(T)`         | `v.array(T)`                                |
| `z.object({...})`    | `v.object({...})`                           |
| `z.record(T)`        | `v.record(v.string(), T)`                   |
| `z.union([...])`     | `v.union(...)`                              |
| `z.literal(x)`       | `v.literal(x)`                              |
| `z.enum(['a', 'b'])` | `v.union(v.literal('a'), v.literal('b'))` ¹ |
| `z.optional(T)`      | `v.optional(T)`                             |
| `z.nullable(T)`      | `v.union(T, v.null())`                      |
| `zx.id('table')`     | `v.id('table')`                             |
| `zx.date()`          | `v.float64()`                               |
| `zx.codec(w, r, t)`  | _(wire schema's validator)_                 |

> **Note:** Native `z.date()` is **not supported** — use `zx.date()` instead.

### Zod v4 Enum Note

¹ Enum types in Zod v4 produce a slightly different TypeScript signature than manually created unions:

```typescript
// Manual union (precise tuple type)
const manual = v.union(v.literal('a'), v.literal('b'))
// Type: VUnion<"a" | "b", [VLiteral<"a", "required">, VLiteral<"b", "required">], "required", never>

// From Zod enum (array type)
const fromZod = zodToConvex(z.enum(['a', 'b']))
// Type: VUnion<"a" | "b", Array<VLiteral<"a" | "b", "required">>, "required", never>
```

This difference is purely cosmetic with no functional impact:

- Value types are identical (`"a" | "b"`)
- Runtime validation is identical
- Type safety for function arguments/returns is preserved
- Convex uses `T[number]` which works identically for both array and tuple types

This limitation exists because Zod v4 changed enum types from tuple-based to Record-based. TypeScript cannot convert a Record type to a specific tuple without knowing the keys at compile time.
