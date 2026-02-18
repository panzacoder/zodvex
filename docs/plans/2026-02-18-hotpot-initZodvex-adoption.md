# Hotpot `initZodvex` Adoption Design

> **North star:** hotpot delegates all codec responsibilities to zodvex. Security (RLS + FLS) operates on runtime types only. zodvex owns decode/encode; hotpot owns access control.

**Depends on:**
- zodvex ships `initZodvex` with `wrapDb: true` (composition layer — `docs/plans/2026-02-18-composition-layer-impl.md`)
- zodvex removes hooks/transforms (cleanup — `docs/plans/2026-02-18-hooks-transforms-removal.md`)

**Reference:** `docs/decisions/2026-02-17-runtime-only-middleware.md` — the architectural decision that makes this design possible.

---

## 1. Architecture: Before and After

### Before (current)

```
raw ctx.db → SecureReader (RLS → FLS → schema.parse()) → handler
```

hotpot owns the entire pipeline: fetch, security, AND codec decode (`schema.parse()`). zodvex provides builders (`zCustomQueryBuilder`) and `sensitive()` codec, but hotpot invokes the parse manually.

```typescript
// hotpot/queries.ts (current)
export const hotpotQuery = zCustomQueryBuilder(query, {
  input: async (ctx) => {
    const db = createSecureReader(ctx.db, securityCtx, config)
    // SecureReader does: fetch → RLS → FLS → schema.parse()
    return {
      ctx: { db, securityCtx },
      transforms: { output: (result) => { produceReadAuditLog(...); return result } }
    }
  }
})
```

### After (target)

```
raw ctx.db → CodecDatabaseReader (schema.parse()) → SecurityWrapper (RLS → FLS) → handler
```

zodvex owns decode/encode via `wrapDb: true`. hotpot's security layer wraps the codec-wrapped db, operating on runtime types (SensitiveField instances).

```typescript
// hotpot/queries.ts (target)
const { zq } = initZodvex(schema, server, { wrapDb: true })

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

---

## 2. Data Flow

### Read path

```
handler calls SecurityWrapper.get(table, id)
  │
  ├─ SecurityWrapper calls this.db.get(id)
  │    └─ this.db = CodecDatabaseReader (from zodvex wrapDb)
  │         └─ raw db.get(id) → wire doc
  │         └─ decodeDoc(schema.doc, wireDoc) → schema.parse()
  │              └─ sensitive() codec: SensitiveWire → SensitiveField (status: 'full')
  │              └─ zx.date() codec: timestamp → Date
  │         └─ returns runtime doc
  │
  ├─ SecurityWrapper receives runtime doc (SensitiveField instances)
  │
  ├─ RLS check: checkRlsRead(ctx, runtimeDoc, rule, resolver)
  │    └─ RLS checks clinicId, ownerId — plain strings, identical in both formats
  │    └─ If denied: return null
  │
  ├─ FLS check: applyFlsRuntime(runtimeDoc, schema, ctx, resolver, options)
  │    └─ For each sensitive field:
  │         └─ Evaluate read policy tiers via resolver
  │         └─ If denied: replace with SensitiveField.hidden(fieldPath, reason)
  │         └─ If allowed: enrich with field path metadata
  │
  └─ Return runtime doc to handler
