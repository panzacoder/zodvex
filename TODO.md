# zodvex TODO

Issues and improvements identified from convex-helpers PR review and Nicolapps feedback.

## High Priority

### 1. Consider Removing Double-Branding in `zid`
**Status:** Discussion needed
**Context:** Nicolapps noted that `zid` uses both Convex's native `GenericId<T>` branding AND Zod's `.brand()`, which creates a double-branded type.

**Current implementation (src/ids.ts:21-35):**
```typescript
const baseSchema = z.string()
  .refine(...)
  .transform(val => val as string & GenericId<TableName>)
  .brand(`ConvexId_${tableName}`) // <- Double branding
  .describe(`convexId:${tableName}`)
```

**Possible improvement:**
```typescript
const baseSchema = z.string()
  .refine(...)
  .transform(val => val as GenericId<TableName>) // Single branding
  .describe(`convexId:${tableName}`)
```

**Pros:**
- Cleaner type signature
- Avoids theoretical compatibility issues with Convex's branded types
- Still preserves WeakMap registry for mapping

**Cons:**
- Need to verify WeakMap registry still works without `.brand()`
- May need alternative way to track metadata

**Action items:**
- [ ] Test removing `.brand()` while keeping WeakMap registry
- [ ] Verify type inference still works
- [ ] Check if `.describe()` alone is sufficient for introspection
- [ ] Run full test suite

---

### 2. Improve Documentation Around Automatic vs Manual Conversion
**Status:** ✅ **DONE** (2025-01-18)
**Context:** Nicolapps criticized "manual frontend calls" but this was based on misunderstanding - only needed if using `z.string()` instead of `z.date()`.

**Completed:**
- [x] Enhanced "Date Handling" section in README
- [x] Added clear examples showing when automatic conversion happens
- [x] Documented difference between `z.date()` vs `z.string()`
- [x] Added edge case documentation for unions
- [x] Added comparison section with convex-helpers/zod4

---

### 3. Add Example Project / Demo
**Status:** Not started
**Context:** Would help users see zodvex in action and understand the DX benefits over manual approaches.

**Scope:**
- Simple full-stack example (Next.js or Vite + React)
- Shows table definitions, queries, mutations, actions
- Demonstrates date handling
- Shows custom builders with auth
- Includes tests

**Action items:**
- [ ] Create `examples/` directory
- [ ] Set up basic Convex + React project
- [ ] Implement 2-3 tables with various field types
- [ ] Show CRUD operations
- [ ] Document setup in example README

---

## Medium Priority

### 4. Database-Level Wrapper (Optional Utility)
**Status:** Consideration
**Context:** Nicolapps noted convex-helpers doesn't provide database wrappers. zodvex's function wrappers handle 90% of use cases, but a database-level wrapper could help with the remaining 10%.

**Use case:**
```typescript
// Currently, users must manually handle encoding for direct db calls
const now = new Date()
await ctx.db.insert('events', {
  title: 'Event',
  startDate: now.getTime() // Manual encoding
})

// With database wrapper
const db = createDbWrapper(ctx)
await db.insert('events', {
  title: 'Event',
  startDate: now // Automatic encoding
})
```

**Considerations:**
- Low priority - function wrappers solve most cases
- Would require schema registry to know which fields need encoding
- May add complexity that conflicts with "batteries-included but not magic" philosophy
- Alternative: Encourage users to use function wrappers instead of direct db access

**Action items:**
- [ ] Gather user feedback on whether this is needed
- [ ] If needed, design schema registry approach
- [ ] Consider making it opt-in utility rather than core feature

---

### 5. Add More Comprehensive Tests for Edge Cases
**Status:** In progress
**Context:** Nicolapps found bugs in the original PR #818 (empty unions, partial records, etc.)

**Test coverage to add:**
- [ ] Empty unions (`z.union([])` → should return `v.union()` not `v.any()`)
- [ ] Partial records (Zod 4 feature)
- [ ] Template literals (`z.templateLiteral()`)
- [ ] Tuple types with varying lengths
- [ ] Self-referential/recursive types
- [ ] Literal arrays (`z.literal([1, 2, 3])`)
- [ ] Records with literal keys vs string keys
- [ ] Circular schema detection

**Action items:**
- [ ] Review convex-helpers/zod4 test suite for ideas
- [ ] Add tests for each edge case
- [ ] Document any intentional limitations

---

