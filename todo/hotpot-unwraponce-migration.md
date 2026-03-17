# Hotpot: `unwrapOnce` convergence (post-v0.6.0)

## Status: Deferred

The implementations have diverged and a direct import won't work today.

## Why it's deferred

| | Hotpot local | zodvex internal |
|---|---|---|
| Exported? | Yes (used by `findSensitiveFields`) | No — private to `zodvex/src/transform/traverse.ts` |
| Check method | `instanceof` (Zod v4 native classes) | `_def.type` string matching |
| Sensitive handling | Via WeakMap metadata lookup | Explicit `'sensitive'` type case |

Beyond the export gap, the detection strategies differ (`instanceof` vs string matching) and hotpot has purpose-built traversal (`findSensitiveFields()`, `traverseSchema()`) that doesn't map onto zodvex's `walkSchema()` / `findFieldsWithMeta()`.

## What convergence would require

1. Align on detection strategy (instanceof vs string matching) — or make zodvex's version configurable
2. Export `unwrapOnce` from `zodvex/transform` (and `zodvex/core`)
3. Verify hotpot's `isSensitiveSchema()` and `findSensitiveFields()` still work with the zodvex version
4. Consider whether zodvex should also export generic traversal utilities that hotpot could build on

## What stays in hotpot regardless

- `isSensitiveCodecDirect` (WeakMap detection) — orthogonal to unwrapping
- `SensitiveField` type and codec logic — hotpot-specific
- Sensitive-field-specific traversal that goes beyond generic unwrapping
