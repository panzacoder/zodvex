# Hotpot → zodvex Adoption Guide

> Implementation guide for migrating hotpot to zodvex's codec-aware infrastructure.
> Supersedes all prior hotpot migration docs in this directory.

**Date:** 2026-02-24
**zodvex version:** `0.6.0-beta.0` (`npm install zodvex@beta`)
**zodvex branch:** `feat/codec-end-to-end` (all zodvex work complete)
**Audience:** Agent executing the migration in the hotpot codebase

---

## Part 1: Decisions That Change Hotpot's Approach

### Decision 1: zodvex owns all codec logic at the DB boundary

Hotpot's `createSecureReader` currently does fetch → RLS → FLS(wire) → `schema.parse()`. The `schema.parse()` call is hotpot's manual codec decode step. With zodvex's `CodecDatabaseReader` wrapping `ctx.db`, documents are decoded automatically at the DB read boundary. Hotpot removes all `schema.parse()` calls from its security wrappers.

Write path: same principle. Hotpot's `applyFlsWrite` currently calls `field.toWire()` to encode SensitiveField → SensitiveWire before writing. With `CodecDatabaseWriter`, encoding happens automatically at the DB write boundary. Hotpot removes `toWire()` calls.

### Decision 2: `CodecDatabaseReader` preserves 100% Convex query chain API

zodvex's `CodecQueryChain` exposes every Convex query method: `.withIndex()`, `.order()`, `.filter()`, `.first()`, `.unique()`, `.collect()`, `.take()`, `.paginate()`, async iteration, `.count()`. Intermediate methods use wire types for Convex's index/filter machinery. Terminal methods return decoded runtime types.

SecurityWrapper must also preserve the full chain API. The old `SecureReader.query(table, buildQuery?)` callback pattern — which eagerly `.collect()`ed all docs and forced array returns — is eliminated. Instead, SecurityWrapper returns a `SecureQueryChain` that wraps `CodecQueryChain`, intercepting terminal methods to apply RLS/FLS per-doc. Handler code uses the same fluent chain syntax as raw Convex:

```typescript
const patient = await ctx.db
  .query('patients')
  .withIndex('byClinic', q => q.eq('clinicId', clinicId))
  .first()
```

### Decision 3: `SensitiveField` is the single runtime type

All application code — handlers, FLS, RLS checks, audit logging — operates on `SensitiveField` instances. `SensitiveWire` (`{ value, status, __sensitiveField }`) is confined to storage/transport — it's an implementation detail of the `sensitive()` codec that no application code ever sees.

FLS applies access decisions via `SensitiveField.applyDecision(decision, fieldPath)` — a monotonic operation that can only maintain or restrict access, never escalate. Once a field is hidden, it stays hidden regardless of any subsequent decision.

### Decision 4: `onSuccess` replaces `transforms.output`

zodvex adopts convex-helpers' `onSuccess` convention. The `transforms.input`/`transforms.output` system, `CustomizationWithHooks`, and `customCtxWithHooks` are removed. Hotpot's audit logging currently uses `transforms.output` — this changes to `onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result)`.

`onSuccess` fires after the handler returns but before Zod encode, so the audit logger sees runtime types (SensitiveField), not wire types.

### Decision 5: `initZodvex` + `.withContext()` replaces standalone builders

Instead of importing `zCustomQueryBuilder`, `zQueryBuilder`, etc. individually and wiring them to Convex's `query`/`mutation`/`action`, hotpot calls `initZodvex(schema, server, options)` once and gets pre-bound builders: `zq`, `zm`, `za`, `ziq`, `zim`, `zia`.

Each builder is callable (for simple functions) and has `.withContext(customization)` for composing user customization on top of the codec layer. Composition order: codec runs first (wraps `ctx.db`), user customization sees codec-wrapped context.

### Decision 6: `sensitive()` codec is unchanged

The `sensitive()` function and `SensitiveField` class are hotpot's code. zodvex invokes the codec transparently via `schema.parse()` (decode) and `z.encode()` (encode). No changes needed to the codec definition itself.

---

## Part 2: zodvex API Reference

### `initZodvex(schema, server, options?)`

**Import:** `zodvex/server`

One-time setup. Returns pre-bound builders with automatic codec wrapping.

