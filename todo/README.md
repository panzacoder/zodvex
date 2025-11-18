# zodvex Issue Tracking

This directory contains detailed analysis and action plans for open GitHub issues.

## Current Open Issues

### 🔴 High Priority

#### [Issue #22: `zid` incompatible with AI SDK](./issue-22-zid-ai-sdk-compatibility.md)
**Status:** Ready to fix
**Impact:** Blocks AI SDK users
**Complexity:** Low (2-3 hours)

**Summary:** `zid` uses `.transform()` which AI SDK doesn't allow. Removing transform also solves TODO #1 (double-branding).

**Action:** Remove `.transform()` and `.brand()` from `zid` implementation.

---

#### [Issue #19: Return type shows `Promise<any>`](./issue-19-return-type-inference.md)
**Status:** Awaiting user response
**Impact:** Developer experience
**Complexity:** Medium (investigation + potential fix)

**Summary:** User reports return types infer as `Promise<any>` instead of proper type. Likely caused by intentional union bailout in `InferReturns` type.

**Action:**
1. [Use draft response](./issue-19-draft-response.md) to gather user's return schema
2. Diagnose exact cause
3. Provide workaround or fix bailout logic

---

### 🟡 Medium Priority

#### [Issue #20: `zodTable` doesn't accept unions](./issue-20-zodtable-union-support.md)
**Status:** Researched - ready to implement
**Impact:** Blocks polymorphic table use cases
**Complexity:** Medium (4-8 hours)

**Summary:** User wants discriminated union tables. Research shows convex-helpers supports this without issue. We artificially restrict `zodTable` to object shapes.

**Key Finding:** convex-helpers/zod4 handles unions perfectly with no type depth issues. Our restriction is artificial.

**Action:**
1. Document workaround (short term)
2. Implement `zodTable` overload for unions (medium term)
3. Add `withSystemFields()` helper for adding _id/_creationTime to union variants

---

## Implementation Priority

### Next PR (Week of 2025-01-20)

**Focus:** Quick wins with high impact

1. ✅ **Fix Issue #22** - Remove transform from `zid`
   - Also solves TODO #1 (double-branding)
   - Enables AI SDK compatibility
   - 2-3 hours of work

2. ✅ **Document Issue #20** - Add union table workaround to README
   - Show how to use `zodToConvexFields` directly
   - 30 minutes

3. ⏳ **Respond to Issue #19** - Gather information
   - Use draft response
   - Wait for user's schema

### Following PR (Week of 2025-01-27)

**Focus:** Type inference improvements

1. **Investigate Issue #19** - Improve `InferReturns`
   - Remove unnecessary bailouts
   - Add smarter depth detection
   - Benchmark TypeScript performance

2. **Implement Issue #20** - Union table support
   - Add `zodTable` overload
   - Create `withSystemFields` helper
   - Comprehensive tests

### Future Enhancements

1. **AI SDK utilities** (Issue #22 follow-up)
   - Research Zod 4 `.annotations()` for JSON schema
   - Create `toAISchema()` helper for complex transforms
   - Document best practices

2. **Advanced union helpers** (Issue #20 follow-up)
   - Discriminator-aware helpers
   - Variant extraction utilities
   - Type-safe variant narrowing

---

## Research Completed

### ✅ convex-helpers/zod4 Union Handling (Issue #20)

**Key Findings:**
- They support unions in table definitions without issue
- No type depth bailouts for unions
- Simple recursive conversion: `z.union([...])` → `v.union(...)`
- Extensive test coverage with no reported issues

**Implications:**
- Our union bailout in `InferReturns` may be unnecessary
- Can safely support unions in `zodTable`
- Type depth fears were overblown

### ✅ Zod 4 AI SDK Restrictions (Issue #22)

**Key Findings:**
- AI SDK requires serializable schemas
- Transforms are blocked
- Refinements and descriptions are allowed
- Need to research `.annotations()` for fallbacks

---

## Testing Requirements

### Issue #22 Tests
- [ ] `zid` without transform maintains type safety
- [ ] WeakMap registry still works
- [ ] `zodToConvex(zid('users'))` returns `v.id('users')`
- [ ] AI SDK `generateObject()` works with schemas containing `zid`

### Issue #19 Tests
- [ ] Simple return schemas infer correctly
- [ ] Union return schemas (current behavior documented)
- [ ] Enum return schemas
- [ ] Nested object return schemas

### Issue #20 Tests
- [ ] Simple union tables
- [ ] Discriminated union tables
- [ ] Union with system fields
- [ ] Array of union documents

---

## Documentation Updates Needed

### README.md

**New Sections:**
- [ ] AI SDK compatibility (Issue #22)
- [ ] Polymorphic tables with unions (Issue #20)
- [ ] FAQ: Return type inference limitations (Issue #19)

**Updates:**
- [ ] Date handling (✅ Already done)
- [ ] Comparison with convex-helpers (✅ Already done)

### New Docs
- [ ] MIGRATION.md - From convex-helpers
- [ ] CONTRIBUTING.md - Development setup
- [ ] Advanced guide - AI SDK, unions, custom types

---

## Communication Log

### Issue #19 Response
**Status:** Draft ready - [see draft](./issue-19-draft-response.md)
**Next Step:** Post response and wait for user info

### Issue #20 Communication
**Status:** No response needed yet
**Next Step:** Document workaround in README, then implement

### Issue #22 Communication
**Status:** No response needed - clear bug
**Next Step:** Fix and close with PR

---

## Related TODOs

From `TODO.md`:

**Directly Related:**
- TODO #1: Remove double-branding from `zid` (↔️ Issue #22)
- TODO #5: Add comprehensive edge case tests (↔️ All issues)
- TODO #6: Performance optimization (↔️ Issue #19)

**Indirectly Related:**
- TODO #3: Add example project (helps users avoid these issues)
- TODO #13: API documentation site (better issue documentation)
- TODO #15: Integration tests (catch these earlier)

---

## Notes

- All three issues are valid and actionable
- Issue #22 is a quick fix with high impact
- Issue #20 research shows our fears were unfounded
- Issue #19 needs more user information
- No blockers - can proceed with all fixes

**Estimated total effort:**
- Issue #22: 2-3 hours
- Issue #19: 4-6 hours (after user response)
- Issue #20: 6-8 hours
- **Total: ~15 hours** spread across 2-3 PRs
