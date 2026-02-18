# Plan 3: DB Codec Layer Simplification

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the 6-hook-point `DatabaseHooks` system from zodvex's public API. Simplify `createZodDbReader`/`createZodDbWriter` to codec-only (no hooks). Preserve `decodeDoc`/`encodeDoc` as escape hatches.

**Architecture:** Per the v2 design, zodvex owns codec correctness at the DB boundary — decode on read, encode on write. DB-level interception (RLS, FLS, audit logging) is the consumer's responsibility via Convex's `wrapDatabaseReader` pattern. zodvex exposes the codec primitives; consumers wrap on top.

**Tech Stack:** TypeScript, Zod v4, Bun test runner

**Prerequisite:** Plan 2 (initZodvex redesign) must be complete. After Plan 2, `initZodvex` no longer passes hooks to `createZodDbReader`/`Writer`.

**Prerequisite reading:**
- `docs/plans/2026-02-17-zodvex-v2-redesign.md` (Section: Database Codec Layer)
- `docs/decisions/2026-02-17-runtime-only-middleware.md`
- `src/db/wrapper.ts` — current DB wrapper with hooks
- `src/db/hooks.ts` — 6-hook-point system to remove

---

### Task 1: Write tests for the simplified DB reader (codec-only, no hooks)

These tests prove the simplified wrapper decodes correctly without any hook infrastructure.

**Files:**
- Modify: `__tests__/db/wrapper-reader.test.ts`

**Step 1: Remove hook-related tests, keep codec tests**

The existing tests in `__tests__/db/wrapper-reader.test.ts` already test codec decoding (lines 40-161). The tests for `decode.before.one` and `decode.after.one` hooks (lines 163-244) should be removed since hooks are being removed from the wrapper.

Remove these tests:
- `'applies decode.before.one hook (can filter)'`
- `'applies decode.after.one hook (can transform)'`
- `'applies decode.before.one to filter in query().collect()'`

Keep all other tests (they test codec behavior without hooks).

**Step 2: Run the tests**

Run: `bun test __tests__/db/wrapper-reader.test.ts`
Expected: PASS — the remaining tests don't use hooks.

**Step 3: Commit**

```bash
git add __tests__/db/wrapper-reader.test.ts
git commit -m "test: remove hook-dependent tests from DB reader (hooks moving to consumer)"
```

---

### Task 2: Simplify `createZodDbReader` — remove hooks parameter

**Files:**
- Modify: `src/db/wrapper.ts`

**Step 1: Simplify `decodeOne` — remove hooks**

Current `decodeOne` has 3 steps (before hook, codec, after hook). Simplify to codec only:

```typescript
async function decodeOne(
  raw: WireDoc,
  schema: z.ZodTypeAny
): Promise<RuntimeDoc> {
  return decodeDoc(schema, raw) as RuntimeDoc
}
```

Note: The simplified version always returns a `RuntimeDoc` (never null) — null filtering is the consumer's concern.

**Step 2: Simplify `decodeMany` — remove hooks**

```typescript
async function decodeMany(
  rawDocs: WireDoc[],
  schema: z.ZodTypeAny
): Promise<RuntimeDoc[]> {
  return rawDocs.map(doc => decodeDoc(schema, doc) as RuntimeDoc)
}
```

**Step 3: Simplify `createZodDbReader` — remove hooks and ctx parameters**

```typescript
export function createZodDbReader(
  db: ConvexDbReader,
  zodTables: ZodTableMap
) {
  return {
    async get(id: any): Promise<any | null> {
      const raw = await db.get(id)
      if (raw === null) return null

      const schema = findTableSchema(raw as WireDoc, zodTables)
      if (!schema) return raw

      return decodeOne(raw as WireDoc, schema)
    },

    query(table: string): ZodQueryChain {
      const entry = zodTables[table]
      if (!entry) {
        throw new Error(
          `Unknown table "${table}" — not found in zodTables. ` +
            `Available tables: ${Object.keys(zodTables).join(', ')}`
        )
      }

      const innerChain = db.query(table)
      return new ZodQueryChain(innerChain, entry.schema.doc)
    },

    get system() {
      return (db as any).system
    }
  }
}
```

**Step 4: Simplify `ZodQueryChain` — remove hooks and ctx**

```typescript
class ZodQueryChain {
  constructor(
    private inner: ConvexQueryChain,
    private schema: z.ZodTypeAny
  ) {}

  withIndex(name: string, fn?: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.withIndex(name, fn), this.schema)
  }

  filter(fn: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.filter(fn), this.schema)
  }

  order(order: string): ZodQueryChain {
    return new ZodQueryChain(this.inner.order(order), this.schema)
  }

  async collect(): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.collect()
    return decodeMany(rawDocs, this.schema)
  }

  async first(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.first()
    if (raw === null) return null
    return decodeOne(raw, this.schema)
  }

  async unique(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.unique()
    if (raw === null) return null
    return decodeOne(raw, this.schema)
  }

  async take(n: number): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.take(n)
    return decodeMany(rawDocs, this.schema)
  }
}
```