```typescript
import { initZodvex } from 'zodvex/server'
import * as server from './_generated/server'

const { zq, zm, za, ziq, zim, zia } = initZodvex(
  schema,   // from defineZodSchema() — carries __zodTableMap + __decodedDocs
  server,   // { query, mutation, action, internalQuery, internalMutation, internalAction }
  {
    wrapDb?: true,                   // default true — wraps ctx.db with CodecDatabaseReader/Writer
    registry?: () => AnyRegistry,    // lazy thunk — when provided, action builders wrap runQuery/runMutation
  }
)
```

**What each builder is:**
- `zq` / `ziq` — query builders. When `wrapDb: true`, `ctx.db` is `CodecDatabaseReader`.
- `zm` / `zim` — mutation builders. When `wrapDb: true`, `ctx.db` is `CodecDatabaseWriter`.
- `za` / `zia` — action builders. When `registry` provided, `ctx.runQuery`/`ctx.runMutation` auto-encode/decode.

**Each builder is callable + has `.withContext()`:**

```typescript
// Simple function (no custom context):
const getTask = zq({
  args: { id: z.string() },
  returns: TaskModel.schema.doc.nullable(),
  handler: async (ctx, { id }) => ctx.db.get(id),
})

// Custom context (hotpot's pattern):
const hotpotQuery = zq.withContext({
  args: {},  // custom args consumed by input(), not passed to handler
  input: async (ctx, _args, extra) => {
    // ctx.db is already CodecDatabaseReader
    const securityCtx = await resolveContext(ctx)
    const db = createSecurityWrapper(ctx.db, securityCtx, config)
    if (extra?.required) assertEntitlements(securityCtx, extra.required)
    return {
      ctx: { db, securityCtx },
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  }
})
```

`.withContext()` returns a `CustomBuilder` — callable just like the base builder, but handlers receive the composed context.

**Composition order:** Codec `input` runs first (wraps `ctx.db`), then user `input` runs (sees codec-wrapped `ctx.db`). User context merges on top — if user returns `{ ctx: { db: secureDb } }`, the handler sees `secureDb` as `ctx.db`.

### `CodecDatabaseReader<DataModel, DecodedDocs>`

**Import:** `zodvex/server`

Wraps `GenericDatabaseReader`. Documents from tables in the `ZodTableMap` are decoded through their Zod schema. Tables not in the map pass through without decoding.

```typescript
reader.get(id)                  → Promise<DecodedDoc | null>
reader.get(tableName, id)       → Promise<DecodedDoc | null>
reader.query(tableName)         → CodecQueryChain<TableInfo, DecodedDoc>
reader.normalizeId(table, id)   → GenericId<Table> | null
reader.system                   → SystemReader (passthrough)
```

### `CodecDatabaseWriter<DataModel, DecodedDocs>`

**Import:** `zodvex/server`

Wraps `GenericDatabaseWriter`. Reads decode, writes encode.

```typescript
// Read methods: same as CodecDatabaseReader (delegates internally)

// Write methods (auto-encode runtime → wire):
writer.insert(tableName, value)     → Promise<Id>
writer.patch(id, value)             → Promise<void>
writer.patch(tableName, id, value)  → Promise<void>
writer.replace(id, value)           → Promise<void>
writer.replace(tableName, id, value)→ Promise<void>
writer.delete(id)                   → Promise<void>
```

**Encoding strategy:**
- `insert` / `replace`: `encodeDoc(schemas.insert, value)` — full encode + strip undefined
- `patch`: `encodePartialDoc(schemas.insert, value)` — partial encode via `.partial()` + strip undefined
- Tables without codec pass through unchanged

### `CodecQueryChain<TableInfo, Doc>`

**Import:** `zodvex/server`

Wraps Convex's query chain. Dual-generic design:
- `TableInfo` (wire types) — used by intermediate methods so `.withIndex()` and `.filter()` see Convex's native field types
- `Doc` (decoded types) — used by terminal methods so results have runtime types (Date, SensitiveField, etc.)

