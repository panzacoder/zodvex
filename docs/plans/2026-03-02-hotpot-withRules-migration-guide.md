# Hotpot Migration Guide: `withRules()` + `audit()`

> Migrate hotpot from hand-rolled security wrappers to zodvex's `.withRules()` + `.audit()`.
>
> zodvex version: **0.6.0-beta.30**

## What gets deleted (~440 lines)

| File | What | Lines |
|------|------|-------|
| `convex/hotpot/security/db.ts` | `SecureQueryChainImpl` class | 427-597 |
| `convex/hotpot/security/db.ts` | `SecureQueryChain` type | 96-125 |
| `convex/hotpot/security/db.ts` | `SecurityReader` / `SecurityWriter` types | 127-163 |
| `convex/hotpot/security/db.ts` | `createSecurityReader` / `createSecurityWriter` | 204-411 |
| `convex/hotpot/security/db.ts` | `secureSingleDoc` helper | 169-202 |

Keep: `SecureDbConfig`, `DeniedInfo`, `isHotpotSecurityContext`, `wrapForWrite` (move to rules adapter).

## What stays unchanged

- `convex/hotpot/security/rls.ts` — `checkRlsRead`, `checkRlsWrite`
- `convex/hotpot/security/fls.ts` — `applyFlsRuntime`, `applyFlsWriteRuntime`
- `convex/hotpot/security/policy.ts` — `resolveReadPolicy`, `resolveWritePolicy`
- `convex/hotpot/security/config.ts` — `hotpotResolver`, `resolveContext`, `HotpotSecurityContext`
- `convex/hotpot/security/rules.ts` — `defineModelRules`, `ModelRules`
- `convex/hotpot/security/sensitiveField.ts` — `SensitiveField` class
- `convex/hotpot/security/audit/logger.ts` — `produceWriteAuditLog`, `produceReadAuditLog`
- `convex/hotpot/model.ts` — `defineHotpotModel`, `rulesRegistry`, `getRules`

## New file: `convex/hotpot/security/withRulesAdapter.ts`

This file bridges hotpot's existing security infrastructure (RLS requirements, FLS policies, entitlement resolver) to zodvex's `TableRules` shape.