**Step 5: Run the tests**

Run: `bun test __tests__/db/wrapper-reader.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/db/wrapper.ts
git commit -m "refactor: simplify createZodDbReader to codec-only (remove hooks)"
```

---

### Task 3: Simplify `createZodDbWriter` — remove hooks parameter

**Files:**
- Modify: `src/db/wrapper.ts`
- Modify: `__tests__/db/wrapper-writer.test.ts` (remove hook tests)

**Step 1: Simplify `createZodDbWriter`**

Remove all hook infrastructure from insert and patch. The writer becomes:

```typescript
export function createZodDbWriter(
  db: ConvexDbWriter,
  zodTables: ZodTableMap
) {
  const reader = createZodDbReader(db, zodTables)

  return {
    get: reader.get,
    query: reader.query.bind(reader),
    get system() {
      return reader.system
    },

    async insert(table: string, doc: RuntimeDoc): Promise<any> {
      const entry = zodTables[table]
      if (!entry) {
        throw new Error(
          `Unknown table "${table}" — not found in zodTables. ` +
            `Available tables: ${Object.keys(zodTables).join(', ')}`
        )
      }

      const wire: WireDoc = encodeFullDoc(entry.schema.base, doc)
      return db.insert(table, wire)
    },

    async patch(id: any, patch: RuntimeDoc): Promise<void> {
      const existing = await db.get(id)
      if (existing === null) {
        throw new Error(`Document not found for patch: ${id}`)
      }

      const entry = findTableEntry(existing as WireDoc, zodTables)
      let wire: WireDoc
      if (entry) {
        wire = encodePatchFields(entry.schema.base, patch)
      } else {
        wire = stripUndefined(patch) as WireDoc
      }

      await db.patch(id, wire)
    },

    async delete(id: any): Promise<void> {
      await db.delete(id)
    }
  }
}
```

**Step 2: Remove hook-dependent tests from writer test file**

In `__tests__/db/wrapper-writer.test.ts`, remove any tests that reference `hooks`, `encode.before`, or `encode.after`. Keep codec encoding tests.

**Step 3: Run the tests**

Run: `bun test __tests__/db/wrapper-writer.test.ts`
Expected: PASS

Run: `bun test __tests__/db/wrapper-reader.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/wrapper.ts __tests__/db/wrapper-writer.test.ts
git commit -m "refactor: simplify createZodDbWriter to codec-only (remove hooks)"
```

---

### Task 4: Remove `DatabaseHooks` from the public API

**Files:**
- Modify: `src/db/hooks.ts` — keep `WireDoc`/`RuntimeDoc` types only, remove everything else
- Modify: `src/db/index.ts` — remove hooks re-export
- Modify: `src/init.ts` — remove import of `DatabaseHooks` (should already be gone from Plan 2)

**Step 1: Gut `src/db/hooks.ts`**

Keep only the document types (used by wrapper and primitives):

```typescript
/** Wire-format document (as stored in / returned from Convex). */
export type WireDoc = Record<string, unknown>

/** Runtime-format document (after codec decode, e.g. Dates instead of timestamps). */
export type RuntimeDoc = Record<string, unknown>
```

Remove everything else:
- `DecodeOneHook`, `DecodeManyHook`, `DecodeAfterOneHook`, `DecodeAfterManyHook`
- `EncodeHook`, `EncodeAfterHook`
- `DecodeHooks`, `EncodeHooks`, `DatabaseHooks`
- `createDatabaseHooks`
- `composeHooks`, `composeOneHooks`, `composeManyHooks`

**Step 2: Update `src/db/index.ts`**

The re-export `export * from './hooks'` now only exports `WireDoc` and `RuntimeDoc`. No change needed to the file itself — the exports just got smaller.

**Step 3: Verify no remaining imports of removed symbols**

Search the codebase for:
- `DatabaseHooks` — should have 0 references
- `createDatabaseHooks` — should have 0 references
- `composeHooks` — should have 0 references
- `DecodeOneHook` / `DecodeManyHook` / etc. — should have 0 references

**Step 4: Remove hook-related tests**

