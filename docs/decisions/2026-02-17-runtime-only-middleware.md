# Decision: Runtime-Only Database Middleware

**Date:** 2026-02-17
**Status:** Accepted
**Context:** zodvex API redesign — brainstorming session for v2 architecture

---

## Decision

Database middleware in zodvex v2 operates exclusively on **runtime-typed documents** (after codec decode on reads, before codec encode on writes). Wire-format interception is not exposed in the middleware API.

```typescript
// The middleware API — runtime types only
onRead:  (ctx, runtimeDoc) => runtimeDoc | null
onWrite: (ctx, runtimeDoc) => runtimeDoc | null
```

Escape hatch: `decodeDoc()` / `encodeDoc()` primitives remain available for consumers who need manual wire-format access outside the middleware system.

---

## The Problem: Two-Sided Codec Seam

Codecs create two representations of every document at every boundary:

```
DB (wire format)  →  [codec decode]  →  Runtime format (handler uses this)
                         ↑
                    the "seam"
```

The previous hook API (`decode.before` / `decode.after` / `encode.before` / `encode.after`) exposed both sides, giving middleware authors a choice. This created ambiguity: which side should my code operate on?

---

## Why Runtime-Side Is Better

### Row-Level Security (RLS)

RLS checks fields like `ownerId`, `teamId`, `clinicId` — plain string/ID fields that are identical in both wire and runtime format. Wire-side access provides zero advantage.

```typescript
// Works identically on wire or runtime doc
(ctx, doc) => doc.clinicId === ctx.clinicId ? doc : null
```

### Field-Level Security (FLS) — Read

Runtime-side FLS is **actively better**. Instead of silently deleting fields (wire-side pattern), consumers can return typed hidden markers:

```typescript
// Wire-side (current hotpot pattern): field disappears silently
delete wireDoc.email  // consumer sees undefined — no explanation

// Runtime-side (proposed): typed, informative, safe
doc.email = SensitiveWrapper.hidden("email", "insufficient_access")
// consumer sees a SensitiveWrapper with status: "hidden" — clear signal
```

### Field-Level Security (FLS) — Write

The handler provides runtime data (e.g., `SensitiveWrapper.full("new@example.com")`). Permission checks naturally operate on what the handler is trying to write — which is the runtime representation.

### Audit Logging

Hotpot's audit logging (via `transforms.output`) needs `SensitiveField` instances to know which fields are sensitive and what their access status is. This is exclusively a runtime-side concern — wire objects don't carry class identity.

### Single Representation Principle

With runtime-only middleware, every piece of consumer code operates on one representation. No question of "which side am I on?" No coupling to wire format internals. The codec is an implementation detail, not something middleware authors reason about.

---

## Why Hotpot Currently Uses Wire-Side Hooks

### Our Assessment of the Reasoning

**1. Historical accident (most likely driver).** Hotpot's `createSecureReader` was built to wrap `ctx.db` directly, before zodvex had codecs. Wire format was the only format available. When zodvex added the hook system, `decode.before` was designed to accommodate hotpot's existing pattern. The wire-side choice wasn't a deliberate architectural decision — it was the path of least resistance to integrate what already existed.

**2. Wire format simplicity.** Wire docs are plain JSON objects. `doc.clinicId === ctx.clinicId` works without understanding codec types. But this is a false distinction for RLS — the fields RLS checks (IDs, strings) aren't codec fields and look identical in both representations.

**3. "Least exposure" security argument.** If you never decode an unauthorized doc, the sensitive value never exists in memory, even briefly. This is theoretically valid but practically meaningless — the value exists in the Convex response payload regardless, the decode happens in the same server process, and discarded objects are garbage collected immediately. No attacker can observe the difference.

### Convincing the Hotpot Team

The key arguments:

1. **RLS fields are plain types.** `clinicId`, `ownerId`, `teamId` are strings/IDs — identical in wire and runtime. Wire access gives you nothing here.

2. **FLS is better runtime-side.** `SensitiveWrapper.hidden("email", "insufficient_access")` is a typed, informative signal. Silently deleted fields are a worse developer experience.

3. **Audit logging already requires runtime types.** That's why `transforms.output` exists — hotpot needs `SensitiveField` instances, not wire objects.

