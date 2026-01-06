# Issue #22: `zid` incompatible with AI SDK

**Reporter:** @tyb51
**Created:** 2025-11-08
**Status:** Valid bug - needs fix
**Priority:** High
**Labels:** bug, ai-sdk, breaking-change

## Problem Statement

The Vercel AI SDK doesn't allow schemas with `.transform()` in output schemas. Since `zid` uses `.transform()` to convert strings to branded `GenericId<TableName>`, it's incompatible with AI SDK's `generateObject()` and similar functions.

### User's Experience

```typescript
import { generateObject } from 'ai'
import { zid } from 'zodvex'

const schema = z.object({
  userId: zid('users'), // ❌ Error: Transforms not allowed
  email: z.string()
})

await generateObject({
  model: openai('gpt-4'),
  schema, // Throws error about transforms
  prompt: 'Generate a user'
})
```

**Workaround (current):**
```typescript
const schema = z.object({
  userId: z.string(), // ✅ Works but loses type safety
  email: z.string()
})
```

## Root Cause Analysis

### Current `zid` Implementation

From `src/ids.ts:26-35`:
```typescript
export function zid<TableName extends string>(tableName: TableName) {
  const baseSchema = z
    .string()
    .refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })
    .transform(val => {
      // Cast to GenericId while keeping the string value
      return val as string & GenericId<TableName>
    })
    .brand(`ConvexId_${tableName}`) // Double branding!
    .describe(`convexId:${tableName}`)

  // Store metadata for registry lookup
  registryHelpers.setMetadata(baseSchema, {
    isConvexId: true,
    tableName
  })

  return baseSchema as z.ZodType<GenericId<TableName>> & { _tableName: TableName }
}
```

**Issues:**
1. `.transform()` makes it incompatible with AI SDK
2. Double-branding (Convex's `GenericId<T>` + Zod's `.brand()`)
3. WeakMap registry depends on schema instance

### Why AI SDK Restricts Transforms

From AI SDK documentation:
- Output schemas must be serializable for LLM JSON generation
- Transforms can produce non-serializable objects
- Only refinements and descriptions are allowed

## Proposed Solution

### Remove `.transform()` and `.brand()` from `zid`

This also addresses **TODO #1** (remove double-branding):

```typescript
export function zid<TableName extends string>(
  tableName: TableName
): z.ZodType<GenericId<TableName>> & { _tableName: TableName } {
  const baseSchema = z
    .string()
    .refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })
    .describe(`convexId:${tableName}`)

  // Store metadata for registry lookup (mapping.ts needs this)
  registryHelpers.setMetadata(baseSchema, {
    isConvexId: true,
    tableName
  })

  // Type assertion provides branded type without runtime transform
  const branded = baseSchema as z.ZodType<GenericId<TableName>>

  // Add tableName property for type-level detection
  ;(branded as any)._tableName = tableName

  return branded as z.ZodType<GenericId<TableName>> & { _tableName: TableName }
}
```

**Benefits:**
1. ✅ Compatible with AI SDK (no transforms)
2. ✅ Removes double-branding issue
3. ✅ Maintains type safety via type assertion
4. ✅ WeakMap registry still works (uses schema instance)
5. ✅ `zodToConvex()` still knows to return `v.id(tableName)`

**Breaking change?**
- Technically yes (different schema structure)
- Functionally equivalent for 99.9% of users
- Runtime behavior identical

## Additional Consideration: JSON Schema Support

For schemas that DO have transforms (not just `zid`), we need to support AI SDK's JSON schema generation with fallbacks.

### Zod 4 JSON Schema Fallbacks

Zod 4 provides a way to handle transforms in JSON schema generation via the `.annotations()` method:

```typescript
// Research needed: Zod 4 annotation API for JSON Schema
const schemaWithTransform = z.string()
  .transform(val => new Date(val))
  .annotations({
    // Provide JSON Schema fallback when transform can't be represented
    jsonSchema: { type: 'string', format: 'date-time' }
  })
```

**Action Items:**
- [ ] Research Zod 4's `.annotations()` API
- [ ] Research `zod-to-json-schema` library's transform handling
- [ ] Determine if we need a helper for "AI-SDK-safe" schemas
- [ ] Document how to use schemas with AI SDK when transforms are present
- [ ] Consider adding `toAISchema()` utility that strips/replaces transforms

### Potential Helper Utility