```typescript
// Intermediate methods (return CodecQueryChain, wire-typed):
chain.fullTableScan()
chain.withIndex(indexName, indexRange?)
chain.withSearchIndex(indexName, searchFilter)
chain.order('asc' | 'desc')
chain.filter(predicate)
chain.limit(n)
chain.count()                → Promise<number>  // passthrough, no decode

// Terminal methods (return decoded Doc type):
chain.first()                → Promise<Doc | null>
chain.unique()               → Promise<Doc | null>
chain.collect()              → Promise<Doc[]>
chain.take(n)                → Promise<Doc[]>
chain.paginate(opts)         → Promise<PaginationResult<Doc>>
chain[Symbol.asyncIterator]  → AsyncIterator<Doc>
```

### `createZodvexHooks(registry)`

**Import:** `zodvex/react`

Returns `{ useZodQuery, useZodMutation }`. Drop-in replacements for Convex's `useQuery`/`useMutation` with automatic codec decode/encode via registry.

```typescript
const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

// Usage:
const patient = useZodQuery(api.patients.get, { patientId })
// patient.email is SensitiveField (not SensitiveWire)
// patient.createdAt is Date (not number)
```

### `ZodvexClient`

**Import:** `zodvex/client`

Wraps `ConvexClient` with automatic codec transforms via registry.

```typescript
const client = new ZodvexClient(zodvexRegistry, { url })

await client.query(ref, args)       // encode args, decode result
await client.mutate(ref, args)      // encode args, decode result
client.subscribe(ref, args, cb)     // encode args, decode in callback
client.setAuth(token)               // passthrough
```

### Codegen CLI

```bash
bunx zodvex init        # one-time project setup
bunx zodvex generate    # generates _zodvex/ directory
```

**Produces:**
- `convex/_zodvex/schema.ts` — model re-exports
- `convex/_zodvex/api.ts` — `zodvexRegistry` mapping function paths to `{ args, returns }` Zod schemas
- `convex/_zodvex/client.ts` — pre-bound hooks + client factory (imports registry internally)

The registry bridges server-side schemas and client-side codec transforms. Actions consume it via `initZodvex({ registry })`, React hooks via `createZodvexHooks()`, vanilla client via `ZodvexClient`.

### Codec Primitives (escape hatches)

```typescript
import { decodeDoc, encodeDoc, encodePartialDoc } from 'zodvex/server'

decodeDoc(schema, wireDoc)              // schema.parse(wireDoc)
encodeDoc(schema, runtimeDoc)           // z.encode(schema, runtimeDoc) + stripUndefined
encodePartialDoc(schema, partialDoc)    // schema.partial() encode + stripUndefined
```

These are what `CodecDatabaseReader`/`Writer` use internally. Exposed for consumers that need manual codec control (e.g., retention cron jobs operating on raw wire docs).

---

## Part 3: Implementation Phases

### Sequencing Overview

```
P0:  Prerequisites                                      [BLOCKERS]
       P0a: delete customCtxWithHooks test
       P0b: zid() → zx.id() cleanup (optional)
       P0c: defineHotpotModel → defineZodModel delegation
      │
Phase 1: transforms → onSuccess                        [2 files, minimal]
      │
Phase 2: initZodvex, wrapDb:false                      [builder migration]
      │
Phase 3: applyDecision addition                        [can parallel with Phase 2]
      │
Phase 4: FLS runtime migration                         [depends on Phase 3]
      │
Phase 5: SecurityWrapper rewrite, wrapDb:true           [atomic switchover]
      │
Phase 6: Cleanup                                        [remove dead code]

Phase 7: React hooks + codegen    ─── independent (needs codegen only)
Phase 8: Vanilla client           ─── independent (needs codegen only)
```

Phases 1-6 are sequential. Phases 7-8 are independent and can run whenever codegen is available.

---

### Phase 0: Prerequisites

**P0a: Remove `customCtxWithHooks` test [BLOCKER]**

`hotpot/tests/customBuilders.test.ts` imports `customCtxWithHooks` from zodvex. This export is removed on the zodvex branch. Delete or rewrite this test file before anything else.

```bash
grep -r "customCtxWithHooks" convex/ src/ tests/
```

**P0b: `zid()` → `zx.id()` cleanup**

Hotpot uses deprecated `zid()` in model and function files. Not a blocker, but reduces churn in later phases. Can be batched with Phase 2.

**P0c: Migrate `defineHotpotModel` to delegate to `defineZodModel` [REQUIRED FOR PHASE 2]**

