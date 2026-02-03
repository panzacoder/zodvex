# zodvex Type Inference Issue: `z.object()` vs Raw Object Shapes

## Summary

When using `zodTable()` with a `z.object()` wrapped schema, TypeScript loses field-level type information and falls back to `[x: string]: any`. When using a raw object shape (without `z.object()` wrapper), types are preserved correctly.

## Environment

- zodvex: `github:panzacoder/zodvex#21dd247f7f596061f89297a9960768c48dfd4c6b`
- TypeScript: 5.x
- Convex: latest

## Reproduction

### ✅ WORKS: Raw object shape

```typescript
import { z } from 'zod'
import { zodTable } from 'zodvex'

// Raw object shape - NOT wrapped in z.object()
const patientShape = {
  clinicId: z.string(),
  email: z.string().email().optional(),
  firstName: z.string().optional(),
}

export const Patient = zodTable('patients', patientShape)
```

**Resulting type signature (CORRECT):**
```typescript
patients: TableDefinition<VObject<{
    clinicId: VString<"required", string>;
    email: VString<"optional", string>;
    firstName: VString<"optional", string>;
}, { ... }, "required", string>, { ... }>
```

### ❌ BROKEN: z.object() wrapped schema

```typescript
import { z } from 'zod'
import { zid, zodTable } from 'zodvex'

// Wrapped in z.object() - loses type info
const shape = z.object({
  patientId: zid('patients'),
  clinicId: z.string(),
  status: z.enum(['active', 'completed']),
})

export const Visit = zodTable('visits', shape)
```

**Resulting type signature (INCORRECT):**
```typescript
visits: TableDefinition<VObject<{
    [x: string]: any;  // <-- Lost all field types!
}, Record<string, GenericValidator>, "required", string>, { ... }>
```

## Root Cause Analysis

Looking at `zodvex/src/tables.ts`:

1. **Line 241-256**: `isObjectShape()` checks if input is a raw object vs Zod schema
2. **Line 437-448**: Raw shape path uses `ConvexValidatorFromZodFieldsAuto<typeof shape>` - preserves types
3. **Line 513-586**: Zod schema path uses `defineTable(asTableValidator(convexValidator))` - loses types

The issue is that when a `z.ZodObject` is passed, the code falls through to a generic handler that doesn't preserve the mapped type information through TypeScript's inference.

## Expected Behavior

Both patterns should produce identical type signatures:

```typescript
// These should be equivalent
const a = zodTable('foo', { field: z.string() })
const b = zodTable('foo', z.object({ field: z.string() }))
```

## Workaround

Use raw object shapes instead of `z.object()`:

```typescript
// Instead of:
const shape = z.object({ ... })

// Use:
const shape = { ... }
```

## Suggested Fix

The `zodTable()` function should extract the shape from `z.ZodObject` and process it through the same type-preserving path as raw objects:

```typescript
function zodTable<T extends z.ZodRawShape>(name: string, schema: z.ZodObject<T> | T) {
  const shape = schema instanceof z.ZodObject ? schema.shape : schema
  // ... process shape with ConvexValidatorFromZodFieldsAuto<T>
}
```

This would unify both code paths and preserve type inference regardless of input format.
