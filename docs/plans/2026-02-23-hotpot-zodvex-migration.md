# Hotpot → zodvex Consumer Layer Migration Plan

> Consolidated migration guide covering server-side builders, DB codec wrapping, React hooks, vanilla client, model definitions, and security layering.

**Date:** 2026-02-23
**Status:** Plan — not yet started
**Depends on:** zodvex `feat/codec-end-to-end` branch (current)

---

## 1. What Hotpot Currently Does

### 1a. Server-side: Function Builders

Hotpot imports standalone zodvex builders and creates its own custom builders.

**Files involved:**
- `convex/hotpot/queries.ts` — `zCustomQueryBuilder`, `zQueryBuilder` from `zodvex`
- `convex/hotpot/mutations.ts` — `zCustomMutationBuilder`, `zMutationBuilder` from `zodvex`
- `convex/hotpot/actions.ts` — `zActionBuilder`, `zCustomActionBuilder` from `zodvex`

**Pattern:**

```typescript
// convex/hotpot/queries.ts (current)
import { zCustomQueryBuilder, zQueryBuilder } from 'zodvex'
import { query } from '@/convex/_generated/server'

export const zq = zQueryBuilder(query)

export const hotpotQuery = zCustomQueryBuilder(query, {
  input: async (ctx) => {
    const securityCtx = await resolveContext(ctx)
    const db = createSecureReader(ctx.db, securityCtx, config)
    return {
      ctx: { db, securityCtx },
      transforms: {
        output: (result: unknown) => {
          produceReadAuditLog(securityCtx, result)
          return result
        },
      },
    }
  }
})
```

`hotpotQuery` wraps raw `ctx.db` with `createSecureReader`, which handles the full pipeline: fetch → RLS → FLS (on wire format) → `schema.parse()` (codec decode). Security and codec decode are interleaved in a single wrapper.

### 1b. Server-side: DB Security Wrappers

**Files involved:**
- `convex/hotpot/security/` — `createSecureReader`, `createSecureWriter`
- `convex/hotpot/security/fls.ts` — `applyFls` (read), `applyFlsWrite` (write)
- `convex/hotpot/security/rls.ts` — `checkRlsRead`, `checkRlsWrite`
- `convex/hotpot/security/audit/logger.ts` — handles both `SensitiveField` and `SensitiveWire` formats

The `createSecureReader` takes raw `ctx.db` and returns a wrapper that:
1. Calls `ctx.db.get(id)` — gets raw wire document
2. Runs RLS check — checks clinicId, ownerId, role on plain fields
3. Runs `applyFls` — creates `SensitiveWire` objects `{ value, status, __sensitiveField }` from wire data
4. Runs `schema.parse()` — converts `SensitiveWire` to `SensitiveField` instances (the Zod codec)

FLS currently operates on SensitiveWire objects (wire format), straddling the wire/runtime boundary. The audit logger handles both `SensitiveField` and `SensitiveWire` via `isSensitiveFieldInstance()` and `isSensitiveWireObject()`.

### 1c. Server-side: Model Definitions

**Files involved:**
- `convex/models/patients.ts`, `convex/models/visits.ts`, `convex/models/journal.ts`, `convex/models/scope.ts`

Models use `zodTable` from zodvex plus `defineHotpotModel` which adds security rules:

```typescript
import { zodTable } from 'zodvex'
import { sensitive } from '@/convex/hotpot/security/sensitive'

const PatientsTable = zodTable('patients', {
  clinicId: z.string(),
  email: sensitive(z.string().email()).optional(),
  firstName: sensitive(z.string()),
  createdAt: zx.date(),
})

export const Patients = defineHotpotModel(PatientsTable, {
  rules: { rls: { ... }, fls: { ... } }
})
```

`defineHotpotModel` builds schemas from scratch — a parallel Zod object harness that duplicates zodvex's schema logic.

### 1d. Server-side: SensitiveField Codec