`defineHotpotModel()` currently constructs schemas manually: `z.object(fields)` → `.extend({ _id, _creationTime })` → `z.array()`. This produces `{ doc, insert, docArray }` — missing `base`, `update`, `paginatedDoc`.

`initZodvex` requires `ZodTableMap` entries to satisfy `ZodTableSchemas`, which includes all six schema variants. `defineZodModel` (from `zodvex/core`, client-safe) generates the full set automatically.

**Migration pattern:**

```typescript
import { defineZodModel } from 'zodvex/core'

// BEFORE
export function defineHotpotModel(name, fields, config) {
  const doc = z.object(fields).extend({ _id: z.string(), _creationTime: z.number() })
  const insert = z.object(fields)
  const docArray = z.array(doc)
  return { name, schema: { doc, insert, docArray }, ...config }
}

// AFTER
export function defineHotpotModel(name, fields, config) {
  // 1. Inject retention field if needed (hotpot-specific)
  const fieldsWithRetention = config?.retention
    ? { ...fields, sensitiveExpiresAt: z.number().optional() }
    : fields

  // 2. Delegate to defineZodModel for full schema set
  const model = defineZodModel(name, fieldsWithRetention)

  // 3. Layer on hotpot-specific metadata
  return {
    ...model,
    rules: config?.rules,
    fieldRules: config?.fieldRules,
    // model.schema now has: doc, base, insert, update, docArray, paginatedDoc
  }
}
```

**Note:** Only `doc` and `insert` are used by `CodecDatabaseReader`/`Writer` at runtime. The other schemas (`base`, `update`, `docArray`, `paginatedDoc`) are used by codegen registry (Phase 7) and type-level inference.

---

### Phase 1: `transforms.output` → `onSuccess`

**Scope:** 2 files, minimal. Can be done independently.
**Files:** `convex/hotpot/queries.ts`, `convex/hotpot/mutations.ts`

```typescript
// BEFORE
return {
  ctx: { db, securityCtx },
  transforms: {
    output: (result) => { produceReadAuditLog(securityCtx, result); return result },
  },
}

// AFTER
return {
  ctx: { db, securityCtx },
  onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
}
```

Also update the customization type signatures to replace `transforms?: { output? }` with `onSuccess?: (info: { result }) => void`.

**Why safe:** The audit logger already handles both `SensitiveField` and `SensitiveWire` via `isSensitiveFieldInstance()` and `isSensitiveWireObject()`. `onSuccess` fires post-handler but pre-encode, so the logger sees runtime types.

---

### Phase 2: Adopt `initZodvex` (with `wrapDb: false`)

**Scope:** Builder migration. No security or behavioral changes.
**Depends on:** Phase 1.

**Step 2a: Create zodvex composition root**

New file: `convex/zodvex.ts`

```typescript
import { initZodvex } from 'zodvex/server'
import * as server from './_generated/server'
import { models } from './models'

// After P0c, models have full ZodTableSchemas (doc, base, insert, update, docArray, paginatedDoc)
const zodTableMap = Object.fromEntries(
  Object.entries(models).map(([name, model]) => [name, model.schema])
)

export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  server,
  { wrapDb: false }  // Phase 2: SecureReader still calls schema.parse()
)
```

**Why `wrapDb: false`:** SecureReader still does its own `schema.parse()`. Enabling `wrapDb: true` before removing that would cause double decode. Phase 2 changes only builder construction — no behavioral change to DB operations.

**Note on `.withContext()`:** With `wrapDb: false`, `.withContext()` works correctly for typed customizations (zodvex 0.6.0-beta.2+ fixed a type bug where `Record<string, never>` caused `Overwrite` to strip context properties). Secure wrappers can use `.withContext()` in Phase 2, or defer to Phase 5 — either works.

**Step 2b: Replace builder imports**

| File | Before | After |
|------|--------|-------|
| `convex/hotpot/queries.ts` | `import { zCustomQueryBuilder } from 'zodvex'` | `import { zq } from '../zodvex'` |
| `convex/hotpot/mutations.ts` | `import { zCustomMutationBuilder } from 'zodvex'` | `import { zm } from '../zodvex'` |
| `convex/hotpot/actions.ts` | `import { zCustomActionBuilder } from 'zodvex'` | `import { za } from '../zodvex'` |
| `convex/visits/*.ts`, `convex/patients/*.ts` | `import { zq } from '../hotpot/queries'` | `import { zq } from '../zodvex'` |

