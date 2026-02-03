# Codec-First Architecture

## Summary

zodvex should adopt an opinionated "codec-first" stance: if you need wire ↔ runtime transformation, use `zx.codec()`. This ensures type safety and consistency across all Convex data flow edges.

## The Problem

Zod's `z.transform()` and `z.pipe()` are **unidirectional** - they only work for parsing (wire → runtime), not encoding (runtime → wire).

In Convex, data flows through four edges:

| Edge | Direction | Transform Works? |
|------|-----------|------------------|
| Function args | wire → runtime | ✅ Yes |
| Function returns | runtime → wire | ❌ No |
| Database writes | runtime → wire | ❌ No |
| Database reads | wire → runtime | ✅ Yes |

This creates **silent inconsistency** - transforms appear to work for args and reads, but silently fail (or produce wrong data) for returns and writes.

## The Solution: Codecs

`zx.codec()` is **bidirectional**:

```typescript
const myCodec = zx.codec(
  wireSchema,    // What's stored/transmitted
  runtimeSchema, // What the app works with
  {
    decode: (wire) => runtime,  // wire → runtime
    encode: (runtime) => wire   // runtime → wire ✓
  }
)
```

All four edges work correctly and consistently.

## Architectural Changes

### 1. Deprecate `registerBaseCodec`

**Current:** Global registry for custom type handlers
**New:** Deprecated, recommend `zx.codec()` instead

```typescript
// Before (deprecated)
registerBaseCodec({
  check: schema => isMyType(schema),
  toValidator: () => v.object({...}),
  fromConvex: (value) => decode(value),
  toConvex: (value) => encode(value)
})

// After
const myCodec = zx.codec(wireSchema, runtimeSchema, { decode, encode })
```

**Migration path:**
- Emit deprecation warning when `registerBaseCodec` is called
- Document migration to `zx.codec()`
- Remove in next major version

### 2. Transform/Pipe Validator Mapping

**Current:** Falls back to `v.any()` silently
**New:** Extract input schema (correct for validation) but warn

```typescript
case 'transform':
case 'pipe': {
  if (actualValidator instanceof z.ZodCodec) {
    // Codec - fully supported, use wire schema
    convexValidator = zodToConvexInternal(inputSchema, visited)
  } else {
    // Non-codec transform - extract input schema
    const inputSchema = (actualValidator as any).def?.in
    if (inputSchema && inputSchema instanceof z.ZodType) {
      // Warn about limitations
      console.warn(
        '[zodvex] z.transform() detected. Using input schema for Convex validation. ' +
        'Note: Transforms are unidirectional and will not work for returns or db writes. ' +
        'Use zx.codec() for bidirectional wire ↔ runtime transforms.'
      )
      convexValidator = zodToConvexInternal(inputSchema, visited)
    } else {
      throw new Error(
        '[zodvex] Cannot extract input schema from transform. Use zx.codec() instead.'
      )
    }
  }
  break
}
```

### 3. Runtime Transform Errors

**Current:** `toConvexJS()` silently passes through or produces wrong data
**New:** Throw actionable error for non-codec transforms

```typescript
// In schemaToConvex (toConvexJS helper)
if (isTransformOrPipe(schema) && !(schema instanceof z.ZodCodec)) {
  throw new Error(
    '[zodvex] Cannot encode value through z.transform() - transforms are unidirectional. ' +
    'Use zx.codec() for bidirectional wire ↔ runtime conversion.'
  )
}
```

### 4. Keep `z.date()` Support (Pragmatic Exception)

`z.date()` is extremely common. We'll keep special-case handling:
- Validator mapping: `z.date()` → `v.float64()`
- Runtime transforms: Date ↔ timestamp automatically

But **recommend** `zx.date()` for explicitness:
```typescript
// Works (implicit)
const schema = z.object({ createdAt: z.date() })

// Recommended (explicit)
const schema = z.object({ createdAt: zx.date() })
```

### 5. Refinements Are Fine

Refinements don't change types, so they work everywhere:

```typescript
// These are all fine - no type transformation
z.string().email()
z.string().min(1).max(100)
z.number().positive()
z.string().refine(isValidFormat)
```

## Documentation Updates

### CLAUDE.md / README Updates

Add section on codec philosophy:

```markdown
## Wire ↔ Runtime Transforms

If your data needs transformation between wire format (what's stored/transmitted)
and runtime format (what your app works with), use `zx.codec()`:

- ✅ `zx.codec()` - Bidirectional, works everywhere
- ✅ `zx.date()` - Built-in Date ↔ timestamp codec
- ⚠️ `z.transform()` - Parse-only, won't work for returns/writes
- ⚠️ `z.pipe()` - Parse-only, won't work for returns/writes

### Why Codecs?

Convex has four data flow edges. Transforms only work for two:

| Edge | Direction | Codec | Transform |
|------|-----------|-------|-----------|
| Args | wire → runtime | ✅ | ✅ |
| Returns | runtime → wire | ✅ | ❌ |
| DB Write | runtime → wire | ✅ | ❌ |
| DB Read | wire → runtime | ✅ | ✅ |

Using transforms creates silent inconsistencies. Codecs ensure all edges
are handled correctly.
```

### Migration Guide Addition

Add to MIGRATION.md:

```markdown
## Transforms → Codecs

If you're using `z.transform()` for wire ↔ runtime conversion, migrate to `zx.codec()`:

**Before (transform - only works for parsing):**
```typescript
const dateField = z.number().transform(n => new Date(n))
```

**After (codec - works everywhere):**
```typescript
const dateField = zx.date()

// Or for custom transforms:
const myField = zx.codec(
  z.number(),           // wire format
  z.custom<Date>(),     // runtime format
  {
    decode: (n) => new Date(n),
    encode: (d) => d.getTime()
  }
)
```
```

## Implementation Checklist

- [ ] Add deprecation warning to `registerBaseCodec()`
- [ ] Update `mapping/core.ts` transform/pipe case to extract input schema + warn
- [ ] Update `codec.ts` `schemaToConvex()` to throw on non-codec transforms
- [ ] Keep `z.date()` special handling in both validator mapping and runtime transforms
- [ ] Add tests for transform warning behavior
- [ ] Add tests for transform encode error
- [ ] Update CLAUDE.md with codec philosophy
- [ ] Update MIGRATION.md with transform → codec migration
- [ ] Update README.md with codec-first guidance

## Breaking Changes

- `registerBaseCodec()` deprecated (removed in next major)
- Non-codec transforms now warn during validator mapping
- Non-codec transforms now throw during `toConvexJS()` encoding

## Non-Breaking

- `z.date()` continues to work (pragmatic exception)
- Refinements (`.refine()`, `.email()`, etc.) work everywhere
- Existing `zx.codec()` usage unchanged