**Files involved:**
- `convex/hotpot/security/sensitive.ts` — `sensitive()` codec using `zodvexCodec`
- `convex/hotpot/security/sensitiveField.ts` — `SensitiveField` class

The `sensitive()` function creates a Zod codec via `zodvexCodec` that converts between `SensitiveWire` (stored in DB: `{ value, status, __sensitiveField, reason? }`) and `SensitiveField` (runtime class with `.expose()`, `.isHidden()`, etc.).

### 1e. Client-side: React Hooks

Hotpot currently uses Convex's standard `useQuery`/`useMutation` hooks. There are no hotpot-specific React hook wrappers today — the client receives wire-format data and any SensitiveField decode happens ad hoc or not at all.

### 1f. Client-side: Vanilla Client

Hotpot wraps `ConvexClient` from `convex/browser`. The wrapper adds auth token management. There is no automatic codec transform — wire data passes through to consumers.

### 1g. Server-side: `transforms.output` for Audit Logging

The `transforms.output` callback is used to fire the audit logger after the handler returns but before the result is encoded for the client. This is the only use of zodvex's `transforms` system in hotpot.

---

## 2. What zodvex Now Provides

### 2a. `initZodvex` with Codec DB Wrapping

**File:** `src/init.ts`

One-time setup that returns pre-bound builders with automatic `ctx.db` wrapping:

```typescript
const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server, {
  wrapDb: true,  // default
  registry: () => zodvexRegistry,  // optional: action auto-codec
})
```

Each builder is callable + has `.withContext()` for composing user customizations on top of the codec layer. When `wrapDb: true`, queries get `CodecDatabaseReader` and mutations get `CodecDatabaseWriter` on `ctx.db`.

### 2b. `.withContext()` Composition

**File:** `src/init.ts` (`composeCodecAndUser`)

Composes codec customization + user customization into a single Customization object. Codec runs first (wraps `ctx.db`), user customization sees the codec-wrapped ctx:

```typescript
const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra) => {
    // ctx.db is already CodecDatabaseReader — reads return decoded docs
    const securityCtx = await resolveContext(ctx)
    const db = createSecurityWrapper(ctx.db, securityCtx, config)
    return {
      ctx: { db, securityCtx },
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  }
})
```

### 2c. `createZodvexHooks` (React)

**File:** `src/react/hooks.ts`

Factory that takes a registry and returns `{ useZodQuery, useZodMutation }`. Drop-in replacements for Convex's hooks with automatic codec decode/encode via the registry.

```typescript
export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)
```

### 2d. `ZodvexClient` (Vanilla JS)

**File:** `src/client/zodvexClient.ts`

Wraps `ConvexClient` with automatic codec transforms via registry:
- `.query(ref, args)` — encode args, decode result
- `.mutate(ref, args)` — encode args, decode result
- `.subscribe(ref, args, callback)` — encode args, decode in callback

### 2e. `createZodvexActionCtx` (Server Actions)

**File:** `src/actionCtx.ts`

Wraps action context's `runQuery`/`runMutation` with automatic codec via registry. Integrated into `initZodvex` via the `registry` option.

### 2f. Codegen CLI

**File:** `src/cli/`

`zodvex generate` produces:
- `convex/_zodvex/schema.ts` — model re-exports
- `convex/_zodvex/api.ts` — `zodvexRegistry` mapping function paths to Zod schemas
- `convex/_zodvex/client.ts` — pre-bound hooks + client factory

### 2g. `defineZodModel` (Client-Safe Models)

**File:** `src/model.ts` (designed, not yet implemented)

Client-safe model definitions with type-safe index validation. Replaces the need for `defineHotpotModel` to build schemas from scratch — hotpot would wrap `defineZodModel` to add security rules only.

### 2h. `CodecDatabaseReader` / `CodecDatabaseWriter`

**File:** `src/db.ts`

Explicit wrapper classes that preserve the full Convex query API (`.first()`, `.unique()`, `.collect()`, `.take()`, `.paginate()`, async iteration). Tables not in the ZodTableMap pass through without decoding. The `CodecQueryChain` handles all intermediate + terminal query methods.

