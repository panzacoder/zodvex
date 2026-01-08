# Option 1: Traversal Unwrap - Fix Schema Traversal to Handle Effect Types

## Executive Summary

The current vulnerability exists because `sensitive()` marks fields using Zod's `.meta()` API, but schema traversal in `src/transform/traverse.ts` only handles a subset of Zod types (optional, nullable, lazy, object, array, union). When a schema is wrapped in effect types like `transform`, `refine`, `catch`, `default`, `brand`, or `pipe`, the metadata becomes inaccessible.

**Option 1** expands the traversal to unwrap these effect types and find the inner schema's metadata.

---

## 1. Technical Approach

### 1.1 Zod Effect Types Requiring Handling

| Type | Purpose | How to Unwrap |
|------|---------|---------------|
| `transform` | Maps input → output via function | `_def.schema` |
| `pipe` | Chains schemas (v4) | `_def.in` or `_def.out` |
| `catch` | Fallback on validation error | `_def.innerType` |
| `default` | Provides default value | `_def.innerType` |
| `nonoptional` | Removes optional wrapping | `_def.schema` |
| `readonly` | Marks as readonly | `_def.innerType` |
| `prefault` | Pre-failure handling | `_def.innerType` |

### 1.2 Why These Types Hide Metadata

When you write:
```typescript
sensitive(z.string()).transform(s => s.toLowerCase())
```

The AST becomes:
```
ZodTransform
  └─ _def.schema: ZodTypeMeta (with SENSITIVE_META_KEY)
```

The metadata lives on the inner schema, but the outer `ZodTransform` has no metadata.

### 1.3 Implementation Strategy

```typescript
function getInnerSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const defType = (schema as any)._def?.type as string | undefined

  switch (defType) {
    case 'transform':
    case 'nonoptional':
    case 'readonly':
      return (schema as any)._def.schema

    case 'pipe':
      return (schema as any)._def.in

    case 'catch':
    case 'default':
    case 'prefault':
      return (schema as any)._def.innerType

    default:
      return schema
  }
}

// Modified getMetadata with recursive unwrapping
export function getMetadata(schema: z.ZodTypeAny): Record<string, unknown> | undefined {
  let current = schema

  while (true) {
    const meta = current.meta?.() as Record<string, unknown> | undefined
    if (meta !== undefined) return meta

    const inner = getInnerSchema(current)
    if (inner === current) break
    current = inner
  }

  return undefined
}
```

### 1.4 Changes to traverse.ts

Add handling for effect types in the switch statement:

```typescript
case 'transform':
case 'pipe':
case 'catch':
case 'default':
case 'nonoptional':
case 'readonly':
case 'prefault': {
  const inner = getInnerSchema(sch)
  traverse(inner, currentPath, isOptional)
  return
}
```

---

## 2. Analysis

### 2.1 DX (Developer Experience)

| Aspect | Assessment |
|--------|------------|
| **Transparency** | ✅ Works as users expect - `sensitive().transform()` just works |
| **No API changes** | ✅ Existing code continues to work |
| **Error messages** | ⚠️ Debugging may be harder if traversal doesn't find expected fields |
| **Learning curve** | ✅ None - behavior matches mental model |

**Gotchas:**
- Multiple nested transforms require recursive unwrapping
- Edge case: transform that returns a completely different type

### 2.2 Scalability

| Aspect | Assessment |
|--------|------------|
| **Performance** | ⚠️ Deeper traversal = more iterations. ~O(depth) additional work per field |
| **Memory** | ✅ Minimal - no additional data structures |
| **Schema complexity** | ⚠️ Deeply nested transforms could slow traversal |

**Mitigation:** Early termination when metadata found.

### 2.3 Maintainability

| Aspect | Assessment |
|--------|------------|
| **Zod version coupling** | ⚠️ HIGH - depends on internal `_def` structure |
| **New Zod types** | ⚠️ Must update when Zod adds wrapper types |
| **Testing** | ⚠️ Need tests for each effect type combination |
| **Code complexity** | ✅ Straightforward switch cases |

**Risk:** Zod v5 could change `_def` internals, breaking this approach.

### 2.4 Security

| Aspect | Assessment |
|--------|------------|
| **Solves vulnerability** | ✅ YES - finds metadata through effect wrappers |
| **Edge cases** | ⚠️ Custom ZodTypes or plugins might not be handled |
| **Fail-secure** | ⚠️ If unwrapping fails, field might be exposed |
| **Coverage** | ✅ Handles all standard Zod effect types |

**Remaining risks:**
- Custom/third-party Zod types
- Future Zod types we don't know about

---

## 3. Pros/Cons Summary

### Pros
1. **Transparent to users** - No API changes, existing code works
2. **Preserves schema expressiveness** - Use any Zod method after `sensitive()`
3. **Low migration cost** - Just update the library, no user code changes
4. **Centralized fix** - One place to maintain (traverse.ts)

### Cons
1. **Zod version coupling** - Depends on `_def` internals that could change
2. **Maintenance burden** - Must track new Zod wrapper types
3. **Performance overhead** - Additional traversal depth
4. **Not truly fail-secure** - Unknown types might be missed

---

## 4. Recommendation

**Best for:** Teams that want minimal disruption and are willing to maintain version-specific code.

**Implementation effort:** Medium (2-3 days)

**Risk level:** Medium - depends on Zod's internal stability
