# Codec-First Simplification

## Summary

Simplify zodvex by embracing Zod's native codec handling. Remove custom `fromConvexJS`/`toConvexJS` functions and the codec registry. Let Zod handle all wire ↔ runtime transformations via `safeParse()` and `z.encode()`.

This is a **breaking change** that removes legacy code paths in favor of a cleaner, codec-first architecture.

## Context

zodvex currently has two mechanisms for wire ↔ runtime transforms:
1. **Zod codecs** (`zx.codec()`, `zx.date()`) - Zod's native bidirectional transforms
2. **Custom functions** (`fromConvexJS`, `toConvexJS`, `registerBaseCodec`) - zodvex's own transform layer

This creates:
- Double-parsing bugs (codec runs twice in custom builders)
- Complexity (two systems doing the same thing)
- Confusion (when to use which?)

## The Insight

Zod already handles codecs natively:
- `schema.parse(wire)` → runs `codec.decode` → returns runtime
- `z.encode(schema, runtime)` → runs `codec.encode` → returns wire

**zodvex doesn't need its own transform layer.** We just need to:
1. Ensure users use codecs (`zx.date()`, `zx.codec()`)
2. Let Zod do what Zod does

## Breaking Changes

This is a clean break. The following are **removed**, not deprecated:

| Removed | Replacement |
|---------|-------------|
| `fromConvexJS()` | `schema.parse()` or `schema.safeParse()` |
| `toConvexJS()` | `z.encode(schema, value)` |
| `registerBaseCodec()` | `zx.codec()` |
| Built-in Date registry codec | `zx.date()` |
| `z.date()` support | `zx.date()` |

## Changes

### 1. Update Custom Builders (`src/custom.ts`)

**Args handling - Before:**
```typescript
const decoded = fromConvexJS(rawArgs, argsSchema)
const parsed = argsSchema.safeParse(decoded)
```

**Args handling - After:**
```typescript
assertNoNativeZodDate(argsSchema, 'args')
const parsed = argsSchema.safeParse(rawArgs)
```

**Returns handling - Before:**
```typescript
const encoded = toConvexJS(returnsSchema, result)
// ... return encoded
```

**Returns handling - After:**
```typescript
assertNoNativeZodDate(returnsSchema, 'returns')
const encoded = z.encode(returnsSchema, result)
// ... return encoded
```

### 2. Add Schema Validation Helper (`src/utils.ts`)

```typescript
/**
 * Throws if schema contains native z.date() which isn't compatible with Convex.
 * Guides users to use zx.date() instead.
 */
export function assertNoNativeZodDate(
  schema: z.ZodTypeAny,
  context: 'args' | 'returns' | 'schema'
): void {
  if (containsNativeZodDate(schema)) {
    throw new Error(
      `[zodvex] Native z.date() found in ${context}. ` +
      `Convex stores dates as timestamps (numbers), which z.date() cannot parse.\n\n` +
      `Fix: Replace z.date() with zx.date()\n\n` +
      `Before: { createdAt: z.date() }\n` +
      `After:  { createdAt: zx.date() }\n\n` +
      `zx.date() is a codec that handles timestamp ↔ Date conversion automatically.`
    )
  }
}

/**
 * Recursively checks if a schema contains native z.date().
 */
function containsNativeZodDate(schema: z.ZodTypeAny): boolean {
  // Check if this is a native ZodDate (not our codec)
  if (schema instanceof z.ZodDate) {
    return true
  }

  // Codecs handle their own transforms - don't recurse into them
  if (schema instanceof z.ZodCodec) {
    return false
  }

  // Recurse into wrappers
  if (schema instanceof z.ZodOptional ||
      schema instanceof z.ZodNullable ||
      schema instanceof z.ZodDefault) {
    return containsNativeZodDate(schema.unwrap())
  }

  // Recurse into objects
  if (schema instanceof z.ZodObject) {
    return Object.values(schema.shape).some(
      field => containsNativeZodDate(field as z.ZodTypeAny)
    )
  }

  // Recurse into arrays
  if (schema instanceof z.ZodArray) {
    return containsNativeZodDate(schema.element)
  }

  // Recurse into unions
  if (schema instanceof z.ZodUnion) {
    return schema.options.some(opt => containsNativeZodDate(opt))
  }

  // Recurse into records
  if (schema instanceof z.ZodRecord) {
    return containsNativeZodDate(schema.valueSchema)
  }

  return false
}
```

### 3. Remove Legacy Functions (`src/codec.ts`)

**Remove from exports:**
- `fromConvexJS`
- `toConvexJS`
- `convexCodec` (the old non-zx version if it exists)

**Keep internally if needed** for any remaining internal use, but do not export.

### 4. Remove Registry (`src/registry.ts`)

**Remove entirely:**
- `registerBaseCodec()`
- `findBaseCodec()`
- The built-in Date codec registration
- All registry-related code

### 5. Update Mapping for Transforms (`src/mapping/core.ts`)

Remove `findBaseCodec()` calls. For transforms:

```typescript
case 'transform':
case 'pipe': {
  if (actualValidator instanceof z.ZodCodec) {
    // Codec - extract wire schema for Convex validator
    const inputSchema = (actualValidator as any).def?.in
    convexValidator = zodToConvexInternal(inputSchema, visited)
  } else {
    // Non-codec transform - extract input schema but warn
    const inputSchema = (actualValidator as any).def?.in
    if (inputSchema && inputSchema instanceof z.ZodType) {
      console.warn(
        '[zodvex] z.transform() detected. Using input schema for Convex validation.\n' +
        'Transforms are unidirectional - they work for parsing but not encoding.\n' +
        'For bidirectional transforms, use zx.codec() instead.'
      )
      convexValidator = zodToConvexInternal(inputSchema, visited)
    } else {
      throw new Error(
        '[zodvex] Cannot extract input schema from transform. Use zx.codec() for transforms.'
      )
    }
  }
  break
}
```