**Step 2c: Replace `zCustomQueryBuilder` with `.withContext()`**

```typescript
// BEFORE
export const hotpotQuery = zCustomQueryBuilder(query, {
  input: async (ctx) => { ... }
})

// AFTER
export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra) => { ... }
})
```

**API difference:** `.withContext()` takes `input(ctx, args, extra)` — three params, not one. The `extra` parameter carries entitlement requirements (currently passed via `extra?.required`).

**Step 2d: Replace standalone builders**

```typescript
// BEFORE
export const zq = zQueryBuilder(query)

// AFTER — already provided by initZodvex
// Re-export from zodvex.ts if needed by non-hotpot modules
```

---

### Phase 3: `SensitiveField.applyDecision()` Addition

**Scope:** Pure addition, backward compatible. Can be done in parallel with Phase 2.
**File:** `convex/hotpot/security/sensitiveField.ts`

```typescript
applyDecision(decision: ReadDecision, fieldPath: string): SensitiveField<T> {
  // HARD INVARIANT: hidden data cannot be restored
  if (this.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, this.reason ?? decision.reason)
  }
  if (decision.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, decision.reason)
  }
  return SensitiveField.full(this.expose(), fieldPath, decision.reason)
}
```

Also extend `SensitiveField.full()` with optional `reason` parameter (backward compatible):

```typescript
static full<T>(value: T, field?: string, reason?: ReasonCode): SensitiveField<T>
```

---

### Phase 4: FLS Runtime Migration

**Scope:** Migrate FLS from wire-format operations to runtime-type operations.
**Depends on:** Phase 3.
**Files:** `convex/hotpot/security/fls.ts`, `convex/hotpot/security/pathUtils.ts`

**Step 4a: `applyFls` → `applyFlsRuntime` (read path)**

```typescript
// BEFORE: constructs SensitiveWire objects
for (const { path, fieldPath } of sensitiveFields) {
  const currentWire = getValueAtPath(doc, path) as SensitiveWire<unknown>
  const decision = await resolveReadPolicy(policyCtx, readPolicy, resolver)
  const newWire: SensitiveWire = {
    value: decision.status === 'full' ? currentWire.value : null,
    status: decision.status,
    __sensitiveField: fieldPath,
  }
  setValueAtPath(doc, path, newWire)
}

// AFTER: calls applyDecision on SensitiveField instances
for (const { path, fieldPath } of sensitiveFields) {
  const field = getValueAtPath(doc, path) as SensitiveField<unknown>
  const decision = await resolveReadPolicy(policyCtx, readPolicy, resolver)
  setValueAtPath(doc, path, field.applyDecision(decision, fieldPath))
}
```

**Step 4b: `applyFlsWrite` → `applyFlsWriteRuntime` (write path)**

```typescript
// BEFORE: normalizes input, checks policy, converts to wire
const field = normalizeToSensitiveField(fieldValue)
if (field.status === 'hidden') { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
setValueAtPath(obj, path, field.toWire())

// AFTER: input is already SensitiveField, no conversion needed
const field = getValueAtPath(doc, path) as SensitiveField<unknown>
if (field.isHidden()) { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
// Pass through — CodecDatabaseWriter handles SensitiveField → SensitiveWire
```

**Step 4c: `applyExpiredStatusRuntime` (retention expiry, read-path only)**

The retention scrubber (`scrubDocument()`) operates on raw wire docs outside the codec layer — it keeps using wire-format `applyExpiredStatus`. Only the inline expiry check in the FLS read path moves to runtime:

```typescript
function applyExpiredStatusRuntime(obj: Record<string, unknown>, path: string): void {
  const field = getValueAtPath(obj, path) as SensitiveField<unknown> | undefined
  if (!field) return
  setValueAtPath(obj, path, field.applyDecision({ status: 'hidden', reason: 'expired' }, path))
}
```

---

### Phase 5: SecurityWrapper + `wrapDb: true`

**Scope:** Atomic switchover. The biggest behavioral change.
**Depends on:** Phase 4 complete + full test coverage.

