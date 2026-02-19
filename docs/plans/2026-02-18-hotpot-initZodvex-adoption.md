# Hotpot `initZodvex` Adoption Design

> **North star:** hotpot delegates all codec responsibilities to zodvex. Security (RLS + FLS) operates exclusively on `SensitiveField` — the single runtime type for all application code. `SensitiveWire` is confined to storage and transport. zodvex owns decode/encode; hotpot owns access control.

**Depends on:**
- zodvex ships `initZodvex` with `wrapDb: true` (composition layer — `docs/plans/2026-02-18-composition-layer-impl.md`)
- zodvex removes hooks/transforms (cleanup — `docs/plans/2026-02-18-hooks-transforms-removal.md`)

**References:**
- `docs/decisions/2026-02-17-runtime-only-middleware.md` — runtime-only middleware
- `docs/decisions/2026-02-18-sensitive-field-as-universal-runtime-type.md` — SensitiveField as the universal runtime type, monotonic `applyDecision`

---

## 1. Architecture: Before and After

### Before (current)

```
raw ctx.db → SecureReader (RLS → FLS(wire) → schema.parse()) → handler
```

hotpot owns the entire pipeline: fetch, security, AND codec decode (`schema.parse()`). FLS operates on SensitiveWire objects (wire format), then the codec transforms them to SensitiveField. Two representations exist in application code — the audit logger handles both via `isSensitiveFieldInstance()` and `isSensitiveWireObject()`.

```typescript
// hotpot/queries.ts (current)
export const hotpotQuery = zCustomQueryBuilder(query, {
  input: async (ctx) => {
    const db = createSecureReader(ctx.db, securityCtx, config)
    // SecureReader does: fetch → RLS → FLS(wire) → schema.parse()
    return {
      ctx: { db, securityCtx },
      transforms: { output: (result) => { produceReadAuditLog(...); return result } }
    }
  }
})
```

### After (target)

```
raw ctx.db → CodecDatabaseReader (decode) → SecurityWrapper (RLS → FLS(runtime)) → handler
```

zodvex owns decode/encode via `wrapDb: true`. hotpot's security layer wraps the codec-wrapped db, operating exclusively on `SensitiveField` instances. FLS uses `SensitiveField.applyDecision()` — a monotonic operation that can only maintain or restrict access, never escalate.

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

## 2. Type boundary

The key architectural change: SensitiveWire is confined to storage/transport. All application code operates on SensitiveField.

```
DB (SensitiveWire) ←→ codec ←→ SensitiveField ←→ everything else
                                                    ├─ FLS (applyDecision)
                                                    ├─ RLS (plain field access)
                                                    ├─ Handlers (.expose(), .isFull())
                                                    └─ Audit logging (.field, .status)
```

**Before:** FLS straddled the wire/runtime boundary — creating SensitiveWire objects and passing them to the codec. The audit logger had to handle both formats.

**After:** FLS operates entirely on SensitiveField via `applyDecision()`. The audit logger only sees SensitiveField. `isSensitiveWireObject()` checks are eliminated from application code.

---

## 3. `SensitiveField.applyDecision()`

The core API addition that enables runtime-side FLS:

```typescript
/**
 * Apply a security access decision to this field.
 *
 * Monotonic: can only maintain or restrict access, never escalate.
 * Once hidden, always hidden — regardless of decision.
 *
 * @param decision - The access decision from policy evaluation
 * @param fieldPath - Qualified field path (e.g., 'patients.email')
 * @returns New SensitiveField with the decision applied
 */
applyDecision(decision: ReadDecision, fieldPath: string): SensitiveField<T> {
  // INVARIANT: hidden data cannot be restored
  if (this.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, this.reason ?? decision.reason)
  }

  if (decision.status === 'hidden') {
    // Restrict: full → hidden (value is nulled, not recoverable)
    return SensitiveField.hidden(fieldPath, decision.reason)
  }

  // Maintain: full → full (enrich with field path and reason)
  return SensitiveField.full(this.expose(), fieldPath, decision.reason)
}
```