---

## 3. The Layering

The target architecture has clean separation of concerns:

```
DB (SensitiveWire) ←→ zodvex codec ←→ SensitiveField ←→ hotpot security ←→ handler
                                                          ├─ FLS (applyDecision)
                                                          ├─ RLS (plain field access)
                                                          ├─ Audit logging
                                                          └─ Entitlement checks
```

**Server read path:**
```
raw ctx.db → CodecDatabaseReader (decode: wire → runtime)
           → SecurityWrapper (RLS → FLS via applyDecision)
           → handler sees SensitiveField instances
```

**Server write path:**
```
handler passes runtime doc → SecurityWrapper (RLS + FLS write check)
                           → CodecDatabaseWriter (encode: runtime → wire)
                           → raw ctx.db
```

**Client path:**
```
useZodQuery → Convex useQuery (wire) → registry decode → SensitiveField instances
```

zodvex owns codec. hotpot owns security. SensitiveField is the universal runtime type.

---

## 4. Step-by-Step Migration Path

### Phase 1: Prerequisite — `transforms.output` → `onSuccess`

**Scope:** Minimal. Swap `transforms.output` for `onSuccess` in 2 files.
**Design doc:** `docs/plans/2026-02-18-hotpot-hooks-migration.md`
**Can be done independently of all other phases.**

**Files to change:**
| File | Change |
|------|--------|
| `convex/hotpot/queries.ts` | Replace `transforms: { output: fn }` with `onSuccess: ({ result }) => fn(result)` |
| `convex/hotpot/mutations.ts` | Same pattern |

**Why this works:** The audit logger (`logger.ts`) already supports both `SensitiveField` and `SensitiveWire`. Moving from `transforms.output` (pre-validation) to `onSuccess` (post-validation) changes the data format the logger sees, but both are handled. Hotpot queries/mutations always specify `returns`, so the edge case of unvalidated data doesn't apply.

**Behavioral difference:** `produceReadAuditLog` receives `SensitiveWire` objects before (pre-validation), `SensitiveField` after (post-validation). Logger handles both.

### Phase 2: Builder Migration — Adopt `initZodvex`

**Scope:** Replace standalone builders with `initZodvex`. No security changes.
**Design doc:** `docs/plans/2026-02-18-hotpot-initZodvex-adoption.md` (Section 5d + 5e)
**Depends on:** Phase 1 complete.

**Step 2a: Create zodvex composition root**

New file: `convex/zodvex.ts`

```typescript
import { initZodvex } from 'zodvex/server'
import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'

// Build ZodTableMap from existing hotpot models
import { Patients } from './models/patients'
import { Visits } from './models/visits'
import { Journal } from './models/journal'

const zodTableMap = Object.fromEntries(
  Object.entries({ patients: Patients, visits: Visits, journal: Journal })
    .map(([name, model]) => [name, { doc: model.schema.doc, insert: model.schema.insert }])
)

export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  { query, mutation, action, internalQuery, internalMutation, internalAction },
  { wrapDb: false }  // Phase 2 uses wrapDb: false to avoid double decode
)
```

**Important:** Phase 2 uses `wrapDb: false` because `createSecureReader` still does its own `schema.parse()`. Enabling `wrapDb: true` before removing `schema.parse()` from SecureReader would cause double decode.

**Step 2b: Replace builder imports in queries/mutations/actions**

| File | Before | After |
|------|--------|-------|
| `convex/hotpot/queries.ts` | `import { zCustomQueryBuilder, zQueryBuilder } from 'zodvex'` | `import { zq } from '../zodvex'` |
| `convex/hotpot/mutations.ts` | `import { zCustomMutationBuilder, zMutationBuilder } from 'zodvex'` | `import { zm } from '../zodvex'` |
| `convex/hotpot/actions.ts` | `import { zActionBuilder, zCustomActionBuilder } from 'zodvex'` | `import { za } from '../zodvex'` |

