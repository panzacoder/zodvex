# Hotpot Model & Schema Simplification

> Guidance for the hotpot agent to align model/schema definitions with zodvex conventions.
> Supersedes P0c in the adoption guide. Should be applied before Phase 5 (wrapDb:true).

**Date:** 2026-02-25
**zodvex version:** 0.6.0-beta.2+ (will be beta.3 after this ships)

---

## Problem

hotpot's `defineHotpotModel` and `defineHotpotSchema` reimplement functionality that zodvex already provides. This creates:

1. **Parallel types** — `HotpotModel` mirrors `ZodModel` but is a separate type with its own index config types (`IndexConfig`, `SearchIndexConfig`, `VectorIndexConfig`) that shadow zodvex's.
2. **Unnecessary `any` casts** — Indexes are taken as a config object and chained in a loop, forcing `let zodModel: any` because TypeScript can't accumulate generic changes across iterations.
3. **Hidden zodvex API** — Consumers never see `defineZodModel`, `.index()` chaining, or `defineZodSchema`. This means zodvex improvements don't reach consumers naturally.
4. **Redundant validation** — `defineHotpotSchema` wraps `defineZodSchema` only to add name validation. zodvex now does this natively (beta.3+).

## What hotpot legitimately needs on top of zodvex

Only two things:

1. **Retention field + index injection** — every model gets `sensitiveExpiresAt: z.number().optional()` and a `by_sensitiveExpiresAt` index. This is a thin wrapper concern.
2. **Security rules attachment** — RLS/FLS rules metadata that the security layer reads at runtime.

Everything else — index accumulation, schema types, type guards, schema definition wrapping — should defer to zodvex.

---

## Target Architecture

### Consumer-facing model definition

```typescript
// convex/models/patients.ts
import { z } from 'zod'
import { defineHotpotModel, sensitive } from '@/convex/hotpot/model'

export const patients = defineHotpotModel('patients', {
  clinicId: z.string(),
  email: sensitive(z.string().email()).optional(),
  phoneNumber: sensitive(z.string()).optional(),
  firstName: sensitive(z.string()).optional(),
  lastName: sensitive(z.string()).optional(),
  timezone: z.string().optional(),
  isIdentified: z.boolean().optional(),
}, {
  rules: {
    rls: {
      requirements: {
        anyOf: [
          { role: 'patient', self: true },
          { role: 'provider', sameClinic: true },
        ],
      },
    },
  },
})
  .index('clinicId', ['clinicId', 'isIdentified'])
  .index('email', ['email.value'])
  .index('phoneNumber', ['phoneNumber.value'])
```

Key differences from current code:
- **Indexes are chained** via zodvex's `.index()` — type-safe field path validation, no `any`
- **No `index:` config object** — removed from `HotpotModelConfig`
- **Same `sensitive()` and rules** — no change to security metadata

### `defineHotpotModel` implementation

```typescript
// convex/hotpot/model.ts
import { z } from 'zod'
import { defineZodModel } from 'zodvex/core'
import { RETENTION_FIELD, RETENTION_INDEX } from './security/retention'

// Rules registry — keyed by table name, populated at module evaluation time
const rulesRegistry = new Map<string, ModelRules>()

export function getRules(tableName: string): ModelRules | undefined {
  return rulesRegistry.get(tableName)
}

export function defineHotpotModel<
  Name extends string,
  Fields extends z.ZodRawShape,
>(
  name: Name,
  fields: Fields,
  config?: { rules?: ModelRules },
) {
  // Register rules by table name (security layer looks them up later)
  if (config?.rules) {
    rulesRegistry.set(name, config.rules)
  }

  // Inject retention field, delegate to zodvex, chain retention index
  const fieldsWithRetention = {
    ...fields,
    [RETENTION_FIELD]: z.number().optional(),
  }

  return defineZodModel(name, fieldsWithRetention)
    .index(RETENTION_INDEX, [RETENTION_FIELD])
}
```

What this does:
- Returns an **actual ZodModel** — consumers chain `.index()` with full type safety
- Injects retention field + retention index (the two hotpot-universal concerns)
- Stores rules in a registry keyed by table name
- No `HotpotModel` type, no `any` casts, no parallel index config types

### Rules access in the security layer

```typescript
// BEFORE: rules were on the model object
const rules = model.rules

// AFTER: rules are in a registry keyed by table name
import { getRules } from '@/convex/hotpot/model'
const rules = getRules('patients')
```

### Schema definition

```typescript
// convex/schema.ts
import { defineZodSchema } from 'zodvex/server'
import { patients } from './models/patients'
import { visits } from './models/visits'
import { journal } from './models/journal'

export default defineZodSchema({ patients, visits, journal })
```

- **No `defineHotpotSchema`** — `defineZodSchema` now validates model names match keys natively (zodvex beta.3+)
- Models ARE ZodModels — they satisfy `ZodModelEntry` structurally
- Extra properties on the model (if any) are ignored by `defineZodSchema`

### Composition root

```typescript
// convex/zodvex.ts — unchanged from current
import { initZodvex } from 'zodvex/server'
import * as server from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server, { wrapDb: false })
```

No change needed here — `schema` already carries `__zodTableMap` + `__decodedDocs` from `defineZodSchema`.

---

## What to delete

| File/Type | Reason |
|-----------|--------|
| `HotpotModel` type | Replaced by `ZodModel` (from zodvex) |
| `HotpotModelConfig` type | Simplified to `{ rules?: ModelRules }` |
| `IndexConfig` type | Use zodvex's `.index()` chaining |
| `SearchIndexConfig` type (hotpot's) | Import from `zodvex/core` if needed |
| `VectorIndexConfig` type (hotpot's) | Import from `zodvex/core` if needed |
| `WithCreationTime<I>` type | zodvex handles `_creationTime` internally |
| `RetentionIndex` type | Retention index chained directly |
| `isHotpotModel()` type guard | `defineZodSchema` validates model entries |
| `defineHotpotSchema()` | Use `defineZodSchema` directly |
| `convex/hotpot/schema.ts` | Entire file eliminated |
| `ValidateModelKeys<T>` type | Name validation now in `defineZodSchema` |
| `HotpotSchemaInput` type | Not needed |

## What to keep

| Item | Reason |
|------|--------|
| `defineHotpotModel()` | Thin wrapper for retention injection + rules registration |
| `sensitive()` re-export | Convenience for consumers |
| `ModelRules`, `RlsRules`, `FlsRules` etc. | Domain-specific types |
| `HotpotSecurityScope` | Domain-specific type |
| `getRules()` | New — registry access for security layer |

## Migration steps

1. **Rewrite `defineHotpotModel`** — thin wrapper returning ZodModel, rules registry
2. **Update model files** — move index declarations from config object to `.index()` chains
3. **Update security layer** — use `getRules(tableName)` instead of `model.rules`
4. **Replace `defineHotpotSchema`** — use `defineZodSchema` directly in `convex/schema.ts`
5. **Delete dead code** — `HotpotModel`, parallel types, `convex/hotpot/schema.ts`
6. **Update tests** — remove `defineHotpotSchema` tests, update model tests for new shape

## Notes

- The return type of `defineHotpotModel` is now `ZodModel<Name, Fields & RetentionFields, ...>` — consumers get full `.index()`, `.searchIndex()`, `.vectorIndex()` chaining with type-safe field paths
- `defineZodSchema` ignores extra properties on model entries, so if any hotpot metadata is attached to the model object it won't cause issues
- `ZodModelEntry` is now exported from `zodvex/server` for consumers who need to reference the structural contract