```ts
import type { CodecRules, TableRules } from 'zodvex/server'
import type { DataModel } from '@/convex/_generated/dataModel'
import type { HotpotDocTypes } from '@/convex/models'
import type { CompositeRequirement, HotpotRequirement } from '../requirements'
import type { HotpotSecurityContext } from './config'
import type { SecureDbConfig } from './db'
import { applyFlsRuntime, applyFlsWriteRuntime } from './fls'
import { calculateExpiresAt, RETENTION_FIELD } from './retention'
import { checkRlsRead, checkRlsWrite } from './rls'
import { findSensitiveFields } from './sensitive'

type HotpotRulesCtx = {
  securityCtx: HotpotSecurityContext
  securityConfig: SecureDbConfig<
    HotpotSecurityContext,
    HotpotRequirement | CompositeRequirement,
    DataModel,
    HotpotDocTypes
  >
}

/**
 * Converts hotpot's SecureDbConfig into zodvex CodecRules.
 *
 * Each table gets a TableRules<HotpotRulesCtx, Doc> that delegates
 * to the existing checkRlsRead/Write + applyFlsRuntime/WriteRuntime
 * infrastructure. No security logic changes — just plumbing.
 */
export function buildCodecRules(
  config: SecureDbConfig<
    HotpotSecurityContext,
    HotpotRequirement | CompositeRequirement,
    DataModel,
    HotpotDocTypes
  >,
): Record<string, TableRules<HotpotRulesCtx, any>> {
  const rules: Record<string, TableRules<HotpotRulesCtx, any>> = {}

  // Build rules for every table that has RLS rules OR an FLS schema
  const tableNames = new Set([
    ...Object.keys(config.rules ?? {}),
    ...Object.keys(config.schemas ?? {}),
  ])

  for (const table of tableNames) {
    rules[table] = buildTableRules(table, config)
  }

  return rules
}

function buildTableRules(
  table: string,
  config: SecureDbConfig<
    HotpotSecurityContext,
    HotpotRequirement | CompositeRequirement,
    DataModel,
    HotpotDocTypes
  >,
): TableRules<HotpotRulesCtx, any> {
  const rlsRule = config.rules?.[table]
  const schema = config.schemas?.[table]
  const hasSensitiveFields = schema ? findSensitiveFields(schema).length > 0 : false

  return {
    // --- Read: RLS gate + FLS transform ---
    read: async (ctx, doc) => {
      // RLS check
      const rlsResult = await checkRlsRead(
        ctx.securityCtx, doc, rlsRule as any, config.resolver,
      )
      if (!rlsResult.allowed) {
        config.onDenied?.({
          table: table as any,
          reason: rlsResult.reason,
          operation: 'read',
        })
        return null
      }

      // FLS transform
      if (schema) {
        return applyFlsRuntime(doc, schema, ctx.securityCtx, config.resolver, {
          defaultReadPolicy: config.defaultReadPolicy,
          fieldRules: config.fieldRules?.[table],
          table,
        } as any)
      }

      return doc
    },

    // --- Insert: RLS gate + FLS write validation + retention ---
    insert: async (ctx, value) => {
      const rlsResult = await checkRlsWrite(
        ctx.securityCtx, value, rlsRule as any, 'insert', config.resolver,
      )
      if (!rlsResult.allowed) {
        config.onDenied?.({
          table: table as any,
          reason: rlsResult.reason,
          operation: 'insert',
        })
        throw new Error(`RLS denied insert on ${table}: ${rlsResult.reason}`)
      }

      let wrapped = schema
        ? await applyFlsWriteRuntime(value as any, schema, ctx.securityCtx, config.resolver, {
            defaultWritePolicy: config.defaultWritePolicy,
            fieldRules: config.fieldRules?.[table],
          } as any)
        : value

      if (hasSensitiveFields) {
        wrapped = { ...wrapped, [RETENTION_FIELD]: calculateExpiresAt() }
      }

      return wrapped as any
    },

    // --- Patch: two-phase RLS + FLS write ---
    patch: async (ctx, doc, value) => {
      // Phase 1: can they modify the existing doc?
      const oldRlsResult = await checkRlsWrite(
        ctx.securityCtx, doc, rlsRule as any, 'modify', config.resolver,
      )
      if (!oldRlsResult.allowed) {
        config.onDenied?.({
          table: table as any,
          reason: oldRlsResult.reason,
          operation: 'modify',
        })
        throw new Error(`RLS denied modify on ${table}: ${oldRlsResult.reason}`)
      }

      // Phase 2: would the result still be allowed?
      const newDoc = { ...doc, ...value }
      const newRlsResult = await checkRlsWrite(
        ctx.securityCtx, newDoc, rlsRule as any, 'modify', config.resolver,
      )
      if (!newRlsResult.allowed) {
        config.onDenied?.({
          table: table as any,
          reason: newRlsResult.reason,
          operation: 'modify',
        })
        throw new Error(`RLS denied modify result on ${table}: ${newRlsResult.reason}`)
      }

      // FLS write validation
      if (schema) {
        return await applyFlsWriteRuntime(
          value as any, schema, ctx.securityCtx, config.resolver, {
            defaultWritePolicy: config.defaultWritePolicy,
            fieldRules: config.fieldRules?.[table],
          } as any,
        ) as any
      }

      return value
    },

    // --- Delete: RLS gate ---
    delete: async (ctx, doc) => {
      const rlsResult = await checkRlsWrite(
        ctx.securityCtx, doc, rlsRule as any, 'delete', config.resolver,
      )
      if (!rlsResult.allowed) {
        config.onDenied?.({
          table: table as any,
          reason: rlsResult.reason,
          operation: 'delete',
        })
        throw new Error(`RLS denied delete on ${table}: ${rlsResult.reason}`)
      }
    },
  }
}
```

## Changed file: `convex/hotpot/queries.ts`

### Before (current)

```ts
import { createSecurityReader, type SecurityReader } from './security'

export type HotpotQueryCtx = {
  db: SecurityReader<DataModel, HotpotDocTypes>
  securityCtx: HotpotSecurityContext
}

export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra?) => {
    const securityCtx = await resolveContext(ctx)
    const db = createSecurityReader<...>(ctx.db, securityCtx, securityConfig)
    // ...
    return {
      ctx: { db, securityCtx } as HotpotQueryCtx,
      args: {},
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  },
})
```

### After

```ts
import type { CodecDatabaseReader } from 'zodvex/server'
import { buildCodecRules } from './security/withRulesAdapter'
import { produceReadAuditLog } from './security/audit'

export type HotpotQueryCtx = {
  db: CodecDatabaseReader<DataModel, HotpotDocTypes>
  securityCtx: HotpotSecurityContext
}

export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra?: { required?: HotpotEntitlement[] }) => {
    const securityCtx = await resolveContext(ctx)
    const rulesCtx = { securityCtx, securityConfig }

    const db = ctx.db
      .withRules(rulesCtx, buildCodecRules(securityConfig))
      .audit({
        afterRead: (table, doc) => {
          // Read audit is handled by onSuccess below
        },
      })

    if (extra?.required && extra.required.length > 0) {
      assertEntitlements(securityCtx, extra.required)
    }

    return {
      ctx: { db, securityCtx } as HotpotQueryCtx,
      args: {},
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  },
})
```

**Key change:** `ctx.db` type becomes `CodecDatabaseReader<DataModel, HotpotDocTypes>` — handlers get back the full `CodecQueryChain` with typed intermediate methods instead of the `SecureQueryChain` type with `any` everywhere.

## Changed file: `convex/hotpot/mutations.ts`

### Before (current)