**Step 2c: Replace `zCustomQueryBuilder(query, {...})` with `zq.withContext({...})`**

```typescript
// Before
export const hotpotQuery = zCustomQueryBuilder(query, {
  input: async (ctx) => { ... }
})

// After
export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra) => { ... }
})
```

Same for mutations and actions.

**Step 2d: Replace standalone builders**

```typescript
// Before
export const zq = zQueryBuilder(query)

// After — already provided by initZodvex
// Re-export from zodvex.ts if needed by non-hotpot modules
```

Modules like `convex/visits/index.ts` and `convex/patients/index.ts` that use `zq`/`zm` directly (without security context) can import from `../zodvex` instead.

### Phase 3: `SensitiveField.applyDecision()` Addition

**Scope:** Add the `applyDecision` method to `SensitiveField` class. Pure addition, backward compatible.
**Design doc:** `docs/plans/2026-02-18-hotpot-initZodvex-adoption.md` (Section 3)

**File:** `convex/hotpot/security/sensitiveField.ts`

Add:

```typescript
applyDecision(decision: ReadDecision, fieldPath: string): SensitiveField<T> {
  // INVARIANT: hidden data cannot be restored
  if (this.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, this.reason ?? decision.reason)
  }
  if (decision.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, decision.reason)
  }
  return SensitiveField.full(this.expose(), fieldPath, decision.reason)
}
```

Also add optional `reason` parameter to `SensitiveField.full()`:

```typescript
// Current
static full<T>(value: T, field?: string): SensitiveField<T>
// New
static full<T>(value: T, field?: string, reason?: ReasonCode): SensitiveField<T>
```

Both changes are backward compatible. No other files change.

### Phase 4: FLS Runtime Migration

**Scope:** Migrate FLS from wire-format operations to runtime-type operations.
**Design doc:** `docs/plans/2026-02-18-hotpot-initZodvex-adoption.md` (Section 5b)
**Depends on:** Phase 3 complete.

**Step 4a: `applyFls` → `applyFlsRuntime` (read path)**

```typescript
// Before: manipulates SensitiveWire objects on a wire doc
for (const { path } of sensitiveFields) {
  const fieldValue = getValueAtPath(doc, path) as SensitiveWire<unknown>
  const decision = await resolveReadPolicy(...)
  const newWire: SensitiveWire = {
    value: decision.status === 'full' ? fieldValue.value : null,
    status: decision.status,
    __sensitiveField: fieldPath,
  }
  setValueAtPath(doc, path, newWire)
}

// After: calls applyDecision on SensitiveField instances
for (const { path } of sensitiveFields) {
  const field = getValueAtPath(doc, path) as SensitiveField<unknown>
  const decision = await resolveReadPolicy(...)
  setValueAtPath(doc, path, field.applyDecision(decision, fieldPath))
}
```

**Step 4b: `applyFlsWrite` → `applyFlsWriteRuntime` (write path)**

```typescript
// Before: normalizes to SensitiveField, checks policy, converts toWire()
const field = normalizeToSensitiveField(fieldValue)
if (field.status === 'hidden') { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
setValueAtPath(obj, path, field.toWire())

// After: already SensitiveField, checks policy, passes through
const field = getValueAtPath(doc, path) as SensitiveField<unknown>
if (field.isHidden()) { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
// No toWire() — zodvex's encodeDoc() handles SensitiveField → SensitiveWire
```

### Phase 5: SecurityWrapper + `wrapDb: true`

**Scope:** Atomic switchover. Replace `createSecureReader`/`createSecureWriter` with `createSecurityWrapper` that accepts codec-wrapped db. Enable `wrapDb: true`.
**Design doc:** `docs/plans/2026-02-18-hotpot-initZodvex-adoption.md` (Section 5c)
**Depends on:** Phase 4 complete.

**Step 5a: Refactor SecureReader → SecurityWrapper**

