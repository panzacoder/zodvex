# Function-Embedded Codec Discovery

**Date:** 2026-02-25
**Status:** Approved

## Problem

When a developer writes inline codec factory calls in function args:

```typescript
export const getByEmail = zq({
  args: { email: sensitive(z.string()) },  // new codec instance, not from model
  handler: async (ctx, { email }) => { ... },
})
```

The codegen emits `/* codec: transforms lost */` because the codec instance doesn't exist in any model schema and isn't a module-level export. The recursive model walker (added same day) only finds codecs embedded in model schemas.

## Solution

Walk function `zodArgs` and `zodReturns` schemas with the same recursive walker used for models. For codecs found that aren't already in the codecMap (from exports or models), generate runtime expressions that navigate through the function's metadata.

### Precedence

Exported codecs > model-embedded > function-embedded. If the same codec instance appears in multiple sources, the higher-precedence reference wins.

### Runtime Utilities

Two small functions in `zodvex/codegen`:

```typescript
export function readFnArgs(fn: unknown): z.ZodTypeAny
export function readFnReturns(fn: unknown): z.ZodTypeAny
```

These extract `zodArgs`/`zodReturns` from the function's `__zodvexMeta` property (set by `attachMeta` during `zq`/`zm`/`za` registration).

### Generated Output

```typescript
import { extractCodec, readFnArgs } from 'zodvex/codegen'
import { getByEmail } from '../users'

const _fc0 = extractCodec(readFnArgs(getByEmail).shape.email)

export const zodvexRegistry = {
  'users:getByEmail': {
    args: z.object({ email: _fc0 }),  // no more "transforms lost"
    returns: UserModel.schema.doc.nullable(),
  },
}
```

### New Types

```typescript
type FunctionEmbeddedCodec = {
  codec: z.ZodTypeAny
  functionExportName: string
  functionSourceFile: string
  schemaSource: 'zodArgs' | 'zodReturns'
  accessPath: string
}
```

### Files Changed

1. `codegen/extractCodec.ts` — add `readFnArgs`, `readFnReturns`
2. `codegen/index.ts` — export new utilities
3. `codegen/discover.ts` — add `FunctionEmbeddedCodec`, `walkFunctionCodecs`, update `DiscoveryResult`
4. `codegen/generate.ts` — add function codec processing to `generateApiFile`
5. `cli/commands.ts` — pass `functionCodecs` to `generateApiFile`
6. Tests — unit + E2E coverage