**Step 5a: Rewrite SecureReader/Writer → SecurityWrapper with chain-wrapping**

SecurityWrapper preserves the full query chain API by wrapping `CodecQueryChain`'s terminal methods:

```typescript
export function createSecurityWrapper(db, securityCtx, config) {
  return {
    async get(id) {
      const doc = await db.get(id)
      if (!doc) return null
      if (!await checkRlsRead(securityCtx, doc, ...)) return null
      return applyFlsRuntime(doc, ...)
    },

    query(tableName) {
      const chain = db.query(tableName)
      return new SecureQueryChain(chain, securityCtx, config, tableName)
    },

    normalizeId: db.normalizeId.bind(db),
    system: db.system,
  }
}
```

**`SecureQueryChain`** wraps `CodecQueryChain`, forwarding intermediate methods and intercepting terminal methods:

```typescript
class SecureQueryChain {
  constructor(
    private inner: CodecQueryChain,
    private securityCtx,
    private config,
    private tableName: string,
  ) {}

  // --- Intermediate methods: forward to inner chain ---
  withIndex(indexName, indexRange?) {
    return new SecureQueryChain(
      this.inner.withIndex(indexName, indexRange),
      this.securityCtx, this.config, this.tableName
    )
  }
  order(o) { return new SecureQueryChain(this.inner.order(o), this.securityCtx, this.config, this.tableName) }
  filter(pred) { return new SecureQueryChain(this.inner.filter(pred), this.securityCtx, this.config, this.tableName) }
  limit(n) { return new SecureQueryChain(this.inner.limit(n), this.securityCtx, this.config, this.tableName) }
  fullTableScan() { return new SecureQueryChain(this.inner.fullTableScan(), this.securityCtx, this.config, this.tableName) }
  withSearchIndex(name, filter) { return new SecureQueryChain(this.inner.withSearchIndex(name, filter), this.securityCtx, this.config, this.tableName) }

  // --- Terminal methods: apply RLS + FLS per doc ---
  async first() {
    const doc = await this.inner.first()
    if (!doc) return null
    return this.secureSingleDoc(doc)
  }

  async unique() {
    const doc = await this.inner.unique()
    if (!doc) return null
    return this.secureSingleDoc(doc)
  }

  async collect() {
    const docs = await this.inner.collect()
    return this.secureDocs(docs)
  }

  async take(n) {
    const docs = await this.inner.take(n)
    return this.secureDocs(docs)
  }

  async paginate(opts) {
    const result = await this.inner.paginate(opts)
    return {
      ...result,
      page: await this.secureDocs(result.page),
    }
  }

  count() { return this.inner.count() }

  // --- Security helpers ---
  private async secureSingleDoc(doc) {
    if (!await checkRlsRead(this.securityCtx, doc, ...)) return null
    return applyFlsRuntime(doc, ...)
  }

  private async secureDocs(docs) {
    const results = await Promise.all(
      docs.map(doc => this.secureSingleDoc(doc))
    )
    return results.filter(Boolean)
  }
}
```

**Handler code after migration — full chain API preserved:**

```typescript
const patient = await ctx.db
  .query('patients')
  .withIndex('byClinic', q => q.eq('clinicId', clinicId))
  .first()

const recentVisits = await ctx.db
  .query('visits')
  .withIndex('byPatient', q => q.eq('patientId', patientId))
  .order('desc')
  .take(10)

const page = await ctx.db
  .query('patients')
  .paginate(paginationOpts)
```

**Step 5b: Write SecurityWrapper**

The write wrapper accepts `CodecDatabaseWriter`:

- `insert(table, value)`: RLS check → FLS write check → `db.insert(table, value)` (codec encodes)
- `patch(id, value)`: fetch old doc (decoded) → RLS check old + new → FLS write check → `db.patch(id, value)` (codec encodes partial)
- `replace(id, value)`: same pattern as insert but with `db.replace()`
- `delete(id)`: RLS check → `db.delete(id)` (passthrough)

**Step 5c: Enable `wrapDb: true` in composition root**

```typescript
// convex/zodvex.ts
export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  server,
  { wrapDb: true }  // NOW safe — SecurityWrapper no longer calls schema.parse()
)
```

