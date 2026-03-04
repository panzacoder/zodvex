# Upstream fixes to eliminate `any` casts in hotpot

From auditing all `biome-ignore noExplicitAny` in hotpot's `convex/` directory.

## 1. `zx.codec` generic inference drops fields when wire schema depends on a generic

**File:** `convex/hotpot/security/sensitive.ts` (decode/encode callbacks)

When `sensitive<T>(inner: T)` creates a wire schema via:

```typescript
const wireSchema = z.object({
  value: inner.nullable(),  // inner is T, a generic
  status: z.enum(['full', 'hidden']),
  reason: z.string().optional(),
  __sensitiveField: z.string().optional(),
})
```

...and passes it to `zx.codec(wireSchema, fieldSchema, { decode, encode })`, TypeScript cannot resolve `z.output<typeof wireSchema>` because `inner.nullable()` depends on the unresolved generic `T`. The `value` field drops out of the inferred decode parameter type entirely, leaving only `{ status, reason?, __sensitiveField? }`.

Result: hotpot must cast `wire: any` on decode and return `any` from encode.

**Possible fix directions:**
- Have `zx.codec` accept explicit wire/runtime type parameters that override inference
- Provide a helper that constructs codec transforms with an explicit wire shape type, e.g. `zx.codec<WireShape, RuntimeShape>(wireSchema, runtimeSchema, transforms)`
- Or accept this as a known TypeScript limitation with generic codec schemas

## 2. Export `unwrapOnce` / schema traversal utilities

**File:** `src/transform/traverse.ts`

zodvex already has `unwrapOnce`, `walkSchema`, `getMetadata`, and `findFieldsWithMeta` — but none are exported from a public entry point. Hotpot independently reimplemented `unwrapOnce` in `convex/hotpot/security/sensitive.ts` (lines 266-314) with 8 `as any` casts for Zod v4 internals.

Both implementations handle the same wrapper types (optional, nullable, default, readonly, catch, prefault, nonoptional, lazy, pipe) and both need the same `as any` casts for Zod v4's `_zod.def` internals.

**Fix:** Export the traversal utilities from a public entry point (e.g., `zodvex/core` or `zodvex/utils`). Hotpot can then delete its local `unwrapOnce` and delegate. The `as any` casts stay (Zod v4 limitation), but they live in one place instead of two.

Note: hotpot's sensitive codec detection via WeakMap (`isSensitiveCodecDirect`) is orthogonal to the unwrapping — it would remain in hotpot regardless.
