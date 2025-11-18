# Issue #20: `zodTable` to accept union schemas

**Reporter:** @sbkl
**Created:** 2025-11-01
**Status:** Feature request - research needed
**Priority:** Medium
**Labels:** enhancement, unions, polymorphic-tables

## Problem Statement

User wants to create polymorphic Convex tables using Zod discriminated unions. Currently `zodTable` only accepts object shapes, not union schemas.

### User's Desired API

```typescript
import { zodTable } from 'zodvex'
import { z } from 'zod'

const baseShapeSchema = z.object({
  color: z.string(),
  strokeWidth: z.number(),
  isFilled: z.boolean().optional(),
  index: z.number(),
})

const shapeSchema = z.union([
  baseShapeSchema.extend({
    kind: z.literal("path"),
    path: z.string(),
  }),
  baseShapeSchema.extend({
    kind: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number(),
  }),
  baseShapeSchema.extend({
    kind: z.literal("rectangle"),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
])

// ❌ Currently doesn't work
export const Shapes = zodTable("shapes", shapeSchema)
```

### Current Error

Type error because `zodTable` signature expects `Record<string, z.ZodTypeAny>`:

```typescript
// src/tables.ts:70
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape  // <-- Can't accept z.ZodUnion
)
```

### Current Workaround

Users can use `Table` and `zodToConvex` directly:

```typescript
import { Table } from 'convex-helpers/server'
import { zodToConvex } from 'zodvex'

const Shapes = Table('shapes', zodToConvex(shapeSchema))
// But loses .shape, .zDoc, .docArray helpers
```

## Research: How Does convex-helpers Handle This?

**Action Required:** Review `convex-helpers/server/zod4.ts` to understand:

1. Do they support unions in table definitions?
2. How do they prevent infinite type depth with unions?
3. What's their approach to discriminated unions?
4. Do they have any helpers similar to our `zodTable`?

### Questions to Answer

- [ ] Does convex-helpers/zod4 support `defineTable(zodToConvex(unionSchema))`?
- [ ] How do they handle type inference for unions?
- [ ] Do they have type depth bailouts like our `InferReturns`?
- [ ] What's the generated Convex validator structure for unions?
- [ ] Any documented limitations or best practices?

### Research Method

```bash
# Check their implementation
gh repo clone get-convex/convex-helpers
cd convex-helpers/packages/convex-helpers/server
cat zod4.ts | grep -A 20 "union"
cat zod4.zodtoconvex.test.ts | grep -A 10 "union"
```

**TODO:** Perform this research and document findings here.

## Technical Challenges

### Challenge 1: Type Inference with Unions

Union tables don't have a fixed "shape":
```typescript
// What is the shape of a union?
type Shape = {
  // Circle has cx, cy, r
  // Rectangle has x, y, width, height
  // Path has path
  // ??? How to represent this?
}
```

### Challenge 2: Document Helpers

Standard `zodTable` provides:
- `.shape` - The raw object shape
- `.zDoc` - Schema with `_id` and `_creationTime`
- `.docArray` - Array schema for return types

Union tables can't provide `.shape` (no fixed shape) or `.zDoc` (which variant?).

### Challenge 3: TypeScript Complexity

Discriminated unions can create deep type nesting:
```typescript
type ShapeDoc =
  | { _id: Id<'shapes'>, kind: 'path', ... }
  | { _id: Id<'shapes'>, kind: 'circle', ... }
  | { _id: Id<'shapes'>, kind: 'rectangle', ... }
```

This can hit TypeScript instantiation depth limits.

## Proposed Solutions

### Option 1: Separate `zodTableUnion` Helper

Create a specialized helper for union tables:

```typescript
export function zodTableUnion<
  TableName extends string,
  Union extends z.ZodUnion<any>
>(
  name: TableName,
  unionSchema: Union
) {
  const convexValidator = zodToConvex(unionSchema)
  const table = Table<typeof convexValidator, TableName>(name, convexValidator)

  return Object.assign(table, {
    schema: unionSchema,
    docArray: z.array(unionSchema),
    // No .shape or .zDoc - unions don't have fixed shapes

    // Provide variant helpers instead
    withSystemFields: () => {
      // Add _id and _creationTime to each union variant
      if (unionSchema instanceof z.ZodUnion) {
        const options = unionSchema.options.map(variant => {
          if (variant instanceof z.ZodObject) {
            return variant.extend({
              _id: zid(name),
              _creationTime: z.number()
            })
          }
          return variant
        })
        return z.union(options as any)
      }
      return unionSchema
    }
  })
}

// Usage
const Shapes = zodTableUnion('shapes', shapeSchema)

Shapes.table // For schema
Shapes.schema // Original union schema
Shapes.docArray // For return types
Shapes.withSystemFields() // Union with _id/_creationTime added to each variant
```

**Pros:**
- Clear separation: `zodTable` for objects, `zodTableUnion` for unions
- Avoids type confusion
- Can provide union-specific helpers

**Cons:**
- Two separate APIs to learn
- Doesn't feel as unified

### Option 2: Overload `zodTable` to Accept Both

Use TypeScript overloads:

```typescript
// Overload 1: Object shape
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): /* Object return type */

// Overload 2: Union schema
export function zodTable<TableName extends string, Union extends z.ZodUnion<any>>(
  name: TableName,
  union: Union
): /* Union return type */

// Implementation
export function zodTable(name: string, shapeOrUnion: any) {
  if (shapeOrUnion instanceof z.ZodUnion) {
    return zodTableUnion(name, shapeOrUnion)
  }
  // ... existing object logic
}
```

**Pros:**
- Single API to learn
- Feels more unified

**Cons:**
- Complex typing
- Return types are very different (confusing?)
- Harder to document

### Option 3: Document the Direct Approach

Simply document how to use `Table` + `zodToConvex` for unions:

**README.md addition:**

```md
### Polymorphic Tables with Unions

For discriminated union tables, use `Table` and `zodToConvex` directly:

\`\`\`typescript
import { Table } from 'convex-helpers/server'
import { zodToConvex, zid } from 'zodvex'

const shapeSchema = z.union([
  z.object({ kind: z.literal("circle"), cx: z.number(), ... }),
  z.object({ kind: z.literal("rectangle"), x: z.number(), ... }),
])

// Define the table
export const Shapes = Table('shapes', zodToConvex(shapeSchema))

// For return types, use the schema directly with system fields
export const ShapeDoc = z.union([
  z.object({
    _id: zid('shapes'),
    _creationTime: z.number(),
    kind: z.literal("circle"),
    ...
  }),
  // ... other variants
])

export const getShapes = zq({
  args: {},
  returns: z.array(ShapeDoc),
  handler: async (ctx) => ctx.db.query('shapes').collect()
})
\`\`\`

**Note:** Union tables don't have a fixed `.shape`, so use the schema directly.
```

**Pros:**
- No new API to maintain
- Clear and explicit
- Works today

**Cons:**
- Less ergonomic
- Manual system field addition

## Recommended Approach

**Short term (Next PR):** Option 3 - Document the workaround clearly

**Medium term (1-2 weeks):** Option 1 - Add `zodTableUnion` helper after research

**Rationale:**
1. Document first so users aren't blocked
2. Research convex-helpers' approach before implementing
3. `zodTableUnion` provides better DX than manual approach
4. Keeping APIs separate is clearer than overloading

## Implementation Plan

### Phase 1: Documentation (Immediate)

Add to README.md:
- [ ] New section "Polymorphic Tables with Unions"
- [ ] Example with discriminated unions
- [ ] Show how to add system fields manually
- [ ] Link to Convex docs on polymorphic data

### Phase 2: Research (Short term)

- [ ] Review convex-helpers/zod4 implementation
- [ ] Test union tables with convex-helpers
- [ ] Document their approach and limitations
- [ ] Identify type depth issues they solved
- [ ] Update this document with findings

### Phase 3: Implementation (Medium term)

If research shows it's feasible:
- [ ] Implement `zodTableUnion` helper
- [ ] Add `withSystemFields()` utility
- [ ] Write comprehensive tests
- [ ] Add to API documentation
- [ ] Create example project

### Phase 4: Advanced Features (Future)

- [ ] Type-safe discriminator helpers
- [ ] Variant extraction utilities
- [ ] Migration helpers for polymorphic tables

## Testing Requirements

### When Implemented

- [ ] Test discriminated union tables
- [ ] Test nested unions
- [ ] Test union with shared base schema
- [ ] Test array of union documents
- [ ] Test type inference for each variant
- [ ] Test `withSystemFields()` adds to all variants

### Edge Cases

- [ ] Empty union (should fail gracefully)
- [ ] Union of primitives (not objects)
- [ ] Deeply nested unions (3+ levels)
- [ ] Union with optional discriminator

## Open Questions

1. **How do users typically query union tables?**
   ```typescript
   // Do they filter by discriminator?
   ctx.db.query('shapes')
     .filter(q => q.eq(q.field('kind'), 'circle'))

   // Or fetch all and handle variants?
   const shapes = await ctx.db.query('shapes').collect()
   const circles = shapes.filter(s => s.kind === 'circle')
   ```

2. **Should we provide discriminator-aware helpers?**
   ```typescript
   Shapes.getVariant('circle') // Returns only circle shapes?
   ```

3. **How to handle migrations from non-union to union tables?**

## References

- Original Issue: https://github.com/panzacoder/zodvex/issues/20
- Convex Polymorphic Data: https://docs.convex.dev/database/types#polymorphic-types
- Zod Discriminated Unions: https://zod.dev/discriminated-unions
- TypeScript Discriminated Unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions

## Research Findings

**Completed:** 2025-01-18

### Questions for Research
1. ✅ How do they convert `z.union()` to `v.union()`?
2. ✅ Do they support unions in table definitions?
3. ✅ How do they handle type inference?
4. ✅ Any type depth bailouts?
5. ✅ What's their testing coverage for unions?

### Findings from convex-helpers/zod4 (PR #840)

#### 1. Union Conversion Strategy

convex-helpers handles unions with a simple recursive approach:

