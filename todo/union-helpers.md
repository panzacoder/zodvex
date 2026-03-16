# Union helpers — reassessment

Follow-up to Issue #20 (zodTable union support).

## Status after v0.6.0-beta work

The original scope (discriminator-aware helpers, variant extraction, type-safe narrowing) was
written before the union table infrastructure landed. Reassessing what's actually needed:

### Already solved

- **Top-level discriminated union tables** — `defineZodModel()` accepts `z.discriminatedUnion()`
  as the entire document shape. Schema definition, table creation, and CRUD all work.
  See `examples/task-manager/convex/models/notification.ts`.
- **Indexes on shared fields** — `by_recipient`, `by_kind`, compound indexes all work.
- **Zod v4 built-in discriminator** — `z.discriminatedUnion()` already provides O(1) variant
  lookup natively. No wrapper needed.

### Real remaining gap

**Union index encoding** — `encodeIndexValue()` doesn't handle union schemas. Codec fields
(like `zx.date()`) in union tables won't encode correctly in `.withIndex()` comparisons on a
real Convex backend. See `todo/union-index-encoding.md` for the fix design.

### Questionable value

The originally-proposed helpers (variant extraction, discriminator-aware lookup, type-safe
narrowing) duplicate what Zod v4 provides natively:
- `z.discriminatedUnion()` does O(1) lookup by discriminator
- TypeScript narrowing on the discriminator field already works
- `schema.options` gives you the variants array

These would only be valuable if there's a concrete consumer use case that Zod's built-in
API doesn't cover. None has been identified.

## Discord context

Discord thread #1313408550407634964 (Oct 2024) discussed type errors with union tables in
zodTable/convex-helpers. The core issue — `defineTable()` receiving `{}` for union models —
has been fixed in `tableFromModel()` (schema.ts). The remaining gap is index encoding.