```ts
import { createSecurityWriter, type SecurityWriter } from './security'

export type HotpotMutationCtx = {
  db: SecurityWriter<DataModel, HotpotDocTypes>
  securityCtx: HotpotSecurityContext
}

export const hotpotMutation = zm.withContext({
  args: {},
  input: async (ctx, _args, extra?) => {
    const securityCtx = await resolveContext(ctx)
    const db = createSecurityWriter<...>(ctx.db, securityCtx, securityConfig)
    // ...
    return {
      ctx: { db, securityCtx } as HotpotMutationCtx,
      args: {},
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  },
})
```

### After

```ts
import type { CodecDatabaseWriter } from 'zodvex/server'
import { buildCodecRules } from './security/withRulesAdapter'
import { isHotpotSecurityContext } from './security/db'
import { produceWriteAuditLog, produceReadAuditLog } from './security/audit'

export type HotpotMutationCtx = {
  db: CodecDatabaseWriter<DataModel, HotpotDocTypes>
  securityCtx: HotpotSecurityContext
}

export const hotpotMutation = zm.withContext({
  args: {},
  input: async (ctx, _args, extra?: { required?: HotpotEntitlement[] }) => {
    const securityCtx = await resolveContext(ctx)
    const rulesCtx = { securityCtx, securityConfig }

    const db = ctx.db
      .withRules(rulesCtx, buildCodecRules(securityConfig))
      .audit({
        afterWrite: (table, event) => {
          if (isHotpotSecurityContext(securityCtx)) {
            const fields = 'value' in event ? Object.keys(event.value) : []
            const crud = event.type === 'insert' ? 'CREATE'
              : event.type === 'delete' ? 'DELETE'
              : 'UPDATE'
            produceWriteAuditLog(securityCtx, crud, table, event.id, fields)
          }
        },
      })

    if (extra?.required && extra.required.length > 0) {
      assertEntitlements(securityCtx, extra.required)
    }

    return {
      ctx: { db, securityCtx } as HotpotMutationCtx,
      args: {},
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  },
})
```

**Key change:** Write audit moves from being scattered across `createSecurityWriter`'s insert/patch/delete methods into a single `.audit({ afterWrite })` callback. The `onSuccess: produceReadAuditLog` stays — it audits what the *client* sees in the response.

## Handler impact

**Zero changes to handler code.** Handlers already use:

```ts
handler: async ({ db, securityCtx }, { patientId }) => {
  return await db.get('patients', patientId)
}
```

The only difference is the `db` type goes from `SecurityReader<DataModel, HotpotDocTypes>` (custom type) to `CodecDatabaseReader<DataModel, HotpotDocTypes>` (zodvex type). The API surface is identical — `.get()`, `.query()`, `.insert()`, `.patch()`, `.delete()` all work the same way.

The **type improvement** is that `db.query('patients').withIndex(...)` now has full index type inference instead of `any`. Handlers that use `.withIndex()` or `.filter()` will get better autocomplete and type checking.

## What the rules ctx looks like

```ts
type HotpotRulesCtx = {
  securityCtx: HotpotSecurityContext  // scope, entitlements, tempAudit
  securityConfig: SecureDbConfig<...> // resolver, schemas, fieldRules, etc.
}
```

The `securityConfig` is bundled into the ctx so rules can access the resolver, FLS policies, etc. This is the "Ctx" generic in zodvex's `TableRules<Ctx, Doc>`. Each rule function receives this as its first arg.

## Write-side audit semantics

With `db.withRules(rules).audit(config)`:

- **afterRead** sees post-rule docs (rules filter/transform first, then audit observes)
- **afterWrite** sees the value as passed to the audit layer (before rules transform it)

For hotpot, this means `afterWrite`'s `event.value` is the value the handler passed to `insert`/`patch` — before the insert rule adds `RETENTION_FIELD` or FLS transforms it. The field list from `Object.keys(event.value)` reflects what the handler wrote, which is correct for audit purposes.

If you need the post-rule value in audit (e.g., to see the retention field), swap the order: `db.audit(config).withRules(rules)`.

## Migration checklist

1. `bun add zodvex@0.6.0-beta.30` in hotpot
2. Create `convex/hotpot/security/withRulesAdapter.ts` (the `buildCodecRules` function)
3. Update `convex/hotpot/queries.ts` — replace `createSecurityReader` with `.withRules().audit()`
4. Update `convex/hotpot/mutations.ts` — replace `createSecurityWriter` with `.withRules().audit()`
5. Update `HotpotQueryCtx.db` type from `SecurityReader` to `CodecDatabaseReader`
6. Update `HotpotMutationCtx.db` type from `SecurityWriter` to `CodecDatabaseWriter`
7. Run `npx convex typecheck` — fix any type errors in handlers (likely zero)
8. Run existing tests — verify security behavior is identical
9. Delete from `convex/hotpot/security/db.ts`:
   - `SecureQueryChainImpl` (~170 lines)
   - `SecureQueryChain` type (~30 lines)
   - `SecurityReader` / `SecurityWriter` types (~40 lines)
   - `createSecurityReader` / `createSecurityWriter` (~200 lines)
   - `secureSingleDoc` helper (~35 lines)
10. Keep `SecureDbConfig`, `DeniedInfo`, `isHotpotSecurityContext` (used by adapter + audit)