**IMPORTANT: Retention cron must bypass codec wrapping.** When `wrapDb: true`, ALL zodvex builders (including `zim`) codec-wrap `ctx.db`. The retention cron's `scrubDocument()` operates on raw wire docs — using a zodvex builder would double-encode. Import from `_generated/server` directly:

```typescript
// convex/retention.ts — uses raw Convex, NOT zodvex builders
import { internalMutation } from './_generated/server'

export const scrubExpired = internalMutation({
  handler: async (ctx) => {
    // ctx.db is raw — wire-format, no codec wrapping
    await scrubDocument(ctx.db, docId)
  }
})
```

**Step 5d: Update hotpotQuery to use codec-wrapped ctx.db**

```typescript
export const hotpotQuery = zq.withContext({
  args: {},
  input: async (ctx, _args, extra) => {
    const securityCtx = await resolveContext(ctx)
    // ctx.db is CodecDatabaseReader — reads return decoded docs
    const db = createSecurityWrapper(ctx.db, securityCtx, config)
    if (extra?.required) assertEntitlements(securityCtx, extra.required)
    return {
      ctx: { db, securityCtx },
      onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result),
    }
  }
})
```

---

### Phase 6: Cleanup

**Scope:** Remove dead code. No behavioral changes.

**Delete from hotpot:**
- `schema.parse()` calls in old SecureReader/Writer (~4 call sites)
- Old `applyFls` / `applyFlsWrite` (wire-side versions)
- `normalizeToSensitiveField()` function
- SensitiveWire construction in FLS read path
- `field.toWire()` calls in FLS write path
- `isSensitiveWireObject()` checks in audit logger
- Old builder imports (`zCustomQueryBuilder`, `zCustomMutationBuilder`, `zQueryBuilder`, etc.)
- `transforms.output` usage (removed in Phase 1)
- Old `SecureReader.query(table, buildQuery?)` callback pattern

**Update tests:**
- Security tests: update assertions to use `SensitiveField` throughout
- Audit logger tests: remove `SensitiveWire` format handling assertions
- Integration tests: verify identical security behavior before and after

---

### Phase 7: React Hooks + Codegen

**Scope:** Generate registry, adopt zodvex hooks.
**Independent of Phases 3-6 — needs only codegen.**

**Step 7a: Run codegen**

```bash
bunx zodvex init        # one-time setup
bunx zodvex generate    # generates convex/_zodvex/
```

**Step 7b: Replace `useQuery` with `useZodQuery`**

```typescript
// BEFORE
import { useQuery } from 'convex/react'
const patient = useQuery(api.patients.get, { patientId })
// patient.email is SensitiveWire: { value: '...', status: 'full' }

// AFTER
import { useZodQuery } from '../_zodvex/client'
const patient = useZodQuery(api.patients.get, { patientId })
// patient.email is SensitiveField: .expose(), .isHidden()
// patient.createdAt is Date (not number)
```

**Step 7c: Update component sensitive field access**

Breaking change for all components reading sensitive fields:

```typescript
// BEFORE (wire format)
const emailDisplay = patient.email?.status === 'full' ? patient.email.value : '***'

// AFTER (runtime type)
const emailDisplay = patient.email?.isHidden() ? '***' : patient.email?.expose()
```

Migrate file-by-file. `useZodQuery` is a drop-in replacement for `useQuery` — the only change is how components access sensitive field values.

**Transitional wrapper** (optional): re-implement `useSensitiveQuery` as a thin wrapper that ignores the old `schema` parameter:

```typescript
export function useSensitiveQuery(query, _schema, args) {
  return useZodQuery(query, args)  // registry provides schema
}
```

---

### Phase 8: Vanilla Client

**Scope:** Wrap `ZodvexClient` inside `HotpotBaseClient`.
**Independent — needs codegen.**

```typescript
import { ZodvexClient } from 'zodvex/client'
import { zodvexRegistry } from './_zodvex/api'

export class HotpotBaseClient {
  private _baseClient: ZodvexClient

  constructor(options: { url: string }) {
    this._baseClient = new ZodvexClient(zodvexRegistry, options)
  }

  setToken(token) { this._baseClient.setAuth(token) }

  async query(ref, args) { return this._baseClient.query(ref, args) }
  async mutate(ref, args) { return this._baseClient.mutate(ref, args) }
  subscribe(ref, args, cb) { return this._baseClient.subscribe(ref, args, cb) }

  // JWT expiration, liveQuery, domain accessors — keep as-is,
  // route internal queries through this._baseClient
}
```

