# Nested Codec Wire Type Issue

## Summary

When a `z.ZodCodec` (including `zodvexCodec`-created codecs) is nested inside a `z.object()` that's used as a field type, the **document type** in `VObject` uses `z.infer<Z>` (runtime type) instead of the wire type. This causes TypeScript errors when the DataModel is checked against Convex's `GenericDocument` constraint.

## Reproduction

```typescript
import { z } from 'zod'
import { zodTable, zodvexCodec } from 'zodvex'

// A codec that transforms wire ↔ runtime
const sensitive = <T extends z.ZodTypeAny>(inner: T) => zodvexCodec(
  z.object({ value: inner.nullable(), status: z.enum(['full', 'hidden']) }), // wire
  z.custom<SensitiveField<z.output<T>>>(),  // runtime
  { decode: ..., encode: ... }
)

// Nested z.object with codec inside
const CheckinPayload = z.object({
  name: sensitive(z.string()),  // ← Codec nested in z.object
  hasVideoAccess: z.boolean(),
})

// Table shape using the nested object
const journalShape = {
  visitId: zid('visits'),
  payload: z.union([CheckinPayload, OtherPayload]),
}

const Journal = zodTable('journal', journalShape)
```

**Error:**
```
Type 'SensitiveField<string>' is not assignable to type 'Value | undefined'.
```

## Root Cause

In `mapping/types.ts`, the `ZodObject` handler uses `z.infer<Z>` for the document type:

```typescript
// Line 76-77 and 177-180
Z extends z.ZodObject<infer T>
  ? VObject<z.infer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>
           ^^^^^^^^^^
           Uses z.infer = z.output = runtime type
           For codecs, this gives SensitiveField<T> instead of wire format
```

The **validators** are correctly converted (codecs are detected and wire schemas used), but the **document type** parameter of `VObject` still uses the Zod output type.

## The Fix

Create a recursive type helper that extracts wire types for codecs:

```typescript
/**
 * Recursively extracts the wire/input type from a Zod schema.
 * For codecs, uses z.input (wire format).
 * For objects, recursively processes each field.
 * For other types, falls back to z.infer.
 */
type WireInfer<Z extends z.ZodTypeAny> =
  // Handle branded zodvex codecs
  Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
    ? z.infer<W>
  // Handle native Zod codecs
  : Z extends z.ZodCodec<infer Wire extends z.ZodTypeAny, any>
    ? z.infer<Wire>
  // Recursively process objects
  : Z extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? { [K in keyof Shape]: WireInfer<Shape[K]> }
  // Handle optionals
  : Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
    ? WireInfer<Inner> | undefined
  // Handle nullables
  : Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
    ? WireInfer<Inner> | null
  // Handle arrays
  : Z extends z.ZodArray<infer Element extends z.ZodTypeAny>
    ? WireInfer<Element>[]
  // Handle unions
  : Z extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
    ? WireInfer<Options[number]>
  // Fallback to regular inference
  : z.infer<Z>
```

Then update the `ZodObject` handlers:

```typescript
// Before:
Z extends z.ZodObject<infer T>
  ? VObject<z.infer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>

// After:
Z extends z.ZodObject<infer T>
  ? VObject<WireInfer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>
```

## Why This Matters

1. **Convex's GenericDocument constraint**: Requires all nested values to be `Value` types. Custom classes like `SensitiveField` fail this check.

2. **DataModel represents DB schema**: The document type should reflect what's actually stored in the database (wire format), not the runtime representation after decoding.

3. **Consistency**: The validators correctly use wire schemas, but the document type doesn't match.

## Affected Locations

In `src/mapping/types.ts`:
- Line 76-77: `ConvexValidatorFromZodBase` object handler
- Line 177-180: `ConvexValidatorFromZod` object handler
- Potentially other places that use `z.infer<Z>` for nested object document types

## Testing

After the fix, this should pass:
```typescript
const Journal = zodTable('journal', journalShape)

// Document type should now be:
// { payload: { name: { value: string | null; status: 'full' | 'hidden' }; ... } | ... }
// Instead of:
// { payload: { name: SensitiveField<string>; ... } | ... }
```

And `DataModel` should satisfy `GenericDataModel` without type errors.