```typescript
// Before
export function createSecureReader(db: GenericDatabaseReader, ctx, config) {
  return {
    async get(table, id) {
      const doc = await db.get(id)                    // raw wire doc
      const rlsOk = await checkRlsRead(...)
      const flsDoc = await applyFls(doc, schema, ...) // wire → SensitiveWire
      return schema.parse(flsDoc)                     // SensitiveWire → SensitiveField
    }
  }
}

// After
export function createSecurityWrapper(db, ctx, config) {
  return {
    async get(table, id) {
      const doc = await db.get(id)                              // decoded runtime doc (SensitiveField)
      if (!doc) return null
      const rlsOk = await checkRlsRead(ctx, doc, ...)
      if (!rlsOk) return null
      return applyFlsRuntime(doc, schema, ctx, resolver, ...)   // SensitiveField → SensitiveField
    }
  }
}
```

**Step 5b: Enable `wrapDb: true` in composition root**

```typescript
// convex/zodvex.ts — change:
export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  server,
  { wrapDb: true }  // NOW safe — SecureReader no longer calls schema.parse()
)
```

**Step 5c: Update hotpotQuery to use codec-wrapped ctx.db**

```typescript
export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra) => {
    const securityCtx = await resolveContext(ctx)
    // ctx.db is already CodecDatabaseReader — reads return SensitiveField instances
    const db = createSecurityWrapper(ctx.db, securityCtx, config)
    if (extra?.required) assertEntitlements(securityCtx, extra.required)
    return {
      ctx: { db, securityCtx },
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  }
})
```

### Phase 6: Cleanup

**Scope:** Remove dead code after successful migration.

**Deletions from hotpot:**
- `schema.parse()` calls in old SecureReader/Writer (~4 call sites)
- Old `applyFls` / `applyFlsWrite` (wire-side versions, replaced by runtime versions)
- `normalizeToSensitiveField()` — everything is already SensitiveField
- SensitiveWire object construction in read FLS
- `field.toWire()` calls in write FLS
- `isSensitiveWireObject()` checks in audit logger
- Old `zCustomQueryBuilder` / `zCustomMutationBuilder` imports
- `transforms.output` usage (removed in Phase 1)
- Old standalone builder imports (`zQueryBuilder`, `zMutationBuilder`, `zActionBuilder`)

**Tests to update:**
- Security tests: update to use runtime types throughout
- Audit logger tests: remove `SensitiveWire` format handling assertions
- Integration tests: verify identical security behavior

### Phase 7: React Hooks Integration

**Scope:** Wrap zodvex's `useZodQuery`/`useZodMutation` with hotpot-specific behavior.
**Depends on:** Codegen producing `_zodvex/client.ts`.

**Step 7a: Run codegen**

```bash
bunx zodvex init        # one-time setup
bunx zodvex generate    # generates _zodvex/schema.ts, api.ts, client.ts
```

**Step 7b: Create hotpot React hooks**

If hotpot needs to add security-aware behavior on top of zodvex hooks (e.g., `useSensitiveQuery` that auto-resolves field access), wrap `useZodQuery`:

```typescript
// convex/hotpot/react/hooks.ts (new)
import { useZodQuery, useZodMutation } from '../_zodvex/client'
import type { FunctionReference } from 'convex/server'

export function useSensitiveQuery<Q extends FunctionReference<'query', any>>(
  ref: Q,
  ...args: any[]
) {
  // useZodQuery already decodes SensitiveWire → SensitiveField via codec
  return useZodQuery(ref, ...args)
}
```

For most cases, `useZodQuery` from `_zodvex/client` works directly — the `sensitive()` codec already produces `SensitiveField` instances. hotpot only needs a wrapper if it wants to add client-side security transforms (e.g., field masking) or logging.

**Step 7c: Migrate existing React components**

```typescript
// Before
import { useQuery } from 'convex/react'
const patient = useQuery(api.patients.get, { patientId })
// patient.email is SensitiveWire: { value: '...', status: 'full' }

// After
import { useZodQuery } from '../_zodvex/client'
const patient = useZodQuery(api.patients.get, { patientId })
// patient.email is SensitiveField: .expose(), .isHidden(), etc.
```

