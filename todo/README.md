# zodvex Issue Tracking

This directory contains detailed analysis and action plans for GitHub issues.

## ✅ Resolved Issues (v0.3.0)

All four open issues have been resolved in the `chore/assorted-improvements` PR:

### Issue #19: Return type shows `Promise<any>`
**Status:** ✅ Fixed
**Solution:** Removed unnecessary union/custom bailouts from `InferReturns` type. Research showed convex-helpers handles complex unions without depth issues. Added comprehensive type tests including stress tests for deeply nested schemas.
**Files changed:** `src/types.ts`, `src/__type-tests__/infer-returns.ts`

---

### Issue #20: `zodTable` doesn't accept unions
**Status:** ✅ Fixed
**Solution:** Added overload to `zodTable()` that accepts union schemas for polymorphic tables. Added `addSystemFields()` and `withSystemFields()` helpers.
**Files changed:** `src/tables.ts`, `__tests__/zodtable-unions.test.ts`

---

### Issue #22: `zid` incompatible with AI SDK
**Status:** ✅ Fixed
**Solution:** Removed `.transform()` and `.brand()` from `zid`. Now uses type-level branding only. Added JSON Schema helpers (`toJSONSchema`, `zodvexJSONSchemaOverride`).
**Files changed:** `src/ids.ts`, `src/registry.ts`, `__tests__/zid.test.ts`, `__tests__/ai-sdk-integration.test.ts`

---

### Issue #25: `skipConvexValidation` skips Zod validation
**Status:** ✅ Fixed
**Solution:** Zod validation now always runs regardless of `skipConvexValidation` flag, matching the fix in convex-helpers.
**Files changed:** `src/custom.ts`, `__tests__/skip-convex-validation.test.ts`

---

## Future Enhancements

These are optional follow-ups, not blocking issues:

1. **Advanced union helpers** (Issue #20 follow-up)
   - Discriminator-aware helpers
   - Variant extraction utilities
   - Type-safe variant narrowing

2. **Motiion-inspired utilities** (see `motiion-inspired-utilities.md`)
   - `detectConvexId()` - runtime ID detection
   - `getSchemaDefaults()` - form default extraction
   - Form field type detection

3. **Example project**
   - Full-stack example showing zodvex patterns
   - Demonstrates date handling, unions, AI SDK usage

---

## Research Archives

The detailed research files are preserved for reference:
- `issue-19-return-type-inference.md` - Analysis of the bailout logic
- `issue-20-zodtable-union-support.md` - convex-helpers research
- `issue-22-zid-ai-sdk-compatibility.md` - AI SDK requirements
- `motiion-inspired-utilities.md` - Future utility proposals
