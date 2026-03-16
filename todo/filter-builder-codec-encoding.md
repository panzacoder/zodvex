# Encode runtime values in .filter() predicate callbacks

## Context

The codec boundary work for `.withIndex()` and `.withSearchIndex()` is complete — both encode runtime values through field codecs before passing to Convex's native builders. However, `.filter()` still passes its predicate callback through without encoding.

## Current state

```typescript
// src/db.ts — ZodvexQueryChain.filter()
filter(predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<...>): ZodvexQueryChain {
  return this.createChain(this.inner.filter(predicate))
}
```

The `FilterBuilder` the user receives is Convex's native one, which expects wire-format values in comparisons like `.eq('email', wireValue)`.

If a handler receives decoded runtime values (e.g., a Date or a decoded codec object) and passes them into a filter expression, Convex gets the wrong type.

## Why this is low priority

1. **Filters are discouraged by Convex** — they scan documents after index filtering, so most real queries use `.withIndex()` (already handled) instead
2. **Filter expressions use an expression builder API**, not direct value comparisons — many filter patterns don't involve codec-transformed values at all
3. **Hotpot doesn't use `.filter()` with codec fields** — indexes are the primary query mechanism

## Proposed fix

Wrap `FilterBuilder` with a Proxy (same pattern as `wrapIndexRangeBuilder`) that intercepts `.eq()`, `.neq()`, `.lt()`, `.lte()`, `.gt()`, `.gte()` and encodes comparison values through the field's codec.

### Complications

- `FilterBuilder` has a more complex expression tree API than `IndexRangeBuilder` — it includes `.and()`, `.or()`, `.not()`, plus field access expressions
- The field path in a filter expression may be arbitrarily nested (`q.eq(q.field("email"), value)`)
- Need to determine the field path from the expression to look up the correct codec

## Scope

- [ ] Understand `FilterBuilder` API surface from Convex types
- [ ] Implement `wrapFilterBuilder()` with Proxy-based encoding
- [ ] Handle nested field path resolution for codec lookup
- [ ] Add `ZodvexFilterBuilder` type that remaps value types to runtime format
- [ ] Tests
- [ ] Same treatment for `SearchFilterBuilder` if not already covered

## Level of effort

Medium — more complex than the index builder wrapping due to the expression tree API.

## Related

- `src/db.ts:231-235` — current passthrough implementation
- `src/db.ts:143-163` — `wrapIndexRangeBuilder` (the pattern to follow)
- Convex's `FilterBuilder` type definition
