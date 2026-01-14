# Pre-Migration Assessment: Security Module to Hotpot

**Date:** 2026-01-08
**Branch:** `plan/rls`
**Status:** MIGRATION COMPLETE

> **Note:** The security module has been migrated to hotpot. This document is kept for historical reference.
> See `packages/hotpot/src/security/` in the hotpot repo and the `SECURITY_MIGRATION.md` guide there.

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

#### H1: Resolver Exceptions Not Caught (Fail-Open Risk) ✅ FIXED
**Location:** `src/security/policy.ts`
**Problem:** If the EntitlementResolver throws an exception, it propagates up unhandled. For security code, this should fail-closed.
**Resolution:** Both `resolveReadPolicy` and `resolveWritePolicy` now wrap resolver calls in try-catch:
- Read policy: Returns `{ status: 'hidden', reason: 'resolver_error' }`
- Write policy: Returns `{ allowed: false, reason: 'resolver_error' }`
**Tests:** 6 new tests added in `__tests__/security/policy.test.ts` under "fail-closed on resolver error (SECURITY)"

#### H2: z.lazy() Schemas Not Handled (Infinite Recursion) ✅ FIXED
**Location:** `src/transform/traverse.ts`, `src/transform/transform.ts`
**Problem:** Recursive schemas using `z.lazy()` will cause infinite recursion since the traversal doesn't detect them.
**Resolution:** Added `z.lazy()` handling to all traversal functions:
- `walkSchema`: Unwraps lazy schemas via `_def.getter()`, visited Set prevents infinite recursion
- `transformBySchema`: Unwraps lazy schemas, recursion bounded by actual data structure
- `transformBySchemaAsync`: Same as sync version
**Tests:** 9 new tests added covering simple lazy, recursive schemas, deeply nested trees

---

### MEDIUM Priority (Usability/Observability)

#### M1: Query API Too Restrictive ✅ FIXED
**Location:** `src/security/db.ts`
**Problem:** `createSecureReader.query()` only supports filter function.
**Resolution:** Query now accepts optional query builder callback that supports full Convex API:
```typescript
async query<TTable>(table: TTable, buildQuery?: (q: QueryBuilder) => CollectibleQuery)
```
Supports `.withIndex()`, `.filter()`, `.order()`, and chaining. If no builder provided, collects all.
**Tests:** 4 new tests for query builder API.

#### M2: Silent Null on RLS Denial ✅ FIXED
**Location:** `src/security/db.ts`
**Problem:** When RLS denies access, `get()` returns `null` - indistinguishable from "not found".
**Resolution:** Added `onDenied` callback to `SecureDbConfig`:
```typescript
onDenied?: (info: DeniedInfo<TTables>) => void
```
Called for all RLS denials (get, insert, patch, delete) with table, id, reason, and operation.
**Tests:** 6 new tests in `__tests__/security/db.test.ts` under "onDenied callback (M2)".

#### M3: Sequential Array Processing ✅ FIXED
**Location:** `src/transform/transform.ts`
**Problem:** Arrays with async transforms are processed sequentially, not in parallel.
**Resolution:** Added `parallel: boolean` option to `TransformOptions`:
```typescript
if (options?.parallel) {
  return Promise.all(val.map((item, i) => recurse(item, element, itemPath)))
}
```
**Tests:** 5 new tests in `__tests__/transform/transform.test.ts` under "parallel option (M3)".

---

### LOW Priority (Code Quality)

#### L1: `any` Casts Reduce Type Safety ✅ PARTIALLY FIXED
**Resolution:** Removed unnecessary `as any` casts for `defaultDenyReason` in:
- `db.ts` - 2 casts removed
- `secure-wrappers.ts` - 1 cast removed

**Remaining:** Some `rule as any` casts are necessary due to TypeScript's limitation with mapped types and index access. These are safe at runtime but can't be statically typed.

#### L2: Unused `resolver` in zSecureAction Config ✅ FIXED
**Location:** `src/security/secure-wrappers.ts`
**Resolution:** Created `SecureActionConfig<TCtx>` type that only includes:
- `resolveContext` - needed
- `authorize` - needed

`zSecureAction` now uses `SecureActionConfig` instead of `SecureConfig`, making it clear that resolver/rules/schemas don't apply to actions.

---

## 3. Edge Cases Not Handled

| Edge Case | Current Behavior | Risk | Recommendation |
|-----------|------------------|------|----------------|
| Nested sensitive in sensitive | Outer hides all | Low (fail-closed) | Document behavior |
| Sensitive discriminator | Union matching fails | Medium | Document as unsupported |
| `z.lazy()` recursive | ✅ FIXED | Low | Handled with visited Set |
| `z.transform()` / `z.refine()` | ✅ FIXED (Option 2) | Low | `ZodSensitive` wrapper survives all compositions; see `todo/meta/README.md` |
| TOCTOU in update | Stale data check | Low (Convex OCC) | Document reliance on Convex |

### z.transform() / z.refine() Behavior
**Tests:** 19 new tests in `__tests__/security/sensitive.test.ts` under "ZodSensitive wrapper survival (Option 2)"

**Key Finding (updated):** With Option 2 (`ZodSensitive` wrapper class), sensitive marking survives ALL Zod compositions including `.refine()`, `.superRefine()`, and `.check()`. The wrapper stays in the schema tree and is detectable via `instanceof`.

```typescript
// ✅ All patterns now work with ZodSensitive wrapper:
sensitive(z.string()).transform(s => s.toLowerCase())
sensitive(z.string()).refine(s => s.length >= 8)
sensitive(z.string()).superRefine((val, ctx) => { ... })
sensitive(z.string()).optional().nullable()
```

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

**Recommendation:** Create `todo/hotpot-migration-guide.md` with step-by-step instructions. ✅ Added.

---

## 5. Test Coverage ✅ Excellent

| Module | Test Files | Lines | Status |
|--------|------------|-------|--------|
| Transform | 3 | ~1050 | ✅ Complete |
| Security | 18+ | ~7400 | ✅ Complete |

**Total:** 596 tests passing, 1274 assertions

### New Tests Added
- `shouldTransform` predicate tests (6)
- `z.lazy()` handling tests (9)
- Fail-closed resolver tests (6)
- `onDenied` callback tests (6)
- Parallel array processing tests (5)
- Query builder API tests (4)
- `z.transform()`/`z.refine()` edge case tests (6)

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
1. ~~**[REQUIRED]** Fix H1: Wrap resolver in try-catch (fail-closed)~~ ✅ DONE
2. ~~**[REQUIRED]** Fix H2: Handle z.lazy() schemas~~ ✅ DONE
3. ~~**[OPTIONAL]** Add M2: `onDenied` callback for observability~~ ✅ DONE
4. ~~**[OPTIONAL]** Address M1: Query API flexibility~~ ✅ DONE
5. ~~**[OPTIONAL]** Address M3: Parallel array option~~ ✅ DONE
6. ~~**[OPTIONAL]** L1: Reduce unnecessary `any` casts~~ ✅ DONE
7. ~~**[OPTIONAL]** L2: Create SecureActionConfig~~ ✅ DONE
8. ~~**[OPTIONAL]** Test z.transform/z.refine edge cases~~ ✅ DONE

### During/After Migration
- Refactor if-chains to switch statements ✅ DONE
- Update README or create hotpot-specific docs
- Create migration guide

### Code Quality Improvements Made
- Switch statements replace if-chains in transform layer for better readability
- All transform/traverse functions now use consistent `switch (defType)` pattern

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