### 6. Update Exports (`src/index.ts`)

Remove from exports:
- `fromConvexJS`
- `toConvexJS`
- `registerBaseCodec`
- `findBaseCodec`
- Any registry-related types

### 7. Verify z.encode() Works Correctly

**Critical verification step:** Ensure `z.encode()` works correctly for:
- Nested codecs (codec inside object inside object)
- Optional codec fields (`.optional()` wrapper)
- Arrays of codecs
- Records with codec values

The test file `__tests__/codec-double-validation.test.ts` contains 11 tests that exercise these patterns. After the changes, **all 11 tests should pass** if the approach works correctly.

If `z.encode()` has issues with any of these patterns, we need to investigate whether:
- Zod has a bug we need to work around
- We need a thin wrapper around `z.encode()` for edge cases
- The test expectations need adjustment

### 8. Update/Remove Tests

**Remove tests for removed functionality:**
- Tests for `fromConvexJS` behavior
- Tests for `toConvexJS` behavior
- Tests for `registerBaseCodec`
- Tests for built-in Date codec

**Update tests to use new patterns:**
```typescript
// Old pattern (remove)
const decoded = fromConvexJS(wireData, schema)

// New pattern
const decoded = schema.parse(wireData)
```

**Ensure codec tests pass with native Zod:**
```typescript
it('should parse wire format directly with safeParse', () => {
  const wireArgs = {
    clinicId: 'clinic-1',
    email: { value: 'test@example.com', status: 'full' as const }
  }

  const result = sensitiveSchema.safeParse(wireArgs)

  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.email).toBeInstanceOf(SensitiveWrapper)
  }
})
```

## Migration Guide

Add to `MIGRATION.md`:

```markdown
## Codec-First Architecture (v0.4.0)

This release removes legacy transformation functions in favor of Zod's native codec handling.

### Breaking: z.date() No Longer Supported

Native `z.date()` no longer works with Convex. Use `zx.date()` instead.

**Before:**
```typescript
const schema = z.object({
  createdAt: z.date()
})
```

**After:**
```typescript
import { zx } from 'zodvex'

const schema = z.object({
  createdAt: zx.date()
})
```

### Breaking: fromConvexJS() Removed

Use Zod's native parsing instead.

**Before:**
```typescript
import { fromConvexJS } from 'zodvex'

const decoded = fromConvexJS(wireData, schema)
```

**After:**
```typescript
const decoded = schema.parse(wireData)
// or
const result = schema.safeParse(wireData)
```

### Breaking: toConvexJS() Removed

Use Zod's native encoding instead.

**Before:**
```typescript
import { toConvexJS } from 'zodvex'

const wire = toConvexJS(schema, runtimeData)
```

**After:**
```typescript
const wire = z.encode(schema, runtimeData)
```

### Breaking: registerBaseCodec() Removed

Define codecs inline with `zx.codec()` instead.

**Before:**
```typescript
import { registerBaseCodec } from 'zodvex'

registerBaseCodec({
  check: schema => isMyType(schema),
  toValidator: () => v.object({...}),
  fromConvex: (value) => decode(value),
  toConvex: (value) => encode(value)
})

// Used implicitly via schema
const schema = z.object({ field: myCustomType() })
```

**After:**
```typescript
import { zx } from 'zodvex'

const myCodec = zx.codec(
  z.object({...}),       // wire schema
  z.custom<MyType>(),    // runtime schema
  {
    decode: (wire) => new MyType(wire),
    encode: (runtime) => runtime.toWire()
  }
)

// Used explicitly in schema
const schema = z.object({ field: myCodec })
```
```

## Implementation Order

1. **Add `assertNoNativeZodDate` helper** - Foundation for other changes
2. **Update custom builders** - Replace `fromConvexJS`/`toConvexJS` with Zod native
3. **Verify z.encode() works** - Run `__tests__/codec-double-validation.test.ts`, all 11 tests must pass
4. **Remove registry** - Delete `src/registry.ts` and all references
5. **Remove legacy functions** - Remove exports from `src/codec.ts` and `src/index.ts`
6. **Update mapping** - Remove `findBaseCodec` calls from `src/mapping/core.ts`
7. **Clean up tests** - Remove/update tests for removed functionality
8. **Update documentation** - MIGRATION.md, README.md, CLAUDE.md

## Success Criteria

1. **All 11 tests in `__tests__/codec-double-validation.test.ts` pass** - Verifies z.encode()/parse() work for all codec patterns
2. All existing tests pass (after updating for removed functions)
3. No double-parsing of codecs in custom builders
4. Clear error message when `z.date()` is used
5. Codebase is simpler (less code, not more)
6. No `fromConvexJS`, `toConvexJS`, `registerBaseCodec` in exports

## Files to Modify

- `src/custom.ts` - Update args/returns handling
- `src/utils.ts` - Add `assertNoNativeZodDate`
- `src/codec.ts` - Remove `fromConvexJS`, `toConvexJS` exports
- `src/registry.ts` - Delete entirely
- `src/mapping/core.ts` - Remove `findBaseCodec` usage
- `src/index.ts` - Update exports
- `__tests__/codec-double-validation.test.ts` - Verify all 11 pass
- `__tests__/*.test.ts` - Update tests using removed functions
- `MIGRATION.md` - Add breaking changes guide
- `README.md` - Update examples
- `CLAUDE.md` - Update guidance
