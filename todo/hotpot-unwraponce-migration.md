# Hotpot: migrate to zodvex's `unwrapOnce`

zodvex now exports `unwrapOnce` from `zodvex/transform` (and `zodvex/core`).

## What to do

In `convex/hotpot/security/sensitive.ts`:

1. **Replace the local `unwrapOnce` implementation** (lines ~266-314) with a single import:

```typescript
import { unwrapOnce } from 'zodvex/transform'
```

2. **Delete the local function** — it's an identical reimplementation of zodvex's internal helper, including the same Zod v4 `as any` casts and the same wrapper types (optional, nullable, default, readonly, catch, prefault, nonoptional, lazy, pipe).

3. **Verify** that `isSensitiveSchema()` and `findSensitiveFields()` (which call `unwrapOnce`) still work. The function signature is identical: `(schema: z.ZodTypeAny) => z.ZodTypeAny | undefined`.

## What stays in hotpot

- `isSensitiveCodecDirect` (WeakMap detection) — orthogonal to unwrapping
- `SensitiveField` type and codec logic — hotpot-specific
- Any hotpot-specific `sensitive` type detection that goes beyond generic unwrapping

## Minimum zodvex version

Requires zodvex `>=0.6.0-beta.51` (the next publish after this export lands).
