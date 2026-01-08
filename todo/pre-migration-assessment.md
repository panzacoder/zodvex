# Pre-Migration Assessment: Security Module to Hotpot

**Date:** 2026-01-08
**Branch:** `plan/rls`
**Status:** Phases 1-3 Complete, Ready for Phase 4 Review

---

## Executive Summary

The security module is architecturally ready for migration to hotpot. The transform/security boundary is clean, imports flow in the correct direction, and test coverage is comprehensive. However, several issues were identified that should be addressed before or during migration.

---

## 1. Boundary Assessment ✅ READY

### Transform Layer (stays in zodvex)
- `src/transform/types.ts` - FieldInfo, TransformContext, TransformOptions
- `src/transform/traverse.ts` - walkSchema, findFieldsWithMeta, getMetadata, hasMetadata
- `src/transform/transform.ts` - transformBySchema, transformBySchemaAsync
- `src/transform/index.ts` - Barrel exports

### Security Layer (migrates to hotpot)
- `src/security/types.ts` - SensitiveDb, SensitiveWire, policies, RLS types
- `src/security/sensitive.ts` - sensitive() marker, field discovery
- `src/security/policy.ts` - Policy resolution
- `src/security/apply-policy.ts` - Read/write policy application
- `src/security/sensitive-field.ts` - SensitiveField runtime class
- `src/security/wire.ts` - Wire serialization
- `src/security/fail-secure.ts` - autoLimit, assertNoSensitive
- `src/security/rls.ts` - RLS primitives
- `src/security/db.ts` - Secure DB wrappers
- `src/security/secure-wrappers.ts` - zSecureQuery/Mutation/Action
- `src/security/client.ts` - Client utilities
- `src/security/index.ts` - Barrel exports

### Import Direction ✅
- Security imports from transform: `sensitive.ts`, `apply-policy.ts`
- Transform imports from security: **NONE** (correct)

### Post-Migration Imports
```typescript
// In hotpot, will change from:
import { transformBySchemaAsync } from '../transform'

// To:
import { transformBySchemaAsync } from 'zodvex/transform'
```

---

## 2. Issues to Address

### HIGH Priority (Security-Critical)

#### H1: Resolver Exceptions Not Caught (Fail-Open Risk)
**Location:** `src/security/policy.ts:58`
**Problem:** If the EntitlementResolver throws an exception, it propagates up unhandled. For security code, this should fail-closed.
**Current:**
```typescript
const result = normalizeResult(await resolver(context, tier.requirements))
```
**Recommended:**
```typescript
try {
  const result = normalizeResult(await resolver(context, tier.requirements))
  // ... continue
} catch (e) {
  console.error('Entitlement resolver failed, failing closed:', e)
  return { status: 'hidden', reason: 'resolver_error' }
}
```
**Risk:** A misconfigured or failing resolver could expose sensitive data.

#### H2: z.lazy() Schemas Not Handled (Infinite Recursion)
**Location:** `src/transform/traverse.ts`, `src/transform/transform.ts`
**Problem:** Recursive schemas using `z.lazy()` will cause infinite recursion since the traversal doesn't detect them.
**Example:**
```typescript
const personSchema: z.ZodType<Person> = z.lazy(() => z.object({
  name: z.string(),
  friends: z.array(personSchema)  // Recursive!
}))
```
**Recommended:** Add `z.lazy()` detection in traversal, either:
- Detect and skip (with warning)
- Detect and unwrap with visited tracking
**Risk:** Runtime crash on valid Zod schemas.

---

### MEDIUM Priority (Usability/Observability)

#### M1: Query API Too Restrictive
**Location:** `src/security/db.ts:134-161`
**Problem:** `createSecureReader.query()` only supports filter function, missing:
- `.withIndex()` for indexed queries
- `.paginate()` for cursor-based pagination
- `.order()` for sorting
**Current:**
```typescript
async query<TTable>(table: TTable, queryFn: (q: any) => any): Promise<TTables[TTable][]>
```
**Recommended:** Either expose the full Convex query builder, or add method chaining.
**Impact:** Users can't efficiently query large tables.

#### M2: Silent Null on RLS Denial
**Location:** `src/security/db.ts:110-113`
**Problem:** When RLS denies access, `get()` returns `null` - indistinguishable from "not found".
**Current:**
```typescript
if (!rlsResult.allowed) return null  // Silent
```
**Recommended:** Add optional `onDenied` callback to config:
```typescript
config.onDenied?.({ table, id, reason: rlsResult.reason })
return null
```
**Impact:** Debugging access issues is difficult in production.