### 6. Performance Optimization: Visited Set Tracking
**Status:** Review needed
**Context:** The `visited` Set in `zodToConvexInternal` prevents infinite recursion. Could be optimized.

**Current approach (src/mapping/core.ts:23-34):**
```typescript
function zodToConvexInternal<Z extends z.ZodTypeAny>(
  zodValidator: Z,
  visited: Set<z.ZodTypeAny> = new Set()
): ConvexValidatorFromZod<Z, 'required'> {
  if (visited.has(zodValidator)) {
    return v.any() as ConvexValidatorFromZod<Z, 'required'>
  }
  visited.add(zodValidator)
  // ...
}
```

**Potential improvements:**
- Add comment explaining why visited set is needed (circular references)
- Add test demonstrating circular reference handling
- Consider caching converted validators (WeakMap) for repeated conversions

**Action items:**
- [ ] Add JSDoc comment explaining circular reference handling
- [ ] Add test case for `z.lazy()` recursive schemas
- [ ] Benchmark performance on large schemas
- [ ] Consider memoization if performance issues arise

---

## Low Priority / Future Enhancements

### 7. Support for Zod 3 (Backwards Compatibility)
**Status:** Not planned
**Context:** zodvex is Zod v4 only, while convex-helpers supports both v3 and v4.

**Rationale for current approach:**
- Cleaner codebase focusing on modern Zod
- Avoids complexity of supporting two APIs
- Zod v4 has been stable since early 2024
- Most projects can upgrade to Zod v4

**Reconsider if:**
- User demand is high
- Major projects are stuck on Zod v3
- Would require significant refactoring

---

### 8. Convex Codecs Integration (Zod 4.1+)
**Status:** Future consideration
**Context:** Zod 4.1 introduced native codec support. zodvex's approach differs.

**Zod 4.1 codecs:**
```typescript
const dateCodec = z.codec(z.number(), z.date(), {
  encode: (date) => date.getTime(),
  decode: (num) => new Date(num)
})
```

**zodvex approach:**
```typescript
// Automatic via registry
const schema = z.object({ created: z.date() })
```

**Considerations:**
- zodvex's automatic approach is more ergonomic for common cases
- Zod codecs are more explicit and composable
- Could support both: automatic for dates, manual for custom types
- Requires research into how to integrate both approaches

**Action items:**
- [ ] Research Zod 4.1 codec API
- [ ] Determine if integration makes sense
- [ ] Consider allowing users to register custom codecs via registry
- [ ] Gather feedback from users on preferred approach

---

### 9. Better Type Inference for Enum Types
**Status:** Limitation documented
**Context:** Zod v4 changed enum types from tuples to Records, affecting type inference.

**Current behavior (documented in README:364-385):**
```typescript
// Manual union (precise tuple type)
const manual = v.union(v.literal('a'), v.literal('b'))
// Type: VUnion<"a" | "b", [VLiteral<"a">, VLiteral<"b">], ...>

// From Zod enum (array type)
const fromZod = zodToConvex(z.enum(['a', 'b']))
// Type: VUnion<"a" | "b", Array<VLiteral<"a" | "b">>, ...>
```

**Impact:**
- Purely cosmetic difference
- Runtime behavior identical
- Type safety preserved
- No functional issues

**Potential solutions:**
- TypeScript doesn't allow Record → tuple conversion without runtime keys
- Could use type assertions, but would break type safety
- Best to leave as-is and document limitation

**Action items:**
- [x] Document limitation clearly (already done)
- [ ] Monitor Zod v4 changes for potential solutions
- [ ] Consider if tuple types are critical for any use case

---

### 10. Custom Codec Registry Enhancement
**Status:** Enhancement idea
**Context:** The registry system (src/registry.ts) allows custom codecs, but could be more powerful.

**Current capabilities:**
- Register custom codecs for specific types
- Built-in Date codec
- Check/toValidator/fromConvex/toConvex interface

**Potential enhancements:**
- Allow users to register domain-specific codecs (e.g., Money, URL objects)
- Provide TypeScript helper for creating type-safe codecs
- Add documentation/examples for custom codecs
- Consider codec composition utilities

**Example API:**
```typescript
import { registerCodec } from 'zodvex'

// Custom money type
registerCodec({
  check: (schema) => schema instanceof MoneySchema,
  toValidator: () => v.object({ amount: v.int64(), currency: v.string() }),
  fromConvex: ({ amount, currency }) => new Money(amount, currency),
  toConvex: (money) => ({ amount: money.amount, currency: money.currency })
})
```