### Phase 8: Vanilla Client Integration

**Scope:** Wrap `ZodvexClient` instead of raw `ConvexClient`.
**Depends on:** Codegen producing `_zodvex/client.ts`.

```typescript
// Before
import { ConvexClient } from 'convex/browser'
const client = new ConvexClient(url)

// After
import { createClient } from '../_zodvex/client'
const client = createClient({ url, token })
// client.query() auto-decodes, client.mutate() auto-encodes
```

If hotpot wraps `ConvexClient` with a `HotpotClient` class for auth management, it should wrap `ZodvexClient` instead:

```typescript
// convex/hotpot/client.ts (updated)
import { ZodvexClient } from 'zodvex/client'

export class HotpotClient {
  private inner: ZodvexClient

  constructor(registry: any, options: { url: string }) {
    this.inner = new ZodvexClient(registry, options)
  }

  // Codec transforms (Date, SensitiveField) happen at zodvex layer
  // Auth/security transforms happen at hotpot layer
  async query(ref: any, args: any) {
    return this.inner.query(ref, args)
  }
}
```

### Phase 9: Model Migration (Future)

**Scope:** Adopt `defineZodModel` from `zodvex/core` instead of `zodTable` + `defineHotpotModel`.
**Depends on:** `defineZodModel` being implemented in zodvex (designed but not yet built).

```typescript
// Before
import { zodTable } from 'zodvex'
const PatientsTable = zodTable('patients', { ... })
export const Patients = defineHotpotModel(PatientsTable, { rules: { ... } })

// After
import { defineZodModel } from 'zodvex/core'
const patients = defineZodModel('patients', { ... })
  .index('byClinic', ['clinicId'])
  .index('byEmailValue', ['email.value'])

export const Patients = defineHotpotModel(patients, { rules: { ... } })
```

Benefits:
- Client-safe model definitions (no `convex/server` import)
- Type-safe index validation via `FieldPaths<z.input<T>>`
- `defineHotpotModel` shrinks to "attach rules to a zodvex model"
- `createSecurityConfig` unchanged — still reads `model.schema.doc/insert` + `model.rules`

**Open question:** This phase is optional. The ZodTableMap derivation in Phase 2 works without touching model definitions. Recommend deferring to a separate effort.

### Phase 10: Registry + Action Auto-Codec (Future)

**Scope:** Enable `initZodvex` registry option for action auto-codec.
**Depends on:** Codegen producing `_zodvex/api.ts`.

```typescript
// convex/zodvex.ts (updated)
import { zodvexRegistry } from './_zodvex/api'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  server,
  { wrapDb: true, registry: () => zodvexRegistry }
)
```

With registry enabled, `za`/`zia` action builders automatically wrap `ctx.runQuery`/`ctx.runMutation` with codec transforms — encode args, decode results.

---

## 5. Files That Change in Each Phase

### Phase 1 (transforms → onSuccess)
| File | Change |
|------|--------|
| `convex/hotpot/queries.ts` | `transforms.output` → `onSuccess` |
| `convex/hotpot/mutations.ts` | Same |

### Phase 2 (adopt initZodvex)
| File | Change |
|------|--------|
| `convex/zodvex.ts` | **New** — composition root |
| `convex/hotpot/queries.ts` | Replace imports, use `zq.withContext()` |
| `convex/hotpot/mutations.ts` | Replace imports, use `zm.withContext()` |
| `convex/hotpot/actions.ts` | Replace imports, use `za.withContext()` |
| `convex/visits/index.ts` | Import `zq`/`zm` from `../zodvex` |
| `convex/visits/journal.ts` | Import from `../zodvex` |
| `convex/patients/index.ts` | Import from `../zodvex` |

### Phase 3 (applyDecision)
| File | Change |
|------|--------|
| `convex/hotpot/security/sensitiveField.ts` | Add `applyDecision()` method, add `reason` to `.full()` |