```

### Write path (insert)

```
handler calls SecurityWrapper.insert(table, runtimeDoc)
  │
  ├─ RLS check: checkRlsWrite(ctx, runtimeDoc, rule, 'insert', resolver)
  │    └─ If denied: throw
  │
  ├─ FLS write check: applyFlsWriteRuntime(runtimeDoc, schema, ctx, resolver, options)
  │    └─ For each sensitive field:
  │         └─ If hidden status: delete from doc (preserve existing data)
  │         └─ Check write policy via resolver
  │         └─ If denied: throw
  │         └─ If allowed: pass through (DON'T call toWire — zodvex handles encode)
  │
  ├─ SecurityWrapper calls this.db.insert(table, checkedRuntimeDoc)
  │    └─ this.db = CodecDatabaseWriter (from zodvex wrapDb)
  │         └─ encodeDoc(schema.insert, runtimeDoc) → z.encode()
  │              └─ sensitive() codec: SensitiveField → SensitiveWire
  │              └─ zx.date() codec: Date → timestamp
  │         └─ stripUndefined
  │         └─ raw db.insert(table, wireDoc)
  │
  └─ Return id
```

### Write path (patch)

```
handler calls SecurityWrapper.patch(table, id, runtimePatch)
  │
  ├─ Fetch old doc: this.db.get(id)
  │    └─ Goes through CodecDatabaseReader → returns decoded runtime doc
  │
  ├─ RLS check old doc: checkRlsWrite(ctx, oldRuntimeDoc, rule, 'modify', resolver)
  │
  ├─ Merge + RLS check new state: { ...oldRuntimeDoc, ...runtimePatch }
  │    └─ Both are runtime types — merge works naturally
  │
  ├─ FLS write check: applyFlsWriteRuntime(runtimePatch, ...)
  │    └─ Policy check only, no wire conversion
  │    └─ Delete hidden fields from patch
  │
  ├─ SecurityWrapper calls this.db.patch(id, checkedRuntimePatch)
  │    └─ CodecDatabaseWriter.patch() → encodePartialDoc() → wire → raw db
  │
  └─ Audit log
```

---

## 3. What changes in hotpot

### 3a. FLS migration: wire → runtime types

**`applyFls` (read path)** — currently creates SensitiveWire objects on a wire doc. New version operates on decoded runtime doc:

```typescript
// CURRENT: applyFls(wireDoc, schema, ctx, resolver, options)
// - Walks wire doc, reads raw SensitiveWire from DB
// - Creates NEW SensitiveWire with status from policy evaluation
// - Returns wire doc ready for schema.parse()

// NEW: applyFlsRuntime(runtimeDoc, schema, ctx, resolver, options)
// - Walks runtime doc, finds SensitiveField instances (all status: 'full' from decode)
// - Evaluates policies
// - Replaces denied fields with SensitiveField.hidden(fieldPath, reason)
// - Enriches allowed fields with fieldPath metadata
// - Returns modified runtime doc
```

Key simplification: no SensitiveWire construction, no `__sensitiveField` path injection. `SensitiveField.hidden()` and field path enrichment replace the SensitiveWire manipulation.

**`applyFlsWrite` (write path)** — currently normalizes to SensitiveField, checks policy, then calls `toWire()`. New version drops the wire conversion:

```typescript
// CURRENT: applyFlsWrite(doc, schema, ctx, resolver, options)
// - normalizeToSensitiveField(value)
// - Check write policy
// - field.toWire() → SensitiveWire for DB storage

// NEW: applyFlsWriteRuntime(runtimeDoc, schema, ctx, resolver, options)
// - Already has SensitiveField instances (runtime types)
// - Check write policy
// - Delete hidden fields
// - Pass through allowed fields (zodvex encodes later)
```

Key simplification: `normalizeToSensitiveField()` and `field.toWire()` are no longer needed in the write FLS path. zodvex's `encodeDoc()` handles SensitiveField → SensitiveWire via the `sensitive()` codec's encode transform.

### 3b. SecureReader/SecureWriter → SecurityWrapper

The current `createSecureReader` takes raw `ctx.db`. The new version takes codec-wrapped `ctx.db`:

```typescript
// CURRENT
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

// NEW
export function createSecurityWrapper(db: CodecDatabaseReader, ctx, config) {
  return {
    async get(table, id) {
      const doc = await db.get(id)                          // already decoded runtime doc
      const rlsOk = await checkRlsRead(ctx, doc, ...)
      return applyFlsRuntime(doc, schema, ctx, resolver, ...) // runtime → runtime (policy applied)
    }
  }
}
```

**Deletions from SecureReader/Writer:**
- Remove `schema.parse()` calls (lines 137, 175 in `db.ts`)
- Remove `applyFls` import (replaced by `applyFlsRuntime`)
- Remove SensitiveWire creation logic from FLS
- Remove `normalizeToSensitiveField()` and `field.toWire()` from write FLS

### 3c. Builder migration

Replace `zCustomQueryBuilder` / `zCustomMutationBuilder` with `initZodvex` builders:

```typescript
// CURRENT (queries.ts)
import { zCustomQueryBuilder, zQueryBuilder } from 'zodvex'
export const zq = zQueryBuilder(query)
export const hotpotQuery = zCustomQueryBuilder(query, { ... })

// NEW (queries.ts)
import { initZodvex } from 'zodvex/server'
const { zq, zm, ziq, zim } = initZodvex(zodvexSchema, { query, mutation, ... })

export { zq, ziq }  // re-export for non-sensitive queries
export const hotpotQuery = zq.withContext({ ... })
```

**`transforms.output` → `onSuccess`** (already planned in `docs/plans/2026-02-18-hotpot-hooks-migration.md`):

```typescript
// CURRENT
transforms: { output: (result) => { produceReadAuditLog(securityCtx, result); return result } }

// NEW
onSuccess: ({ result }) => produceReadAuditLog(securityCtx, result)
```

### 3d. Schema bridge: models → ZodTableMap

zodvex's `initZodvex` expects `{ __zodTableMap: ZodTableMap }`. hotpot's models already have the right shape:

```typescript
// convex/zodvex.ts (new composition root)
import { models } from '@/convex/models'
import { initZodvex } from 'zodvex/server'
import { query, mutation, action, internalQuery, internalMutation, internalAction } from '@/convex/_generated/server'

// Build ZodTableMap from hotpot models
const zodTableMap = Object.fromEntries(
  Object.entries(models).map(([name, model]) => [
    name,
    { doc: model.schema.doc, insert: model.schema.insert }
  ])
)

export const { zq, zm, za, ziq, zim, zia } = initZodvex(
  { __zodTableMap: zodTableMap },
  { query, mutation, action, internalQuery, internalMutation, internalAction },
)
```

**Open question:** Should hotpot eventually adopt `zodTable()` / `defineZodSchema()` instead of `defineHotpotModel()`? The current approach (deriving ZodTableMap from existing models) works without touching model definitions. Adopting `zodTable()` would be a deeper integration but `defineHotpotModel` does more (indexes, rules, search/vector config) that `zodTable()` doesn't handle. Recommend keeping `defineHotpotModel` and bridging via the ZodTableMap derivation above.

---

## 4. What does NOT change

| Component | Why unchanged |
|-----------|---------------|
| `sensitive()` codec | Still defines SensitiveWire ↔ SensitiveField transform. zodvex invokes it via schema.parse/z.encode |
| `SensitiveField` class | Runtime representation unchanged. FLS still creates `.hidden()` / `.full()` instances |
| RLS logic (`checkRlsRead/Write`) | Checks clinicId, ownerId, role — plain fields identical in wire and runtime |
| Policy resolution (`resolveReadPolicy/WritePolicy`) | Evaluates requirements against resolver — type-agnostic |
| `hotpotResolver` | Checks entitlements, roles, self-access — no SensitiveWire/Field dependency |
| Two-phase RLS for patch | Still checks old + new state. Both are now runtime docs (works identically) |
| `extra` args / `required` entitlements | Flows through `input(ctx, args, extra)` unchanged |
| Audit logging (`produceReadAuditLog/WriteAuditLog`) | Already supports SensitiveField instances (runtime types) |
| `defineHotpotModel` | Model definitions unchanged. ZodTableMap derived from existing models |
| `createSecurityConfig` | Factory pattern unchanged. Schemas/rules/fieldRules derived from models |

---

## 5. Why `.withContext()` works

The runtime-only middleware decision (2026-02-17) resolves what seemed like a hard constraint: FLS needing wire-type access between fetch and decode.

`.withContext()` composition order: **codec first, then user**:

```
raw db → CodecDatabaseReader (decode) → user customization → handler
```

With wire-side FLS, this ordering was impossible — FLS needed to create SensitiveWire objects *before* decode. But with runtime-side FLS, the ordering is natural:

1. zodvex decodes: SensitiveWire → SensitiveField (all `status: 'full'` from DB)
2. hotpot's FLS evaluates policies on SensitiveField instances
3. Denied fields → `SensitiveField.hidden()` (value nulled, status set)
4. Handler receives security-processed runtime doc

**Performance:** The decision doc's analysis holds — decoding docs that RLS will filter costs ~0.024ms per doc, <5% of DB query time. Acceptable tradeoff for the architectural simplification.

---

## 6. FLS detail: field path metadata

**Current approach:** `applyFlsToPath` injects `__sensitiveField: 'patients.email'` into SensitiveWire objects. After decode, `SensitiveField.fromWire()` preserves this as `.field`. The audit logger uses `.field` to identify which sensitive field was accessed.

**Runtime approach:** After codec decode, SensitiveField instances won't have `.field` set (the DB SensitiveWire doesn't store `__sensitiveField` — it's added by FLS during reads). Two options:

**A. FLS enriches field path during processing (recommended):**
```typescript
// In applyFlsRuntime, for each sensitive field:
const enriched = decision.status === 'full'
  ? SensitiveField.full(existingField.expose(), { field: fieldPath, reason: decision.reason })
  : SensitiveField.hidden(fieldPath, decision.reason)
```

This mirrors the current behavior: FLS is the source of truth for field paths and access reasons.

**B. Audit logger infers paths from schema:**
Walk the schema structure and match against SensitiveField instances by position. More complex, less explicit.

Option A is simpler and maintains the current contract: FLS is responsible for annotating sensitive fields with their path and access decision.

**Prerequisite:** `SensitiveField.full()` needs an optional metadata parameter (or a `.withMeta()` method) to set `.field` and `.reason` on allowed fields. Currently `.field` is only set on hidden instances. This is a minor `SensitiveField` API addition.

---

## 7. Sequencing

### Phase 1: zodvex ships composition layer
- `initZodvex`, `createCodecCustomization`, `ZodvexBuilder` type
- `wrapDb: true` wraps ctx.db with CodecDatabaseReader/Writer
- `.withContext()` composes codec + user customization
- **No hotpot changes yet**

### Phase 2: zodvex removes hooks/transforms
- Remove `transforms.input/output`, nested `hooks.onSuccess`, `customCtxWithHooks`
- Simplify to top-level `onSuccess` only
- **Prerequisite for hotpot migration** (hotpot currently uses `transforms.output`)

### Phase 3: hotpot hooks migration (minimal)
- Swap `transforms.output` → `onSuccess` in queries.ts and mutations.ts
- Follow `docs/plans/2026-02-18-hotpot-hooks-migration.md`
- **Can be done independently of initZodvex adoption**

### Phase 4: hotpot adopts initZodvex
- Create zodvex composition root (`convex/zodvex.ts`)
- Replace `zCustomQueryBuilder` / `zCustomMutationBuilder` with `zq.withContext()` / `zm.withContext()`
- Replace `zQueryBuilder(query)` / `zMutationBuilder(mutation)` with re-exported `zq` / `zm`
- **This phase does NOT yet change SecureReader/Writer** — they still wrap raw ctx.db. The `wrapDb` benefit only kicks in after FLS migration.
- This can use `wrapDb: false` initially, or `wrapDb: true` with the customization's `input` overriding `ctx.db` with the SecureReader (which still does its own schema.parse)

### Phase 5: FLS runtime migration (the big one)
- Migrate `applyFls` → `applyFlsRuntime` (runtime-side field security)
- Migrate `applyFlsWrite` → `applyFlsWriteRuntime` (drop `toWire()` call)
- Refactor `createSecureReader/Writer` → `createSecurityWrapper` (accepts codec-wrapped db, no schema.parse)
- Add `.field` metadata support to `SensitiveField.full()`
- Switch to `wrapDb: true` in the zodvex composition root
- **Full test coverage before and after** — security behavior must be identical

### Phase 6: Cleanup
- Remove old `applyFls` / `applyFlsWrite` (wire-side versions)
- Remove `normalizeToSensitiveField()` from FLS (no longer needed)
- Remove manual `schema.parse()` calls from security layer
- Update security tests to use runtime types throughout

---

## 8. Risk assessment

| Risk | Mitigation |
|------|------------|
| FLS runtime migration breaks security | Extensive test coverage: every existing test must pass with identical assertions. Add property-based tests for FLS policy evaluation. |
| Decode cost on RLS-filtered docs | Decision doc benchmarked: ~22ms worst case (1000 docs, 900 filtered). Acceptable. Add benchmark test as living documentation. |
| SensitiveField metadata gap | Small API addition (`SensitiveField.full()` with metadata). Backward-compatible. |
| Double parsing during incremental migration | Phase 4 uses `wrapDb: false` or overrides ctx.db, avoiding double parse. Phase 5 is atomic switchover. |
| Schema mismatch between zodvex ZodTableMap and hotpot models | ZodTableMap is derived from the same `model.schema.doc/insert` that security already uses. Single source of truth. |

---

## 9. Net effect

**Deleted from hotpot:**
- `schema.parse()` calls in SecureReader/Writer (~4 call sites)
- SensitiveWire creation in `applyFls` read path
- `normalizeToSensitiveField()` + `field.toWire()` in `applyFlsWrite`
- `zCustomQueryBuilder` / `zCustomMutationBuilder` imports and manual type parameters
- `transforms.output` usage

**Added to hotpot:**
- zodvex composition root (`convex/zodvex.ts`, ~15 lines)
- `applyFlsRuntime` / `applyFlsWriteRuntime` (simpler than current versions)
- `SensitiveField.full()` metadata parameter

**Architectural win:**
- zodvex owns all codec logic (decode/encode) at the DB boundary
- hotpot owns all security logic (RLS/FLS) at the runtime level
- Clean separation: security never touches wire format, codec never touches access control
- `.withContext()` composition "just works" — no manual `createCodecCustomization` needed
