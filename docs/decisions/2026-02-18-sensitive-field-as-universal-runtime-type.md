# Decision: SensitiveField as Universal Runtime Type

**Date:** 2026-02-18
**Status:** Accepted
**Context:** Hotpot `initZodvex` adoption — designing how FLS integrates with zodvex's codec-first pipeline
**Builds on:** `2026-02-17-runtime-only-middleware.md`

---

## Decision

`SensitiveField` is the single runtime representation for sensitive data in all application code. `SensitiveWire` is confined to storage and wire transport — an implementation detail of the `sensitive()` codec.

FLS applies access decisions via a new monotonic `SensitiveField.applyDecision()` method that can only maintain or restrict access, never escalate. The codec produces `SensitiveField.full()` instances on decode; FLS downgrades denied fields to `SensitiveField.hidden()` via `applyDecision`.

```
DB (SensitiveWire) ←→ sensitive() codec ←→ SensitiveField ←→ all app code
                                                              ├─ FLS (.applyDecision)
                                                              ├─ RLS (plain field access)
                                                              ├─ Handlers (.expose, .isFull)
                                                              └─ Audit (.field, .status)
```

---

## The Problem: Dual-Format Security Code

The current architecture has FLS operating on wire-format data (SensitiveWire objects), then handing off to the codec for transformation to SensitiveField. This creates a dual-format surface:

### FLS straddles the wire/runtime boundary

```typescript
// Current applyFls (read path) — constructs SensitiveWire objects
const newWire: SensitiveWire<unknown> = {
  value: decision.status === 'full' ? currentWire.value : null,
  status: decision.status,
  __sensitiveField: fieldPath,
}
setValueAtPath(obj, path, newWire)
```

FLS manually constructs `SensitiveWire` objects with the correct status, value, `__sensitiveField` path, and optional reason. This is wire-format manipulation — FLS is doing the codec's job.

### The audit logger handles both formats

```typescript
// Current audit logger — dual-format detection
if (isSensitiveFieldInstance(value)) {
  // Post-validation: SensitiveField class instance
  collectFromSensitiveField(value)
} else if (isSensitiveWireObject(value)) {
  // Pre-validation: plain SensitiveWire object
  collectFromSensitiveWire(value)
}
```

The logger needs to handle both because `transforms.output` (pre-validation) sees SensitiveWire, while `onSuccess` (post-validation) sees SensitiveField. This dual path doubles the surface area for bugs and makes the logger harder to reason about.

### Write FLS has its own normalization layer

```typescript
// Current applyFlsWrite — three input formats
function normalizeToSensitiveField(value) {
  if (value instanceof SensitiveField) return value        // from handler
  if (isSensitiveWireObject(value)) return fromWire(value) // from DB read
  return SensitiveField.full(value)                        // raw value from UI
}
```

The write path normalizes three possible input formats before it can check policies. After checking, it converts back to SensitiveWire via `field.toWire()`. This normalization layer exists only because application code operates on multiple representations.

---

## Why SensitiveField-Only Is Better

### 1. FLS simplifies dramatically

```typescript
// NEW applyFlsRuntime (read path) — one line per field
for (const { path } of sensitiveFields) {
  const field = getValueAtPath(doc, path) as SensitiveField<unknown>
  const decision = await resolveReadPolicy(policyCtx, readPolicy, resolver)
  setValueAtPath(doc, path, field.applyDecision(decision, fieldPath))
}
```

No SensitiveWire construction. No `{ value, status, __sensitiveField }` assembly. No wire-format manipulation. FLS evaluates a policy and applies a decision. The `applyDecision` method handles all the state transition logic.

### 2. Audit logging loses its dual path

```typescript
// NEW audit logger — single format
if (isSensitiveFieldInstance(value)) {
  log({ field: value.field, status: value.status, reason: value.reason })
}
// isSensitiveWireObject() check eliminated entirely
```

The logger only handles one type. The dual-format branching — and its associated testing burden — disappears.

### 3. Write FLS drops normalization

```typescript
// NEW applyFlsWriteRuntime — input is always SensitiveField
const field = getValueAtPath(doc, path) as SensitiveField<unknown>
if (field.isHidden()) { deleteValueAtPath(...); return }
const decision = await resolveWritePolicy(...)
if (!decision.allowed) throw new Error(...)
// Pass through — codec encode handles SensitiveField → SensitiveWire
```

`normalizeToSensitiveField()` is deleted. `field.toWire()` is deleted. The codec handles all format conversion.

### 4. Security invariant is enforced by the type

The critical invariant — **hidden data cannot be restored** — moves from being a convention in FLS code to being enforced by `SensitiveField.applyDecision()`:

```typescript
applyDecision(decision: ReadDecision, fieldPath: string): SensitiveField<T> {
  // HARD INVARIANT: once hidden, always hidden
  if (this.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, this.reason ?? decision.reason)
  }
  if (decision.status === 'hidden') {
    return SensitiveField.hidden(fieldPath, decision.reason)
  }
  return SensitiveField.full(this.expose(), fieldPath, decision.reason)
}
```

A bug in FLS policy evaluation can produce an incorrect `decision`, but it cannot cause `applyDecision` to escalate a hidden field to full. The monotonic restriction is structural, not procedural.

### 5. SensitiveField's guardrail properties are preserved

| Property | Still holds? | Why |
|----------|-------------|-----|
| Structured | Yes | Always a typed class instance |
| Immutable by public API | Yes | `applyDecision` creates a new instance, doesn't mutate |
| Fail-secure for logging | Yes | `toJSON()` returns guard, `.expose()` throws on hidden |
| Pit of success | Yes | Handler code always works with SensitiveField |
| Hidden data can't be restored | Yes — now enforced by the type | `applyDecision` is monotonic |

---

## The "Create-Then-Replace" Pattern

With codec-first decode, every sensitive field starts as `SensitiveField.full(value)` — before FLS evaluates the access decision. FLS then replaces denied fields with `SensitiveField.hidden()`.

### Why this is acceptable

**SensitiveField is a guardrail, not an access-control mechanism.** Its job is to:
- Prevent accidental value exposure (anti-coercion guards, `.expose()` throws on hidden)
- Carry structured access metadata (status, field path, reason)
- Make the right thing easy and the wrong thing hard

The access control decision lives in FLS policy evaluation. SensitiveField enforces the *result* of that decision, regardless of when the instance was created.

**The interim state is not observable.** Between codec decode and FLS, all fields appear as `.full()`. But this state exists only inside `SecurityWrapper.get()`. The handler never sees it. If SecurityWrapper encounters an error, it fails closed (returns null or throws).

**The raw value was already in memory.** The DB response contains the plaintext value in the SensitiveWire `{ value: '...' }` object. Creating a `.full()` SensitiveField doesn't create new exposure — the value was fetched from the DB regardless. What matters is that the handler receives the correct access decision, which FLS guarantees.

### Historical precedent

An `applyDecision`-like method previously existed on SensitiveField for exactly this pattern — applying access decisions at runtime. It was removed during the wire-side FLS redesign. Reintroducing it is a return to a proven pattern, not a novel experiment.

---

## What This Enables

### zodvex owns all codec logic

With FLS no longer constructing SensitiveWire objects or calling `schema.parse()`, zodvex's `CodecDatabaseReader` / `CodecDatabaseWriter` handle all format conversion. hotpot's security layer is fully decoupled from wire format.

### `.withContext()` composition works naturally

zodvex's composition model (`wrapDb: true` + `.withContext()`) puts the codec before the user's customization:

```
raw db → codec (decode) → user customization (security) → handler
```

With wire-side FLS, this ordering was impossible — FLS needed to run before decode. With runtime-side FLS via `applyDecision`, the ordering is natural. Security operates on decoded data. No manual `createCodecCustomization` needed.

### Audit logging is simplified

The audit logger's dual-format handling (`isSensitiveFieldInstance` OR `isSensitiveWireObject`) collapses to a single format check. The `transforms.output` hook (pre-validation, sees SensitiveWire) is replaced by `onSuccess` (post-validation, sees SensitiveField). One code path, one type.

---

## Reversibility

If an unforeseen use case requires wire-format FLS, the codec-first pipeline does not prevent it:

1. `createCodecCustomization` is available as an escape hatch for consumers who need to control codec ordering
2. `wrapDb: false` lets consumers construct their own CodecDatabaseReader with custom layering
3. `decodeDoc()` / `encodeDoc()` primitives remain available for fully manual flows

The `applyDecision` method on SensitiveField is purely additive — it doesn't prevent wire-side construction via `SensitiveField.fromWire()`.

---

## Impact Summary

| Before | After |
|--------|-------|
| FLS constructs SensitiveWire objects | FLS calls `field.applyDecision(decision, path)` |
| Audit logger handles SensitiveField + SensitiveWire | Audit logger handles SensitiveField only |
| Write FLS normalizes 3 input formats | Write FLS receives SensitiveField only |
| "Hidden can't be restored" is a convention in FLS code | "Hidden can't be restored" is enforced by `applyDecision` |
| FLS + codec share responsibility for wire format | Codec owns wire format exclusively |
