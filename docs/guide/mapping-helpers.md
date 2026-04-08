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