```typescript
// Future enhancement
import { toAISchema } from 'zodvex/ai'

// Automatically handles transforms for AI SDK compatibility
const aiSafeSchema = toAISchema(mySchemaWithTransforms, {
  // Provide fallback behaviors
  dateTransform: 'iso-string',
  customTransforms: {
    // Map custom transforms to JSON-safe equivalents
  }
})
```

## Testing Requirements

### Unit Tests
- [ ] Test `zid` without `.transform()` maintains type safety
- [ ] Test WeakMap registry still works
- [ ] Test `zodToConvex(zid('users'))` returns `v.id('users')`
- [ ] Test type inference: `z.infer<typeof zid('users')>` is `GenericId<'users'>`

### Integration Tests
- [ ] Test with AI SDK `generateObject()`
- [ ] Test with AI SDK `generateText()` + schema
- [ ] Test `zid` in nested objects/arrays for AI SDK
- [ ] Test round-trip: AI generates ID → validate with `zid`

### Regression Tests
- [ ] Existing zodvex tests still pass
- [ ] No type errors in example projects
- [ ] `zodTable` still works with `zid` fields

## Migration Guide

### For Users Affected by AI SDK Issue

**Before:**
```typescript
// Doesn't work with AI SDK
const schema = z.object({
  userId: zid('users')
})
```

**After (with fix):**
```typescript
// Works with AI SDK - no changes needed!
const schema = z.object({
  userId: zid('users') // Now compatible
})

await generateObject({
  model: openai('gpt-4'),
  schema,
  prompt: 'Generate a user'
})
```

### For Users Relying on Transform Behavior (unlikely)

If anyone was relying on the transform (very unlikely):
```typescript
// Old behavior (transform at parse time)
const parsed = zid('users').parse('abc123')
// parsed was transformed, but identical to input

// New behavior (type assertion only)
const parsed = zid('users').parse('abc123')
// Still works identically - assertion doesn't change runtime
```

## Documentation Updates

### README.md

Add to API Reference section:

```md
### AI SDK Compatibility

zodvex schemas, including `zid`, are fully compatible with Vercel's AI SDK:

\`\`\`typescript
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { zid } from 'zodvex'

const userSchema = z.object({
  id: zid('users'),
  name: z.string(),
  email: z.string().email()
})

const result = await generateObject({
  model: openai('gpt-4'),
  schema: userSchema,
  prompt: 'Generate a sample user'
})
// ✅ Works seamlessly
\`\`\`

**Note on schemas with transforms:**
If your schema uses `.transform()` for custom types (not `zid`), you may need to provide JSON Schema fallbacks for AI SDK compatibility. See [Advanced: AI SDK with Transforms](#advanced-ai-sdk-with-transforms).
```

### New FAQ Entry

**Q: Can I use zodvex schemas with AI SDK?**

A: Yes! zodvex schemas are fully compatible with Vercel's AI SDK. The `zid` helper was specifically designed to work without transforms.

**Q: What about schemas with custom transforms?**

A: Zod 4 supports JSON Schema annotations for transforms. We're researching the best approach and will provide utilities/documentation soon.

## Implementation Checklist

- [ ] Update `src/ids.ts` - remove `.transform()` and `.brand()`
- [ ] Update type assertions to maintain `GenericId<T>` type
- [ ] Add unit tests for new implementation
- [ ] Add integration tests with AI SDK
- [ ] Run full test suite - ensure no regressions
- [ ] Update README.md with AI SDK compatibility section
- [ ] Add migration notes to CHANGELOG.md
- [ ] Research Zod 4 annotations API for transform fallbacks
- [ ] Consider adding `toAISchema()` utility (future enhancement)

## Timeline

**Phase 1: Fix `zid` (Immediate - Next PR)**
- Remove transform/brand from `zid`
- Add basic tests
- Update docs
- Estimated: 2-3 hours

**Phase 2: Research JSON Schema Fallbacks (Short term)**
- Research Zod 4 `.annotations()`
- Research `zod-to-json-schema`
- Document findings
- Estimated: 3-4 hours

**Phase 3: AI SDK Utilities (Medium term)**
- Implement `toAISchema()` helper if needed
- Add comprehensive AI SDK examples
- Write blog post on AI SDK + zodvex
- Estimated: 1-2 days

## References

- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [AI SDK Schema Restrictions](https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data#schema-restrictions)
- [Zod 4 Annotations](https://zod.dev/annotations) - TODO: verify this exists
- [zod-to-json-schema](https://github.com/StefanTerdell/zod-to-json-schema)
- Original Issue: https://github.com/panzacoder/zodvex/issues/22
