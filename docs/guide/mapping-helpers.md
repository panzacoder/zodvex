# Mapping Helpers

zodvex provides low-level helpers for converting Zod schemas directly to Convex validators. These are building blocks used internally by zodvex and available for advanced use cases. See the [README](../../README.md) for a full overview of zodvex.

## `zodToConvex`

Convert a single Zod type to its Convex validator equivalent:

```ts
import { zodToConvex } from 'zodvex'

// Single type conversion
const validator = zodToConvex(z.string().optional())
// → v.optional(v.string())

const validator2 = zodToConvex(z.number().nullable())
// → v.union(v.float64(), v.null())
```

## `zodToConvexFields`

Convert an object shape (record of Zod types) to Convex field validators:

```ts
import { zodToConvexFields } from 'zodvex'

const fields = zodToConvexFields({
  name: z.string(),
  age: z.number().nullable()
})
// → { name: v.string(), age: v.union(v.float64(), v.null()) }
```

## When to Use These

Most zodvex users won't need these directly — `defineZodModel` and `initZodvex` handle validator generation automatically. These helpers are useful when:

- Integrating with other Convex utilities that expect raw validators
- Building custom abstractions on top of zodvex
- Debugging to see exactly what Convex validator a Zod schema produces

## Import Path

Both helpers are available from all zodvex entry points:

```ts
import { zodToConvex, zodToConvexFields } from 'zodvex'
import { zodToConvex, zodToConvexFields } from 'zodvex/mini'
import { zodToConvex, zodToConvexFields } from 'zodvex/server'
```

## Zod v4 Enum Type Note

Enum types in Zod v4 produce a slightly different TypeScript signature than manually created unions:

```typescript
// Manual union (precise tuple type)
const manual = v.union(v.literal('a'), v.literal('b'))
// Type: VUnion<"a" | "b", [VLiteral<"a", "required">, VLiteral<"b", "required">], "required", never>

// From Zod enum (array type)
const fromZod = zodToConvex(z.enum(['a', 'b']))
// Type: VUnion<"a" | "b", Array<VLiteral<"a" | "b", "required">>, "required", never>
```

**This difference is purely cosmetic with no functional impact:**

- Value types are identical (`"a" | "b"`)
- Runtime validation is identical
- Type safety for function arguments/returns is preserved
- Convex uses `T[number]` which works identically for both array and tuple types

This limitation exists because Zod v4 changed enum types from tuple-based to Record-based ([`ToEnum<T>`](https://github.com/colinhacks/zod/blob/v4/src/v4/core/util.ts#L83-L85)). TypeScript cannot convert a Record type to a specific tuple without knowing the keys at compile time. See [Zod v4 changelog](https://zod.dev/v4/changelog) and [enum evolution discussion](https://github.com/colinhacks/zod/discussions/2125) for more details.