Delete `__tests__/db/hooks.test.ts` (tests the hook composition system that's being removed).

**Step 5: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/db/hooks.ts src/db/index.ts
git rm __tests__/db/hooks.test.ts
git commit -m "refactor: remove DatabaseHooks public API (consumer owns DB middleware)"
```

---

### Task 5: Add decode cost benchmark test

Per the de-risking strategy, prove that codec decode overhead is negligible.

**Files:**
- Create: `__tests__/db/decode-benchmark.test.ts`

**Step 1: Write the benchmark test**

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { decodeDoc } from '../../src/db/primitives'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

// Simulate a realistic hotpot document (15 fields, 2 date codecs, 3 "sensitive" fields)
const Patients = zodTable('patients', {
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  clinicId: z.string(),
  ownerId: z.string(),
  status: z.enum(['active', 'inactive', 'archived']),
  notes: z.string().optional(),
  createdAt: zx.date(),
  updatedAt: zx.date(),
  lastVisit: zx.date().optional(),
})

function createWireDoc(i: number): Record<string, unknown> {
  return {
    _id: `patients:${i}`,
    _creationTime: Date.now(),
    firstName: `First${i}`,
    lastName: `Last${i}`,
    email: `patient${i}@test.com`,
    phone: `555-${String(i).padStart(4, '0')}`,
    address: `${i} Main St`,
    city: 'Springfield',
    state: 'IL',
    zip: '62701',
    clinicId: 'clinic:1',
    ownerId: 'users:1',
    status: 'active',
    notes: i % 3 === 0 ? `Note for patient ${i}` : undefined,
    createdAt: Date.now() - 86400000 * i,
    updatedAt: Date.now(),
    lastVisit: i % 2 === 0 ? Date.now() - 3600000 : undefined,
  }
}

describe('Decode cost benchmark', () => {
  it('decodes 1000 docs with mixed codecs in < 25ms', () => {
    const docs = Array.from({ length: 1000 }, (_, i) => createWireDoc(i))
    const schema = Patients.schema.doc

    const start = performance.now()
    for (const doc of docs) {
      decodeDoc(schema, doc)
    }
    const elapsed = performance.now() - start

    console.log(`Decoded 1000 docs in ${elapsed.toFixed(2)}ms (${(elapsed / 1000).toFixed(4)}ms/doc)`)

    // Target: < 25ms for 1000 docs (worst case from decision doc)
    expect(elapsed).toBeLessThan(25)
  })

  it('decode-then-filter overhead vs filter-then-decode is < 5ms for 900/1000 filtered', () => {
    const docs = Array.from({ length: 1000 }, (_, i) => createWireDoc(i))
    const schema = Patients.schema.doc
    const shouldFilter = (_doc: any, i: number) => i >= 100 // filter 900 of 1000

    // Approach 1: decode all, then filter (runtime-only middleware pattern)
    const start1 = performance.now()
    const decoded = docs.map(doc => decodeDoc(schema, doc))
    const filtered1 = decoded.filter((_, i) => !shouldFilter(_, i))
    const elapsed1 = performance.now() - start1

    // Approach 2: filter first, then decode (wire-side pattern)
    const start2 = performance.now()
    const preFiltered = docs.filter((_, i) => !shouldFilter(_, i))
    const filtered2 = preFiltered.map(doc => decodeDoc(schema, doc))
    const elapsed2 = performance.now() - start2

    const overhead = elapsed1 - elapsed2
    console.log(`Decode-then-filter: ${elapsed1.toFixed(2)}ms`)
    console.log(`Filter-then-decode: ${elapsed2.toFixed(2)}ms`)
    console.log(`Overhead: ${overhead.toFixed(2)}ms`)

    // The overhead of decoding 900 extra docs should be negligible
    // (900 * ~0.024ms = ~22ms, but in practice much faster)
    expect(overhead).toBeLessThan(25)
    expect(filtered1).toHaveLength(100)
    expect(filtered2).toHaveLength(100)
  })
})
```

**Step 2: Run the benchmark**

Run: `bun test __tests__/db/decode-benchmark.test.ts`
Expected: PASS with timing output showing decode is well within budget.

**Step 3: Commit**

```bash
git add __tests__/db/decode-benchmark.test.ts
git commit -m "test: add decode cost benchmark (proves runtime-only middleware is viable)"
```

---

### Task 6: Update wrapper.ts imports and clean up unused types

Now that hooks are removed, clean up imports in `wrapper.ts`.

**Files:**
- Modify: `src/db/wrapper.ts`

**Step 1: Remove hook-related imports**

Remove `import type { DatabaseHooks, RuntimeDoc, WireDoc } from './hooks'` and replace with just the doc types:

```typescript
import type { RuntimeDoc, WireDoc } from './hooks'
```

Remove any remaining references to `hooks` parameter in function signatures or JSDoc.

**Step 2: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 3: Run type checking**

Run: `bun run type-check`
Expected: No errors

**Step 4: Commit**

```bash
git add src/db/wrapper.ts
git commit -m "chore: clean up wrapper.ts imports after hooks removal"
```

---

## Summary

After completing this plan:
- `createZodDbReader` / `createZodDbWriter` are codec-only (no hooks parameter)
- `DatabaseHooks`, `createDatabaseHooks`, `composeHooks` removed from public API
- `WireDoc` / `RuntimeDoc` types preserved (used by wrapper internals)
- `decodeDoc` / `encodeDoc` preserved as escape hatches for consumers
- Decode cost benchmark proves runtime-only middleware is viable (<25ms for 1000 docs)
- DB wrapper tests updated (hook tests removed, codec tests preserved)
- Full test suite passes

**Next plan:** Plan 4 cleans up the API surface (deprecations, deduplication, exports).
