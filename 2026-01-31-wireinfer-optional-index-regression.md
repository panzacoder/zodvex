# WireInfer Optional Handling Breaks Index Path Typing

## Summary

The `WireInfer` type fix (commit 3164832) introduced a regression: when an optional field has nested properties used in an index, the index equality type resolves to `undefined` instead of the actual value type.

## Context

- **Previous issue fixed**: `WireInfer` was added to ensure nested codecs use wire types in document inference (fixes GenericDataModel constraint errors)
- **New regression**: Index queries on optional fields with nested paths now fail type checking

## Reproduction

```typescript
import { z } from 'zod'
import { zodTable, zodvexCodec } from 'zodvex'

// Sensitive codec (wire format has .value property)
const sensitive = <T extends z.ZodTypeAny>(inner: T) => zodvexCodec(
  z.object({ value: inner.nullable(), status: z.enum(['full', 'hidden']) }),
  z.custom<SensitiveField<z.output<T>>>(),
  { decode: ..., encode: ... }
)

const patientShape = {
  clinicId: z.string(),
  email: sensitive(z.string().email()).optional(),  // ← Optional sensitive field
}

const Patient = zodTable('patients', patientShape)

// Table with index on nested path
const table = Patient.table
  .index('email', ['email.value'])  // ← Index on nested .value
```

**Query using the index:**
```typescript
const results = await db.query('patients', (q) =>
  q.withIndex('email', (iq) => iq.eq('email.value', emailValue))
  //                                                ^^^^^^^^^^
  // Error: Argument of type 'string' is not assignable to parameter of type 'undefined'
)
```

## Root Cause

In `mapping/types.ts`, `WireInfer` handles optionals at lines 43-44:

```typescript
Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
  ? WireInfer<Inner> | undefined
```

For `email: sensitive(...).optional()`:
1. `WireInfer` produces: `{ value: string | null; status: ... } | undefined`
2. When Convex resolves index path `['email.value']`:
   - It sees `email` can be `undefined`
   - `undefined.value` → `undefined`
   - The `{ value: string | null; ... }` branch gets lost

The index field path typing picks up only the `undefined` case, not the full union.

## Comparison

| zodvex version | GenericDataModel | Index path typing |
|----------------|------------------|-------------------|
| 9c9484a (before WireInfer) | ❌ Broken | ✅ Works |
| 3164832 (with WireInfer) | ✅ Fixed | ❌ Broken |

## Expected Behavior

Index path typing should handle optional fields correctly:
- `email.value` on `{ value: T; ... } | undefined` should resolve to `T | undefined`
- Not just `undefined`

## Suggested Investigation

The issue may be in how Convex's `ExtractFieldPaths` or index typing utilities handle union types with `undefined`. Possible approaches:

1. **Exclude undefined before path extraction**:
   ```typescript
   type NonUndefined<T> = T extends undefined ? never : T
   // Use NonUndefined<WireInfer<Z>> for field path extraction
   ```

2. **Use a different type for index paths vs document type**:
   - Document type: `{ value: ... } | undefined` (correct for storage)
   - Index paths: Extract from non-undefined variant only

3. **Check how Convex's TableDefinition handles optional fields in indexes**:
   - The table definition accepts `['email.value']` as a valid index
   - The query typing should match what the table definition allows

## Affected Code

- `src/mapping/types.ts` - `WireInfer` type definition
- Anywhere `WireInfer` is used for VObject document types that flow into index typing

## Test Case

This should work after the fix:
```typescript
const Patient = zodTable('patients', {
  email: sensitive(z.string()).optional(),
})

const table = Patient.table.index('email', ['email.value'])

// Query should accept string for email.value, not require undefined
declare const q: QueryInitializer<typeof table>
q.withIndex('email', (iq) => iq.eq('email.value', 'test@example.com'))  // Should compile
```