```typescript
case "ZodUnion":
case "ZodDiscriminatedUnion":
  return v.union(
    ...zod._def.options.map((v: z.ZodTypeAny) => zodToConvex(v)),
  ) as ConvexValidatorFromZod<Z>;
```

**Key insights:**
- Maps over each union option and recursively converts
- Handles both `z.union()` and `z.discriminatedUnion()` identically
- No special depth limiting or bailouts
- Relies on TypeScript's ability to handle the recursion

#### 2. Support for Unions in Table Definitions

**Yes, they support it!** Their test suite includes:

```typescript
zodToConvexFields({
  union: z.union([z.string(), z.object({ c: z.array(z.number()) })]),
  discUnion: z.discriminatedUnion("type", [
    z.object({ type: z.literal("a"), a: z.string() }),
    z.object({ type: z.literal("b"), b: z.number() }),
  ]),
})

// Converts to:
{
  union: v.union(v.string(), v.object({ c: v.array(v.number()) })),
  discUnion: v.union(
    v.object({ type: v.literal("a"), a: v.string() }),
    v.object({ type: v.literal("b"), b: v.number() }),
  ),
}
```

**This means unions work in `defineTable()` using `zodToConvexFields()`!**

#### 3. Type Inference Approach

convex-helpers uses a mapped type approach:

```typescript
type ConvexValidatorFromZod<Z extends z.ZodTypeAny> =
  Z extends z.ZodUnion<infer Options>
    ? VUnion<...> // Complex mapped type
    : // ... other cases
```

**No bailouts to `any`** - they rely on TypeScript's recursion handling.

#### 4. Type Depth Bailouts

**None found!** Unlike our `InferReturns` which bails to `any` for unions, convex-helpers attempts full inference.

**Why they can do this:**
- They don't provide higher-level table helpers like our `zodTable`
- Their type inference is at the validator level, not the full table level
- Users are expected to work with `zodToConvexFields()` directly
- Simpler type surface area

#### 5. Testing Coverage for Unions

Extensive union testing:
- Simple unions: `z.union([z.string(), z.number()])`
- Object unions: `z.union([z.string(), z.object({ ... })])`
- Discriminated unions: `z.discriminatedUnion("type", [...])`
- Single-member unions: `z.union([z.literal("hello")])`
- Nested unions within objects
- Unions in records

**No reported TypeScript depth issues in their test suite.**

### Implications for zodvex

#### What This Means

1. **Unions DO work with Convex table definitions** - User can use:
   ```typescript
   defineTable(zodToConvexFields(unionSchema))
   ```

2. **Our `zodTable` limitation is artificial** - We restrict to `Record<string, z.ZodTypeAny>` but could accept unions

3. **Type depth fears may be overblown** - convex-helpers doesn't bail and hasn't reported issues

#### The Real Challenge: Table Helpers

The issue isn't converting unions - it's providing useful helpers:

```typescript
// What should these be for a union table?
UnionTable.shape    // ??? No fixed shape
UnionTable.zDoc     // ??? Which variant?
UnionTable.docArray // z.array(union) - this works!
```

**Possible approach:**
```typescript
UnionTable.schema      // The original union schema
UnionTable.variants    // Array of variant schemas?
UnionTable.docArray    // z.array(union with system fields)
UnionTable.withSystemFields() // Adds _id/_creationTime to each variant
```

### Recommended Implementation

Based on convex-helpers' approach:

```typescript
export function zodTable<TableName extends string, Schema extends z.ZodTypeAny>(
  name: TableName,
  schema: Schema
) {
  // Detect if it's an object shape or other schema
  if (isObjectShape(schema)) {
    // Current object-based logic
    return objectTableHelpers(name, schema)
  } else {
    // Union or other schema types
    const convexValidator = zodToConvex(schema)
    const table = Table(name, convexValidator)

    return Object.assign(table, {
      schema,
      docArray: z.array(addSystemFields(name, schema)),
      withSystemFields: () => addSystemFields(name, schema)
    })
  }
}

function addSystemFields<T extends string, S extends z.ZodTypeAny>(
  tableName: T,
  schema: S
) {
  if (schema instanceof z.ZodUnion) {
    // Add system fields to each variant
    const withFields = schema.options.map(variant => {
      if (variant instanceof z.ZodObject) {
        return variant.extend({
          _id: zid(tableName),
          _creationTime: z.number()
        })
      }
      return variant
    })
    return z.union(withFields as any)
  }

  if (schema instanceof z.ZodObject) {
    return schema.extend({
      _id: zid(tableName),
      _creationTime: z.number()
    })
  }

  return schema
}
```

### Action Items Updated

**Short term:**
- [x] Research convex-helpers approach (DONE)
- [ ] Update documentation showing union support via `zodToConvexFields`
- [ ] Add examples of union tables in README

**Medium term:**
- [ ] Implement polymorphic `zodTable` that accepts unions
- [ ] Add `withSystemFields()` helper for unions
- [ ] Comprehensive union tests
- [ ] Update type inference (remove union bailout?)

**Low priority:**
- [ ] Variant extraction utilities
- [ ] Type-safe discriminator helpers