### Phase 4 (FLS runtime migration)
| File | Change |
|------|--------|
| `convex/hotpot/security/fls.ts` | New `applyFlsRuntime` / `applyFlsWriteRuntime` |

### Phase 5 (SecurityWrapper + wrapDb: true)
| File | Change |
|------|--------|
| Security wrappers | `createSecureReader` → `createSecurityWrapper` |
| `convex/zodvex.ts` | `wrapDb: false` → `wrapDb: true` |
| `convex/hotpot/queries.ts` | Update to use codec-wrapped ctx.db |
| `convex/hotpot/mutations.ts` | Same |

### Phase 6 (cleanup)
| File | Change |
|------|--------|
| Security wrappers | Delete old wire-format FLS code |
| `convex/hotpot/security/audit/logger.ts` | Remove `isSensitiveWireObject()` checks |
| Various test files | Update assertions |

### Phase 7 (React hooks)
| File | Change |
|------|--------|
| `convex/_zodvex/*` | **Generated** by codegen |
| React components | `useQuery` → `useZodQuery` |

### Phase 8 (vanilla client)
| File | Change |
|------|--------|
| `convex/hotpot/client.ts` | Wrap `ZodvexClient` instead of `ConvexClient` |

---

## 6. Sequencing and Dependencies

```
Phase 1  ──────────────────────────────┐
(transforms → onSuccess)               │
                                        ↓
Phase 2  ──────────────────────────────┐
(adopt initZodvex, wrapDb: false)      │
                                        ↓
Phase 3  ──────────────────────────────┐
(applyDecision addition)               │
                                        ↓
Phase 4  ──────────────────────────────┐
(FLS runtime migration)                │
                                        ↓
Phase 5  ──────────────────────────────┐
(SecurityWrapper + wrapDb: true)       │
                                        ↓
Phase 6  ──────────────────────────────┘
(cleanup)

Phase 7  (React hooks) ───── independent, needs codegen only
Phase 8  (vanilla client) ── independent, needs codegen only
Phase 9  (defineZodModel) ── independent, needs zodvex feature
Phase 10 (action registry) ─ independent, needs codegen only
```

Phases 1-6 are sequential — each depends on the previous. Phases 7-10 are independent of each other and can proceed whenever their zodvex dependencies are available.

**Recommended execution order:**
1. Phase 1 first (minimal, unblocks zodvex hooks removal)
2. Phase 2 next (builder migration, familiar pattern)
3. Phase 7 in parallel (React hooks, once codegen is running)
4. Phase 3-6 as a batch (security migration, should be one focused effort)
5. Phase 8 when needed
6. Phases 9-10 deferred

---

## 7. Risk Assessment

| Risk | Phase | Mitigation |
|------|-------|------------|
| `transforms.output` → `onSuccess` changes audit log data format | 1 | Logger already handles both formats. Verify with existing audit tests. |
| Builder migration breaks function signatures | 2 | `wrapDb: false` means no behavioral change to DB operations. Only builder construction changes. |
| `applyDecision` bug allows hidden data to be restored | 3 | Method checks `this.status` first — if already hidden, returns hidden regardless. Hard invariant. |
| FLS runtime migration breaks security | 4 | Every existing test must pass with identical assertions. `applyDecision()` enforces monotonic restriction. |
| Double decode during incremental migration | 5 | Phase 2 uses `wrapDb: false`. Phase 5 is the atomic switchover. No double decode possible. |
| Schema mismatch between zodTableMap and models | 2 | ZodTableMap derived from the same `model.schema.doc/insert` that security already uses. Single source of truth. |
| Decode cost on RLS-filtered docs | 5 | Benchmarked: ~22ms worst case (1000 docs, 900 filtered). ~0.024ms per doc, <5% of DB query time. |
| React hook migration breaks existing components | 7 | `useZodQuery` is a drop-in replacement. Gradual file-by-file migration. |

---

## 8. What Does NOT Change