4. **One representation to reason about.** Every piece of middleware code operates on runtime types. No "which side?" ambiguity. Better types, simpler mental model.

---

## Performance: Decode Cost for Filtered Documents

### The Concern

With runtime-only middleware, documents that RLS will filter get decoded before being discarded. This is wasted work.

### Analysis

Per-document decode cost for a realistic hotpot document (15 fields, 2 date codecs, 3 sensitive field codecs):

| Operation | Cost per field | Fields | Total |
|-----------|---------------|--------|-------|
| Zod type check | ~0.001ms | 15 | ~0.015ms |
| `new Date(timestamp)` | ~0.001ms | 2 | ~0.002ms |
| `new SensitiveWrapper()` + `WeakMap.set()` | ~0.002ms | 3 | ~0.006ms |
| Object allocation | ~0.001ms | 1 | ~0.001ms |
| **Total per doc** | | | **~0.024ms** |

For a worst-case scenario — 1000 docs queried, 900 filtered by RLS:

- **Wasted decode work:** 900 × 0.024ms = **~22ms**
- **Convex function budget:** 60,000ms (queries) to 600,000ms (mutations)
- **DB query time (dominates):** typically 50-500ms for 1000 docs

The wasted decode is <5% of the DB query time and <0.04% of the function budget.

### Verification Plan

A benchmark test should be added during implementation:

```typescript
// Benchmark: decode 1000 mixed-codec docs, measure wall time
// Compare: decode-then-filter vs filter-then-decode
// Expectation: <25ms overhead for 1000-doc worst case
```

This becomes living documentation. If a future codec makes decode expensive, the benchmark catches it.

### External Reference

Zod v4 benchmarks show parsing throughput of ~1M+ simple objects/sec. Even with codec transforms, zodvex is well within budget for realistic Convex query result sets.

---

## Reversibility: Adding Pre-Decode Hooks Later

### If an unpredicted edge case surfaces

The wire doc is always available inside the DB wrapper before `decodeDoc()` runs. Adding a pre-decode intercept is a one-line additive change:

```typescript
// Current: decode then middleware
const wireDoc = await db.get(id)
const runtimeDoc = decodeDoc(schema, wireDoc)
const result = await onRead(ctx, runtimeDoc)

// Adding pre-decode later (additive, nothing breaks):
const wireDoc = await db.get(id)
const filtered = await onPreRead?.(ctx, wireDoc)    // ← new optional hook
if (filtered === null) return null
const runtimeDoc = decodeDoc(schema, filtered)
const result = await onRead(ctx, runtimeDoc)
```

**Impact on existing consumers:** Zero. The pre-decode hook would be a new optional field. Consumers who don't use it never see it. No breaking changes.

**The types already exist:** `WireDoc` and `RuntimeDoc` are defined in `src/db/hooks.ts`. Re-exposing a wire-side hook is just adding a new optional field to the middleware config.

**Bottom line:** This is a two-way door. We commit to runtime-only now (simpler API, better types, enforces correct patterns), with confidence that adding pre-decode back is trivial if needed.

---

## Impact on Hook API

### Before (6 hook points, two representations)

```typescript
decode.before.one(ctx, wireDoc)       → wireDoc | null
decode.before.many(ctx, wireDocs[])   → wireDocs[]
decode.after.one(ctx, runtimeDoc)     → runtimeDoc | null
decode.after.many(ctx, runtimeDocs[]) → runtimeDocs[]
encode.before(ctx, runtimeDoc)        → runtimeDoc | null
encode.after(ctx, wireDoc)            → wireDoc | null
```

### After (2 hook points, one representation)

```typescript
onRead(ctx, runtimeDoc)   → runtimeDoc | null    // after decode
onWrite(ctx, runtimeDoc)  → runtimeDoc | null     // before encode
```

Batch variants (`onReadMany`) may still be needed for performance (batch RLS with single permissions lookup), but both operate on runtime types.

**Update:** zodvex v2 moved away from providing hook points entirely — consumers write their own DB wrappers (following Convex's `wrapDatabaseReader` pattern) on top of zodvex's codec layer, but this decision still applies: those wrappers receive runtime-typed documents.
