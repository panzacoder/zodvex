# Remove Server Imports from zodvex/core

**Date:** 2026-03-04
**Status:** Approved

## Problem

`zodvex/core` is documented as client-safe, but it transitively imports `convex/server` and `convex-helpers/server` at runtime. This causes Convex to emit console warnings/errors about server code executing in the client.

**Import chain #1 (convex-helpers/server):**
`core/index.ts` → `model.ts` → `tables.ts` → `import { Table } from 'convex-helpers/server'`

The 4 functions model.ts uses from tables.ts (`addSystemFields`, `isZodUnion`, `getUnionOptions`, `createUnionFromOptions`) are pure Zod operations — they don't use `Table` or `defineTable`. They're just co-located.

**Import chain #2 (convex/server):**
`core/index.ts` → `boundaryHelpers.ts` → `import { getFunctionName } from 'convex/server'`

`getFunctionName` reads `ref[Symbol.for("functionName")]` — a well-known symbol used in Convex's own browser bundle. No server-specific logic.

## Design

### Fix 1: Extract pure Zod helpers from tables.ts

Create `src/schemaHelpers.ts` with:
- `isZodUnion()`
- `getUnionOptions()`
- `assertUnionOptions()`
- `createUnionFromOptions()`
- `addSystemFields()`

Update `model.ts` to import from `./schemaHelpers` instead of `./tables`.
Update `tables.ts` to import from `./schemaHelpers` (avoid duplication).

### Fix 2: Inline getFunctionName in boundaryHelpers.ts

Replace `import { getFunctionName } from 'convex/server'` with a local utility:

```typescript
const functionNameSymbol = Symbol.for('functionName')

function resolveFunctionPath(ref: FunctionReference<any, any, any, any>): string {
  if (typeof ref === 'string') return ref
  const name = (ref as any)[functionNameSymbol]
  if (!name) {
    throw new Error('Expected a function reference (e.g. api.file.func)')
  }
  return name
}
```

Keep `import type { FunctionReference } from 'convex/server'` — type-only, erased at compile time.

## Result

After both fixes, `zodvex/core` has zero runtime imports from `convex/server` or `convex-helpers/server`. Only `convex/values` (client-safe) and `zod` remain as runtime dependencies.

Non-breaking: same API surface, same behavior.