**Action items:**
- [ ] Document existing registry system
- [ ] Add examples of custom codecs
- [ ] Consider helper utilities for common codec patterns
- [ ] Gather user feedback on what custom types are needed

---

### 11. Migration Guide from convex-helpers/zod3
**Status:** Not started
**Context:** Users upgrading from convex-helpers Zod v3 support might benefit from a migration guide.

**Scope:**
- API differences
- Breaking changes
- Benefits of zodvex approach
- Step-by-step migration process

**Action items:**
- [ ] Create MIGRATION.md
- [ ] Document API mapping (zCustomQuery → zQueryBuilder, etc.)
- [ ] Provide code examples
- [ ] List breaking changes

---

### 12. Performance Benchmarks
**Status:** Not started
**Context:** Would be valuable to know performance characteristics compared to native Convex validators and convex-helpers.

**Metrics to measure:**
- Schema conversion time (zodToConvex)
- Runtime validation overhead
- Type checking performance (compilation time)
- Memory usage

**Action items:**
- [ ] Create benchmark suite
- [ ] Compare against convex-helpers/zod4
- [ ] Compare against native Convex validators
- [ ] Document results

---

## Documentation Improvements

### 13. API Documentation Website
**Status:** Future enhancement
**Context:** README is comprehensive but an API docs site would be valuable.

**Tools to consider:**
- TypeDoc for API reference
- VitePress/Docusaurus for user guide
- Automatic generation from JSDoc comments

**Action items:**
- [ ] Add JSDoc comments to all public APIs
- [ ] Set up TypeDoc or similar
- [ ] Create docs site
- [ ] Deploy to GitHub Pages or Vercel

---

### 14. Video Tutorial / Walkthrough
**Status:** Future content
**Context:** Some users learn better from video content.

**Content ideas:**
- Quick start (5-10 min)
- Deep dive on table helpers (10 min)
- Custom builders with auth (15 min)
- Comparison with convex-helpers (10 min)

**Action items:**
- [ ] Script video content
- [ ] Record screencasts
- [ ] Upload to YouTube
- [ ] Link from README

---

## Testing & Quality

### 15. Add Integration Tests with Real Convex Backend
**Status:** Not started
**Context:** Current tests are unit tests. Integration tests would catch more issues.

**Scope:**
- Use convex-test for isolated testing
- Test full CRUD operations
- Test date round-tripping
- Test auth flows with custom builders

**Action items:**
- [ ] Set up test Convex project
- [ ] Add integration test suite
- [ ] Run in CI/CD

---

### 16. Add Type-Level Tests
**Status:** Partial
**Context:** Some type tests exist but could be more comprehensive.

**Current coverage:**
- Basic type inference
- Some edge cases

**Additional coverage needed:**
- [ ] Branded type compatibility
- [ ] Builder type inference
- [ ] Custom context type merging
- [ ] Return type validation

**Tools:**
- [ ] Consider tsd or expect-type
- [ ] Add to CI/CD

---

## Community & Ecosystem

### 17. Create Discussion Forum / Discord
**Status:** Future consideration
**Context:** GitHub Discussions or Discord could help build community.

**Action items:**
- [ ] Enable GitHub Discussions
- [ ] Or create Discord server
- [ ] Monitor and engage with users

---

### 18. Publish Comparison Article/Blog Post
**Status:** Future content
**Context:** Would help users understand when to use zodvex vs convex-helpers.

**Content:**
- Philosophy differences
- Code examples side-by-side
- Migration scenarios
- Decision tree for choosing

**Action items:**
- [ ] Write article draft
- [ ] Get feedback from Convex team
- [ ] Publish on dev.to / Medium
- [ ] Share in Convex community

---

## Repository Improvements

### 19. Add CONTRIBUTING.md
**Status:** Not started
**Content:**
- How to set up development environment
- How to run tests
- Code style guidelines
- PR process

---

### 20. Set Up Changesets for Version Management
**Status:** Not started
**Context:** Automated changelog and version bumping would improve release process.

**Action items:**
- [ ] Install @changesets/cli
- [ ] Configure changesets
- [ ] Update release process documentation

---

## Notes

- Priorities may shift based on user feedback
- Some items may be closed as "won't fix" if they conflict with zodvex's philosophy
- Open issues on GitHub for tracking specific items
