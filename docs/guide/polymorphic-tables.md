# Polymorphic Tables with Unions

zodvex fully supports polymorphic tables using discriminated unions. Pass a union schema directly to `defineZodModel()`:

```ts
import { defineZodModel } from 'zodvex'
import { z } from 'zod'

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

// Define the table - defineZodModel() accepts unions!
export const Shapes = defineZodModel('shapes', shapeSchema)

// Use in schema
export default defineSchema({
  shapes: Shapes.table
})

// docArray automatically includes system fields for each variant
export const getShapes = zq({
  args: {},
  returns: Shapes.docArray,  // ✅ Each variant has _id and _creationTime
  handler: async (ctx) => ctx.db.query('shapes').collect()
})

// Create with type-safe discriminated unions
export const createShape = zm({
  args: shapeSchema,
  handler: async (ctx, shape) => {
    // shape is discriminated - TypeScript knows the fields based on `kind`
    return await ctx.db.insert('shapes', shape)
  }
})
```

## Union Table Helpers

Union tables provide different helpers than object tables:

```ts
const Shapes = defineZodModel('shapes', shapeSchema)

// Available properties:
Shapes.table          // TableDefinition for schema
Shapes.tableName      // 'shapes'
Shapes.schema         // Original union schema
Shapes.validator      // Convex validator (union)
Shapes.docArray       // Array schema with system fields added to each variant
Shapes.withSystemFields()  // Returns union with _id and _creationTime on each variant

// NOT available (specific to object tables):
// Shapes.shape       - unions don't have a fixed shape
// Shapes.zDoc        - use withSystemFields() instead
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