---

## What Does NOT Change

| Component | Why unchanged |
|-----------|---------------|
| `sensitive()` codec | Still defines SensitiveWire <-> SensitiveField transform. zodvex invokes it via schema.parse/z.encode |
| RLS logic (`checkRlsRead/Write`) | Checks clinicId, ownerId, role — plain fields identical in wire and runtime |
| Policy resolution (`resolveReadPolicy/WritePolicy`) | Evaluates requirements against resolver — type-agnostic |
| `hotpotResolver` | Checks entitlements, roles, self-access — no format dependency |
| Two-phase RLS for patch | Still checks old + new state. Both are now runtime docs — works identically |
| `extra` args / `required` entitlements | Flows through `input(ctx, args, extra)` unchanged |
| `defineHotpotModel` | Model definitions unchanged. ZodTableMap derived from existing models |
| `createSecurityConfig` | Factory pattern unchanged. Schemas/rules/fieldRules derived from models |
| `applyExpiredStatus` (wire version) | Retention `scrubDocument()` path stays wire-format permanently |

---

## Net Effect (All Phases Complete)

**Deleted from hotpot:**
- `schema.parse()` calls in SecureReader/Writer (~4 call sites)
- SensitiveWire construction in `applyFls` read path
- `normalizeToSensitiveField()` + `field.toWire()` in `applyFlsWrite`
- `isSensitiveWireObject()` checks in audit logger
- `zCustomQueryBuilder` / `zCustomMutationBuilder` / `zQueryBuilder` / `zMutationBuilder` imports
- `transforms.output` usage
- `SecureReader.query(table, buildQuery?)` callback pattern
- Manual codec decode/encode at function boundaries

**Added to hotpot:**
- `SensitiveField.applyDecision()` (~10 lines, enforces monotonic restriction)
- `SensitiveField.full()` gains `reason` parameter (one-line change)
- zodvex composition root (`convex/zodvex.ts`, ~15 lines)
- `SecureQueryChain` class (wraps `CodecQueryChain` with RLS/FLS on terminal methods)
- `applyFlsRuntime` / `applyFlsWriteRuntime` (simpler than current versions)
- `applyExpiredStatusRuntime` (read-path only; wire version retained for retention cron)
- Codegen output (`convex/_zodvex/`, generated, not hand-written)

**Architectural wins:**
- SensitiveField is the single runtime type — all application code operates on one representation
- SensitiveWire confined to storage/transport — an implementation detail of the codec
- zodvex owns all codec logic (decode/encode) at the DB boundary
- hotpot owns all security logic (RLS/FLS) at the runtime level
- Full Convex query chain API preserved through SecurityWrapper — no more callback pattern
- Audit logger simplified: only handles SensitiveField (dual-format handling eliminated)
- `.withContext()` composition "just works" — no manual builder construction
- React components get auto-decoded data (Date, SensitiveField) from hooks
- Vanilla client gets auto-codec by wrapping ZodvexClient

---

## Open Questions

1. **Retention `scrubDocument()` path:** Assumed to operate on raw wire docs fetched outside the codec layer (via raw `ctx.db`, not through `CodecDatabaseReader`). Verify this assumption — if it uses codec-wrapped db, `applyExpiredStatusRuntime` would be needed instead.

2. **React component migration scope:** How many components access `.value` on sensitive fields? A grep for sensitive field wire access patterns will reveal the scope. Consider a dedicated migration sprint.

3. **`liveQuery()` in `HotpotBaseClient`:** Returns a lazy handle with `.subscribe()` and `.then()`. Design its interaction with `ZodvexClient.subscribe()` when Phase 8 starts.

4. **Codegen in CI/CD:** Deploy pipeline needs `zodvex generate` before `convex deploy`. Verify with hotpot's CI configuration.

5. **Performance baseline:** Establish query latency baseline before Phase 5. The ~0.024ms/doc decode cost is theoretical — measure in hotpot's workload before switching `wrapDb: true`.