**Why this is on SensitiveField (not a standalone function):**
- The monotonic invariant (can't escalate) is a property of the type, enforced by the type
- The instance knows its own state and what transitions are valid
- Callers (FLS) can't accidentally bypass the restriction — it's built into the method

**SensitiveField.full() change:** Add optional `reason` parameter (one-line, backward-compatible):

```typescript
// CURRENT
static full<T>(value: T, field?: string): SensitiveField<T>

// NEW
static full<T>(value: T, field?: string, reason?: ReasonCode): SensitiveField<T>
```

The constructor already accepts `reason` — `.full()` just doesn't pass it through. Single-line fix.

---

## 4. Data Flow

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
  │         └─ returns runtime doc (all SensitiveField, all 'full')
  │
  ├─ SecurityWrapper receives runtime doc
  │
  ├─ RLS check: checkRlsRead(ctx, runtimeDoc, rule, resolver)
  │    └─ If denied: return null (fail closed)
  │
  ├─ FLS: applyFlsRuntime(runtimeDoc, schema, ctx, resolver, options)
  │    └─ For each sensitive field:
  │         └─ Evaluate read policy tiers via resolver
  │         └─ field.applyDecision(decision, fieldPath)
  │              └─ If denied: new SensitiveField.hidden (value nulled, not recoverable)
  │              └─ If allowed: new SensitiveField.full (enriched with field path + reason)
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
  │         └─ If allowed: pass through (zodvex handles encode)
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

## 5. What changes in hotpot

### 5a. `SensitiveField` additions

```typescript
// Add to SensitiveField class:
applyDecision(decision: ReadDecision, fieldPath: string): SensitiveField<T>

// Modify existing:
static full<T>(value: T, field?: string, reason?: ReasonCode): SensitiveField<T>
```

Both backward-compatible. `applyDecision` is new. `.full()` gains an optional third parameter.

### 5b. FLS migration: wire → runtime types

**`applyFls` → `applyFlsRuntime` (read path):**

```typescript
// CURRENT: manipulates SensitiveWire objects on a wire doc
for (const { path } of sensitiveFields) {
  const fieldValue = getValueAtPath(doc, path) as SensitiveWire<unknown>
  const decision = await resolveReadPolicy(policyCtx, readPolicy, resolver)
  const newWire: SensitiveWire = {
    value: decision.status === 'full' ? fieldValue.value : null,
    status: decision.status,
    __sensitiveField: fieldPath,
  }
  if (decision.reason) newWire.reason = decision.reason
  setValueAtPath(doc, path, newWire)
}

// NEW: calls applyDecision on SensitiveField instances
for (const { path } of sensitiveFields) {
  const field = getValueAtPath(doc, path) as SensitiveField<unknown>
  const decision = await resolveReadPolicy(policyCtx, readPolicy, resolver)
  setValueAtPath(doc, path, field.applyDecision(decision, fieldPath))
}
```

**`applyFlsWrite` → `applyFlsWriteRuntime` (write path):**

```typescript
// CURRENT: normalizes to SensitiveField, checks policy, converts toWire()
const field = normalizeToSensitiveField(fieldValue)
if (field.status === 'hidden') { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
setValueAtPath(obj, path, field.toWire())

// NEW: already SensitiveField, checks policy, passes through
const field = getValueAtPath(doc, path) as SensitiveField<unknown>
if (field.isHidden()) { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
// No toWire() — zodvex's encodeDoc() handles SensitiveField → SensitiveWire
```

**Deletions:**
- `normalizeToSensitiveField()` — everything is already SensitiveField
- SensitiveWire object construction in read FLS (`{ value, status, __sensitiveField }`)
- `field.toWire()` calls in write FLS (codec handles encode)
- `isSensitiveWireObject()` checks in audit logger (only SensitiveField exists in app code)

### 5c. SecureReader/SecureWriter → SecurityWrapper

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
export function createSecurityWrapper(db, ctx, config) {
  return {
    async get(table, id) {
      const doc = await db.get(id)                              // decoded runtime doc
      if (!doc) return null
      const rlsOk = await checkRlsRead(ctx, doc, ...)
      if (!rlsOk) return null
      return applyFlsRuntime(doc, schema, ctx, resolver, ...)   // SensitiveField → SensitiveField
    }
  }
}
```

### 5d. Builder migration

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

### 5e. Schema bridge: models → ZodTableMap

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

## 6. What does NOT change

| Component | Why unchanged |
|-----------|---------------|
| `sensitive()` codec | Still defines SensitiveWire ↔ SensitiveField transform. zodvex invokes it via schema.parse/z.encode |
| RLS logic (`checkRlsRead/Write`) | Checks clinicId, ownerId, role — plain fields identical in wire and runtime |
| Policy resolution (`resolveReadPolicy/WritePolicy`) | Evaluates requirements against resolver — type-agnostic |
| `hotpotResolver` | Checks entitlements, roles, self-access — no format dependency |
| Two-phase RLS for patch | Still checks old + new state. Both are now runtime docs (works identically) |
| `extra` args / `required` entitlements | Flows through `input(ctx, args, extra)` unchanged |
| `defineHotpotModel` | Model definitions unchanged. ZodTableMap derived from existing models |
| `createSecurityConfig` | Factory pattern unchanged. Schemas/rules/fieldRules derived from models |

---

## 7. Why `.withContext()` works

`.withContext()` composition order: **codec first, then user**:

```
raw db → CodecDatabaseReader (decode) → user customization → handler
```

This ordering works because FLS operates on `SensitiveField` via `applyDecision()`. The codec produces SensitiveField instances (all `status: 'full'` from DB storage), and FLS applies access decisions monotonically — can only maintain or restrict, never escalate.

The important invariants that make this safe:
- `applyDecision` on a hidden field always returns hidden (hidden data can't be restored)
- If SecurityWrapper encounters an error, it fails closed (returns null / throws)
- The handler never sees the intermediate state (pre-FLS SensitiveField instances)

**Performance:** The decision doc's analysis holds — decoding docs that RLS will filter costs ~0.024ms per doc, <5% of DB query time. Acceptable tradeoff for the architectural simplification.

---

## 8. Sequencing

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

### Phase 4: hotpot adopts initZodvex + SensitiveField.applyDecision
- Add `applyDecision()` to SensitiveField class
- Add `reason` parameter to `SensitiveField.full()`
- Create zodvex composition root (`convex/zodvex.ts`)
- Replace `zCustomQueryBuilder` / `zCustomMutationBuilder` with `zq.withContext()` / `zm.withContext()`
- Replace `zQueryBuilder(query)` / `zMutationBuilder(mutation)` with re-exported `zq` / `zm`
- **This phase does NOT yet change SecureReader/Writer** — can use `wrapDb: false` initially, with SecureReader still wrapping raw ctx.db

### Phase 5: FLS runtime migration
- Migrate `applyFls` → `applyFlsRuntime` (uses `field.applyDecision()` instead of SensitiveWire construction)
- Migrate `applyFlsWrite` → `applyFlsWriteRuntime` (drop `normalizeToSensitiveField()` and `toWire()`)
- Refactor `createSecureReader/Writer` → `createSecurityWrapper` (accepts codec-wrapped db, no schema.parse)
- Switch to `wrapDb: true` in the zodvex composition root
- **Full test coverage before and after** — security behavior must be identical

### Phase 6: Cleanup
- Remove old `applyFls` / `applyFlsWrite` (wire-side versions)
- Remove `normalizeToSensitiveField()` from FLS
- Remove `isSensitiveWireObject()` checks from audit logger
- Remove manual `schema.parse()` calls from security layer
- Update security tests to use runtime types throughout

---

## 9. Risk assessment

| Risk | Mitigation |
|------|------------|
| FLS runtime migration breaks security | Extensive test coverage: every existing test must pass with identical assertions. `applyDecision()` enforces monotonic restriction at the type level. |
| Hidden data restored via applyDecision bug | `applyDecision` checks `this.status` first — if already hidden, returns hidden regardless of decision. This is the hard invariant. |
| Decode cost on RLS-filtered docs | Decision doc benchmarked: ~22ms worst case (1000 docs, 900 filtered). Acceptable. Add benchmark test as living documentation. |
| Double parsing during incremental migration | Phase 4 uses `wrapDb: false` to avoid double parse. Phase 5 is the atomic switchover to `wrapDb: true`. |
| Schema mismatch between zodvex ZodTableMap and hotpot models | ZodTableMap is derived from the same `model.schema.doc/insert` that security already uses. Single source of truth. |

---

## 10. Net effect

**Deleted from hotpot:**
- `schema.parse()` calls in SecureReader/Writer (~4 call sites)
- SensitiveWire object construction in `applyFls` read path
- `normalizeToSensitiveField()` + `field.toWire()` in `applyFlsWrite`
- `isSensitiveWireObject()` checks in audit logger
- `zCustomQueryBuilder` / `zCustomMutationBuilder` imports and manual type parameters
- `transforms.output` usage

**Added to hotpot:**
- `SensitiveField.applyDecision()` (~10 lines, enforces monotonic restriction)
- `SensitiveField.full()` gains `reason` parameter (one-line change)
- zodvex composition root (`convex/zodvex.ts`, ~15 lines)
- `applyFlsRuntime` / `applyFlsWriteRuntime` (simpler than current versions)

**Architectural win:**
- SensitiveField is the single runtime type — all application code operates on one representation
- SensitiveWire is confined to storage/transport — an implementation detail of the codec
- zodvex owns all codec logic (decode/encode) at the DB boundary
- hotpot owns all security logic (RLS/FLS) at the runtime level
- Audit logger simplified: only handles SensitiveField (dual-format handling eliminated)
- `.withContext()` composition "just works" — no manual `createCodecCustomization` needed