#### M3: Sequential Array Processing
**Location:** `src/transform/transform.ts:165-173`
**Problem:** Arrays with async transforms are processed sequentially, not in parallel.
**Current:**
```typescript
for (let i = 0; i < val.length; i++) {
  results.push(await recurse(val[i], element, itemPath))  // Sequential
}
```
**Recommended:** Add `parallel: boolean` option (default false for backwards compat):
```typescript
if (options?.parallel) {
  return Promise.all(val.map((item, i) => recurse(item, element, `${currentPath}[${i}]`)))
}
```
**Impact:** Large arrays with entitlement checks are slow.

---

### LOW Priority (Code Quality)

#### L1: `any` Casts Reduce Type Safety
**Locations:**
- `db.ts:112, 145, 222, 249, 273` - `rule as any`
- `db.ts:48-55` - DatabaseLike uses `any`
- `apply-policy.ts:120, 142, 154` - `defaultDenyReason as any`

**Recommended:** Investigate mapped types to preserve generic relationships.

#### L2: Unused `resolver` in zSecureAction Config
**Location:** `src/security/secure-wrappers.ts:251-290`
**Problem:** `zSecureAction` accepts `resolver` in config but never uses it (actions don't have direct DB access).
**Recommended:** Create `SecureActionConfig` that omits unused fields.

---

## 3. Edge Cases Not Handled

| Edge Case | Current Behavior | Risk | Recommendation |
|-----------|------------------|------|----------------|
| Nested sensitive in sensitive | Outer hides all | Low (fail-closed) | Document behavior |
| Sensitive discriminator | Union matching fails | Medium | Document as unsupported |
| `z.lazy()` recursive | Infinite recursion | High | Detect and handle |
| `z.transform()` / `z.refine()` | May miss fields | Medium | Test and document |
| TOCTOU in update | Stale data check | Low (Convex OCC) | Document reliance on Convex |

---

## 4. Documentation Gaps

### README.md ❌ Not Updated
The main README does not document:
- Transform layer utilities
- Security module features (FLS, RLS)
- Subpath imports (`zodvex/transform`, `zodvex/security`)

**Recommendation:** Add sections before merge to main, or defer to hotpot docs.

### JSDoc ✅ Comprehensive
All public APIs have JSDoc with examples.

### Migration Guide ❌ Not Created
No documentation for Phase 4 (copying to hotpot).

**Recommendation:** Create `todo/hotpot-migration-guide.md` with step-by-step instructions.

---

## 5. Test Coverage ✅ Excellent

| Module | Test Files | Lines | Status |
|--------|------------|-------|--------|
| Transform | 3 | ~932 | ✅ Complete |
| Security | 18+ | ~7194 | ✅ Complete |

**Total:** 549 tests passing, 1119 assertions

---

## 6. Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Transform export path? | Subpath: `zodvex/transform` |
| Terminology (full/masked/hidden)? | Kept as-is |
| React hooks? | Deferred to hotpot |

---

## 7. Recommendations

### Before Phase 4 Migration
1. **[REQUIRED]** Fix H1: Wrap resolver in try-catch (fail-closed)
2. **[REQUIRED]** Fix H2: Handle z.lazy() schemas
3. **[OPTIONAL]** Add M2: `onDenied` callback for observability

### During/After Migration
4. Address M1: Query API flexibility (in hotpot)
5. Address M3: Parallel array option (in zodvex transform)
6. Update README or create hotpot-specific docs
7. Create migration guide

### Defer
- L1/L2: Type improvements (non-blocking)
- Edge case tests (add over time)

---

## 8. Migration Checklist (Phase 4)

- [ ] Copy `src/security/*` to `packages/hotpot/src/security/`
- [ ] Update imports: `'../transform'` → `'zodvex/transform'`
- [ ] Add `zodvex` as dependency in hotpot's package.json
- [ ] Update hotpot's package.json exports for security subpath
- [ ] Copy/adapt security tests
- [ ] Verify tree-shaking works (security doesn't pull all zodvex)
- [ ] Update hotpot documentation

---

## Appendix: Code Patterns

### Pattern: Security Uses Transform
```typescript
// src/security/apply-policy.ts
import { transformBySchemaAsync } from '../transform'

export async function applyReadPolicy(...) {
  return transformBySchemaAsync(value, schema, ctx, async (val, info) => {
    // Security-specific logic here
    const meta = getSensitiveMetadata(info.schema)
    if (!meta) return val
    // ... resolve policies, return wire format
  }, { unmatchedUnion: 'null' })  // Fail-closed
}
```

### Pattern: Fail-Closed Union Handling
```typescript
// Transform layer provides the primitive
transformBySchemaAsync(value, schema, ctx, transform, {
  unmatchedUnion: 'null',  // Security chooses fail-closed
  onUnmatchedUnion: (path) => log('union_mismatch', path)
})
```
