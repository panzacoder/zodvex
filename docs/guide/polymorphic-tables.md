# Polymorphic Tables with Unions

zodvex fully supports polymorphic tables using discriminated unions. Pass a union schema directly to `defineZodModel()`:

```ts
import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'
import { defineZodSchema } from 'zodvex/server'
import { zq, zm } from './functions'

// Define your discriminated union schema
const shapeSchema = z.union([
  z.object({
    kind: z.literal('circle'),
    cx: z.number(),
    cy: z.number(),
    r: z.number()
  }),
  z.object({
    kind: z.literal('rectangle'),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }),
  z.object({
    kind: z.literal('path'),
    path: z.string()
  })
])

// Define the model — defineZodModel() accepts unions!
export const Shapes = defineZodModel('shapes', shapeSchema)

// Use in your schema — the table becomes a Convex union validator
export default defineZodSchema({
  shapes: Shapes
})

// zx.docArray() adds system fields to each variant
export const getShapes = zq({
  args: {},
  returns: zx.docArray(Shapes),  // ✅ Each variant has _id and _creationTime
  handler: async (ctx) => ctx.db.query('shapes').collect()
})

// Create with type-safe discriminated unions
export const createShape = zm({
  args: { shape: shapeSchema },
  handler: async (ctx, { shape }) => {
    // shape is discriminated — TypeScript knows the fields based on `kind`
    return await ctx.db.insert('shapes', shape)
  }
})
```

## Union Model Surface

A union model exposes the same surface as an object model, with a couple of union-specific caveats:

```ts
const Shapes = defineZodModel('shapes', shapeSchema)

Shapes.name            // 'shapes'
Shapes.validator       // The exact Zod union you passed in (refinements preserved)
zx.doc(Shapes)         // Union with _id and _creationTime added to each variant
zx.docArray(Shapes)    // z.array of the doc union — for `returns`
zx.update(Shapes)      // Update schema derived from the union
Shapes.index(...)      // Index builders work as usual

// Union-specific caveats:
// Shapes.fields — empty for unions (there is no single object shape)
// Use zx.doc()/zx.base() to derive schemas instead of spreading fields
```

## Advanced Union Patterns

**Shared base schema:**

```ts
const baseShape = z.object({
  color: z.string(),
  strokeWidth: z.number()
})

const shapeSchema = z.union([
  baseShape.extend({
    kind: z.literal('circle'),
    radius: z.number()
  }),
  baseShape.extend({
    kind: z.literal('rectangle'),
    width: z.number(),
    height: z.number()
  })
])

export const Shapes = defineZodModel('shapes', shapeSchema)
```

**Using z.discriminatedUnion:**

```ts
const shapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), r: z.number() }),
  z.object({ kind: z.literal('rectangle'), w: z.number(), h: z.number() })
])

export const Shapes = defineZodModel('shapes', shapeSchema)
```

**When to use discriminated unions:**
- Polymorphic data (e.g., different shape types, notification variants)
- Tables with multiple distinct subtypes sharing common fields
- Event sourcing patterns with different event types
- When you need type-safe variant handling in TypeScript

**Learn more:**
- [Convex Polymorphic Data](https://docs.convex.dev/database/types#polymorphic-types)
- [Zod Discriminated Unions](https://zod.dev/discriminated-unions)
