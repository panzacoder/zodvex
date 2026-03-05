# withIndex Codec Encoding

**Date:** 2026-03-04
**Status:** Approved
**Branch:** feat/codec-end-to-end

## Problem

zodvex auto-encodes/decodes at 4 of 6 codec boundaries (DB read, DB write, function args, function returns). The 5th boundary — index query comparisons — is missing. Users must pass pre-encoded wire values to `.eq()`, `.gt()`, etc. in `.withIndex()` callbacks, breaking the codec abstraction.

This is especially painful for `zx.date()`, where the user has a `Date` object but must call `.getTime()` manually:

```ts
// Current: manual encoding required
.withIndex('byDate', q => q.eq('createdAt', myDate.getTime()))

// Desired: pass runtime values, zodvex encodes
.withIndex('byDate', q => q.eq('createdAt', myDate))
```

Hotpot sees warnings on every codec-indexed field:
```
[zodvex] Index "email" on table "patients" includes codec field "email.value".
zodvex does not currently encode values passed to .withIndex() query comparisons...
```

## Design

### Approach: Custom Builder Types + Runtime Encoding (Option 2)

Wrap Convex's `IndexRangeBuilder` with zodvex's own builder interfaces that use decoded types at the type level and auto-encode at runtime. This follows zodvex's established pattern of building custom type layers over Convex's types at wire/decoded boundaries (as done for `ZodvexQueryChain`, `ZodvexDatabaseReader/Writer`).

Alternatives considered:
- **Runtime-only encoding (Option 1):** Auto-encode at runtime but keep Convex's wire-typed builder. Creates "lying types" — IDE shows `number` but `Date` works. Leads to Option 2 eventually.
- **Encode helper only (Option 3):** No auto-encoding, provide `patients.wire('createdAt', myDate)`. Explicit but manual. Goes against zodvex's auto-codec philosophy. Leads to Option 1 → Option 2 eventually.

### Path Resolution Type

The novel type that determines the accepted value type for each index field path:

```ts
type ZodvexIndexFieldValue<
  WireDoc extends GenericDocument,
  DecodedDoc,
  FieldPath extends string
> = FieldPath extends `${string}.${string}`
  ? FieldTypeFromFieldPath<WireDoc, FieldPath>    // dot-path → wire sub-type
  : FieldPath extends keyof DecodedDoc
    ? DecodedDoc[FieldPath]                        // top-level → decoded type
    : FieldTypeFromFieldPath<WireDoc, FieldPath>    // fallback → wire type
```

Resolution rules:

| Path | Rule | Example | Resolved Type |
|------|------|---------|---------------|
| `createdAt` | Top-level, in DecodedDoc | `zx.date()` codec | `Date` |
| `email.value` | Dot-path → wire sub-type | Nested wire field | `string` |
| `_creationTime` | Top-level, not in DecodedDoc | System field | `number` |
| `name` | Top-level, no codec | Plain string field | `string` |

**Why this works:** Dot-paths navigate into the wire-format structure (e.g., `email.value` is a string inside the stored `{ value, encrypted }` object). The comparison value is already a primitive matching the wire field type — no encoding needed. Top-level codec fields are the only case where wire ≠ decoded.

### Custom Builder Interfaces

Mirror Convex's `IndexRangeBuilder` chain hierarchy using `ZodvexIndexFieldValue` instead of `FieldTypeFromFieldPath`:

```ts
type PlusOne<N extends number> = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15][N]

interface ZodvexIndexRangeBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number = 0
> extends ZodvexLowerBoundBuilder<WireDoc, DecodedDoc, IndexFields[FieldNum]> {
  eq(
    fieldName: IndexFields[FieldNum],
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFields[FieldNum]>
  ): ZodvexNextBuilder<WireDoc, DecodedDoc, IndexFields, FieldNum>
}

type ZodvexNextBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number
> = PlusOne<FieldNum> extends IndexFields["length"]
  ? IndexRange
  : ZodvexIndexRangeBuilder<WireDoc, DecodedDoc, IndexFields, PlusOne<FieldNum>>

interface ZodvexLowerBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName> {
  gt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
  gte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
}

interface ZodvexUpperBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends IndexRange {
  lt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
  lte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
}
```

Convex's `IndexRange` abstract class is reused as the terminal return type — no need to redefine it.

### Runtime Encoding

A Proxy wraps Convex's `IndexRangeBuilder` at runtime, encoding comparison values before forwarding:

```ts
function wrapIndexRangeBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop) {
      if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop as string)) {
        return (fieldName: string, value: any) => {
          const encoded = encodeIndexValue(schema, fieldName, value)
          return wrapIndexRangeBuilder(target[prop](fieldName, encoded), schema)
        }
      }
      return target[prop]
    }
  })
}

function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value
  // Top-level: encode through the field's schema
  // Codec fields → transform (e.g., Date → number)
  // Non-codec fields → identity (value passes through unchanged)
  if (schema instanceof z.ZodObject) {
    const fieldSchema = schema.shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }
  return value
}
```

### Integration with ZodvexQueryChain

The `withIndex` method changes its callback parameter type from Convex's `IndexRangeBuilder` to `ZodvexIndexRangeBuilder`, and wraps the builder at runtime:

```ts
withIndex<IndexName extends IndexNames<TableInfo>>(
  indexName: IndexName,
  indexRange?: (
    q: ZodvexIndexRangeBuilder<
      DocumentByInfo<TableInfo>,
      Doc,
      NamedIndex<TableInfo, IndexName>
    >
  ) => IndexRange
): ZodvexQueryChain<TableInfo, Doc> {
  const wrapped = indexRange
    ? (q: any) => indexRange(wrapIndexRangeBuilder(q, this.schema) as any)
    : undefined
  return this.createChain(this.inner.withIndex(indexName, wrapped))
}
```

### Scope

**In scope:**
- `withIndex` — custom builder types + runtime encoding
- `withSearchIndex` — same approach for `SearchFilterFinalizer.eq()`
- Remove `warnCodecIndexFields()` warning from `model.ts`

**Out of scope (future work):**
- `filter()` — uses expression trees (`q.eq(q.field("x"), val)`), not field+value pairs. More complex wrapping needed. Note as known gap.

## Consumer Impact

**Scalar codecs (e.g., `zx.date()`):**
```ts
// Before: manual encoding, type expects number
.withIndex('byDate', q => q.eq('createdAt', myDate.getTime()))

// After: pass Date, type expects Date, zodvex encodes
.withIndex('byDate', q => q.eq('createdAt', myDate))
```

**Object codecs with dot-path indexes (e.g., hotpot `sensitive()`):**
```ts
// Before AND after: identical. Dot-path targets wire sub-field.
.withIndex('email', q => q.eq('email.value', emailStr))
// Type: string → string, no encoding needed
```

**Non-codec fields:**
```ts
// Before AND after: identical. No encoding needed.
.withIndex('byName', q => q.eq('name', nameStr))
```
