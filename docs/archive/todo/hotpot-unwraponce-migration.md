# Hotpot: `unwrapOnce` convergence (post-v0.6.0)

## Status: Exported

`unwrapOnce` and traversal utilities are now exported from all public entry points.

## Available imports

```ts
// From dedicated transform module
import { unwrapOnce, walkSchema, findFieldsWithMeta, getMetadata, hasMetadata } from 'zodvex/transform'

// From client-safe core
import { unwrapOnce, walkSchema, findFieldsWithMeta, getMetadata, hasMetadata } from 'zodvex/core'

// From main entry
import { unwrapOnce, walkSchema, findFieldsWithMeta, getMetadata, hasMetadata } from 'zodvex'
```

## Remaining divergence

| | Hotpot local | zodvex exported |
|---|---|---|
| Check method | `instanceof` (Zod v4 native classes) | `_def.type` string matching |
| Sensitive handling | Via WeakMap metadata lookup | Explicit `'sensitive'` type case |

The detection strategies still differ (`instanceof` vs string matching). Hotpot can now import `unwrapOnce` directly, but may need to verify that `_def.type` string matching works for its use cases before dropping the local copy.

## What convergence still requires

1. Verify hotpot's `isSensitiveSchema()` and `findSensitiveFields()` work with the zodvex `unwrapOnce`
2. If `instanceof` checks are needed, hotpot keeps its local version or we add an `instanceof` mode

## What stays in hotpot regardless

- `isSensitiveCodecDirect` (WeakMap detection) — orthogonal to unwrapping
- `SensitiveField` type and codec logic — hotpot-specific
- Sensitive-field-specific traversal that goes beyond generic unwrapping