| Component | Why unchanged |
|-----------|---------------|
| `sensitive()` codec | Still defines SensitiveWire ↔ SensitiveField transform. zodvex invokes it via schema.parse/z.encode |
| RLS logic (`checkRlsRead/Write`) | Checks clinicId, ownerId, role — plain fields identical in wire and runtime |
| Policy resolution (`resolveReadPolicy/WritePolicy`) | Evaluates requirements against resolver — type-agnostic |
| `hotpotResolver` | Checks entitlements, roles, self-access — no format dependency |
| Two-phase RLS for patch | Still checks old + new state. Both are now runtime docs (works identically) |
| `extra` args / `required` entitlements | Flows through `input(ctx, args, extra)` unchanged |
| `createSecurityConfig` | Factory pattern unchanged. Schemas/rules/fieldRules derived from models |
| Test infrastructure | Same test runner, patterns, fixtures |

---

## 9. Net Effect (All Phases Complete)

**Deleted from hotpot:**
- `schema.parse()` calls in SecureReader/Writer (~4 call sites)
- SensitiveWire object construction in `applyFls` read path
- `normalizeToSensitiveField()` + `field.toWire()` in `applyFlsWrite`
- `isSensitiveWireObject()` checks in audit logger
- `zCustomQueryBuilder` / `zCustomMutationBuilder` / `zQueryBuilder` / `zMutationBuilder` imports
- `transforms.output` usage
- Manual codec decode/encode at function boundaries

**Added to hotpot:**
- `SensitiveField.applyDecision()` (~10 lines, enforces monotonic restriction)
- `SensitiveField.full()` gains `reason` parameter (one-line change)
- zodvex composition root (`convex/zodvex.ts`, ~15 lines)
- `applyFlsRuntime` / `applyFlsWriteRuntime` (simpler than current versions)
- codegen output (`convex/_zodvex/`, generated, not hand-written)

**Architectural wins:**
- SensitiveField is the single runtime type — all application code operates on one representation
- SensitiveWire is confined to storage/transport — an implementation detail of the codec
- zodvex owns all codec logic (decode/encode) at the DB boundary
- hotpot owns all security logic (RLS/FLS) at the runtime level
- Audit logger simplified: only handles SensitiveField (dual-format handling eliminated)
- `.withContext()` composition "just works" — no manual builder construction
- React components get auto-decoded data (Date, SensitiveField) from hooks
- Vanilla client gets auto-codec for free by wrapping ZodvexClient

---

## 10. Open Questions

1. **`zid()` → `zx.id()` migration:** Hotpot still uses `zid()` in several model and function files. This is deprecated in zodvex. Should be cleaned up as part of Phase 2 or as a separate prep step.

2. **`defineHotpotModel` → `defineZodModel` wrapping:** Phase 9 is optional but would reduce duplication. The decision depends on whether `defineZodModel` handles all of hotpot's schema needs (union schemas, complex defaults). Recommend deferring until `defineZodModel` is implemented and tested.

3. **Client-side SensitiveField resolution:** When `useZodQuery` returns decoded data with `SensitiveField` instances, how do React components access the values? Today they access wire data directly (`patient.email.value`). After migration, they'd use `patient.email.expose()`. This is a breaking change for all components that read sensitive fields. Need a migration strategy or compatibility layer.

4. **Codegen in CI/CD:** Hotpot's deploy pipeline needs `zodvex generate` before `convex deploy`. The `zodvex init` command can set this up, but it needs verification with hotpot's specific CI configuration.

5. **Performance baseline:** Before Phase 5 (`wrapDb: true`), establish a performance baseline for query latency. The ~0.024ms per doc decode cost is theoretical — measure in hotpot's production-like workload to confirm.

6. **`customCtxWithHooks` removal:** Hotpot's `tests/customBuilders.test.ts` imports `customCtxWithHooks` from zodvex. This test file needs to be updated before zodvex removes the export. Should happen in Phase 1 or as a separate prep step.
