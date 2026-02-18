# Plan 5: Full Integration Test + Hotpot Migration Guide

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write the full blessed-builder integration test (Priority 4 from the de-risking strategy) and create a migration guide for hotpot.

**Architecture:** This plan proves the entire v2 pipeline works end-to-end: `initZodvex` -> `zCustomQuery` with `customCtx` -> handler reads/writes with codec-aware db -> `onSuccess` audits with runtime types -> wire result to client. It also documents how hotpot migrates from the v1 API.

**Tech Stack:** TypeScript, Zod v4, Bun test runner, convex-helpers

**Prerequisite:** Plan 4 (API cleanup) must be complete.

**Prerequisite reading:**
- `docs/plans/2026-02-17-zodvex-v2-redesign.md` (all sections)
- `__tests__/integration/codec-pipeline.test.ts` (existing integration tests)
- `__tests__/codec-double-validation.test.ts` (SensitiveWrapper test pattern)

---

### Task 1: Write the full blessed-builder integration test

This is the capstone test that proves all 6 boundaries work correctly in a realistic hotpot-like scenario.

**Files:**
- Modify: `__tests__/integration/codec-pipeline.test.ts`

**Step 1: Write the full flow test**

Add a new describe block:

```typescript
describe('Full blessed-builder flow (hotpot-like scenario)', () => {
  // Simulate hotpot's SensitiveField codec
  const PRIVATE_VALUES = new WeakMap<any, unknown>()

  class SensitiveWrapper {
    public readonly status: 'full' | 'hidden'
    constructor(value: unknown, status: 'full' | 'hidden') {
      PRIVATE_VALUES.set(this, value)
      this.status = status
    }
    static full(value: unknown) { return new SensitiveWrapper(value, 'full') }
    static hidden() { return new SensitiveWrapper(null, 'hidden') }
    expose() {
      if (this.status === 'hidden') throw new Error('Cannot expose hidden')
      return PRIVATE_VALUES.get(this)
    }
    toWire() {
      return {
        value: this.status === 'full' ? PRIVATE_VALUES.get(this) : null,
        status: this.status
      }
    }
  }

  // Create sensitive codec (matches hotpot pattern)
  const sensitiveString = zx.codec(
    z.object({ value: z.string().nullable(), status: z.enum(['full', 'hidden']) }),
    z.custom<SensitiveWrapper>((val) => val instanceof SensitiveWrapper),
    {
      decode: (wire: any) => wire.status === 'hidden'
        ? SensitiveWrapper.hidden()
        : SensitiveWrapper.full(wire.value),
      encode: (runtime: SensitiveWrapper) => runtime.toWire()
    }
  )

  // Schema with mixed codecs
  const Patients = zodTable('patients', {
    name: z.string(),
    email: sensitiveString,
    clinicId: z.string(),
    createdAt: zx.date(),
  })

  const testSchema = defineZodSchema({
    events: Events,
    users: Users,
    patients: Patients,
  })

  it('full pipeline: initZodvex -> blessed builder -> codec db -> onSuccess audit -> wire result', async () => {
    const db = createMockDb()
    const auditLog: any[] = []

    // Seed wire-format data
    db.store['patients:1'] = {
      _id: 'patients:1',
      _creationTime: 1000,
      _table: 'patients',
      name: 'Jane Doe',
      email: { value: 'jane@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000,
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(testSchema, server as any)

    // Create a blessed builder (like hotpotQuery)
    const secureQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        const user = { id: 'user:1', clinicId: 'clinic:1', role: 'doctor' }

        // Consumer wraps codec-aware db with security
        const secureDb = {
          ...ctx.db,
          get: async (id: any) => {
            const doc = await ctx.db.get(id)
            if (!doc) return null
            // RLS: check clinic access
            if (doc.clinicId !== user.clinicId) return null
            return doc
          }
        }

        return {
          user,
          db: secureDb,
          onSuccess: ({ result }: any) => {
            // Audit logging — MUST see runtime types
            auditLog.push({
              userId: user.id,
              action: 'read',
              result,
            })
          }
        }
      })
    )

    // App developer uses the blessed builder
    const getPatient = secureQuery({
      args: { patientId: z.string() },
      returns: Patients.schema.doc.nullable(),
      handler: async (ctx: any, { patientId }: any) => {
        return ctx.db.get(patientId)
      }
    })

    const wireResult = await getPatient._invoke({ patientId: 'patients:1' })

    // --- Verify all 6 boundaries ---

    // Boundary 3 (wire -> runtime args): patientId was a string, parsed as string ✓
    // (Trivial for this test — string args don't have codec transforms)

    // Boundary 5 (DB read decode): handler received runtime types
    // (Verified via audit log — onSuccess sees what handler returned)

    // Boundary 4 (runtime -> wire returns): wire result has encoded values
    expect(wireResult).not.toBeNull()
    expect(typeof wireResult.createdAt).toBe('number') // Date -> timestamp
    expect(wireResult.createdAt).toBe(1700000000000)
    expect(wireResult.email).toEqual({ value: 'jane@example.com', status: 'full' }) // SensitiveWrapper -> wire

    // onSuccess saw runtime types (Date, SensitiveWrapper)
    expect(auditLog).toHaveLength(1)
    const auditEntry = auditLog[0]
    expect(auditEntry.userId).toBe('user:1')
    expect(auditEntry.result.createdAt).toBeInstanceOf(Date)
    expect(auditEntry.result.createdAt.getTime()).toBe(1700000000000)
    expect(auditEntry.result.email).toBeInstanceOf(SensitiveWrapper)
    expect(auditEntry.result.email.status).toBe('full')
    expect(auditEntry.result.email.expose()).toBe('jane@example.com')
  })

  it('full pipeline: mutation with codec-aware writes', async () => {
    const db = createMockDb()
    const server = createMockServer(db)
    const { zCustomMutation } = initZodvex(testSchema, server as any)

    const secureMutation = zCustomMutation(
      customCtx(async (ctx: any) => {
        return { user: { id: 'user:1' } }
      })
    )

    const createPatient = secureMutation({
      args: {
        name: z.string(),
        email: sensitiveString,
        clinicId: z.string(),
        createdAt: zx.date(),
      },
      handler: async (ctx: any, args: any) => {
        // Args are decoded: createdAt is a Date, email is SensitiveWrapper
        expect(args.createdAt).toBeInstanceOf(Date)
        expect(args.email).toBeInstanceOf(SensitiveWrapper)

        // ctx.db.insert encodes runtime -> wire automatically
        return ctx.db.insert('patients', args)
      }
    })

    const id = await createPatient._invoke({
      name: 'John',
      email: { value: 'john@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000, // wire format (timestamp)
    })

    // Verify wire format in DB
    const stored = db.store[id]
    expect(stored.name).toBe('John')
    expect(typeof stored.createdAt).toBe('number') // encoded back to timestamp
    expect(stored.email).toEqual({ value: 'john@example.com', status: 'full' }) // encoded back to wire
  })

  it('RLS filtering works with codec-aware db', async () => {
    const db = createMockDb()
    db.store['patients:1'] = {
      _id: 'patients:1',
      _creationTime: 1000,
      _table: 'patients',
      name: 'Jane',
      email: { value: 'jane@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000,
    }
    db.store['patients:2'] = {
      _id: 'patients:2',
      _creationTime: 2000,
      _table: 'patients',
      name: 'Bob',
      email: { value: 'bob@example.com', status: 'full' },
      clinicId: 'clinic:2', // different clinic
      createdAt: 1700100000000,
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(testSchema, server as any)

    // User belongs to clinic:1
    const secureQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        const user = { id: 'user:1', clinicId: 'clinic:1' }
        return {
          user,
          db: {
            ...ctx.db,
            get: async (id: any) => {
              const doc = await ctx.db.get(id)
              if (!doc) return null
              if (doc.clinicId !== user.clinicId) return null
              return doc
            }
          }
        }
      })
    )

    const getPatient = secureQuery({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => ctx.db.get(id)
    })

    // Can access own clinic's patient
    const result1 = await getPatient._invoke({ id: 'patients:1' })
    expect(result1).not.toBeNull()
    expect(result1.name).toBe('Jane')

    // Cannot access other clinic's patient
    const result2 = await getPatient._invoke({ id: 'patients:2' })
    expect(result2).toBeNull()
  })
})
```

**Step 2: Run the integration tests**

Run: `bun test __tests__/integration/codec-pipeline.test.ts`
Expected: All pass

**Step 3: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add __tests__/integration/codec-pipeline.test.ts
git commit -m "test: full blessed-builder integration test with SensitiveWrapper + RLS"
```

---

### Task 2: Write the hotpot migration guide

Document exactly how hotpot migrates from v1 to v2. This is a reference for the hotpot team.

**Files:**
- Create: `docs/guides/hotpot-migration-v2.md`

**Step 1: Write the migration guide**

```markdown
# Hotpot Migration Guide: zodvex v1 -> v2

## Overview

zodvex v2 simplifies the API by:
1. Using convex-helpers' `customCtx` directly (no zodvex wrappers)
2. Moving `onSuccess` before Zod encode (sees runtime types)
3. Removing DB hooks from zodvex (consumer owns DB middleware)
4. Fixing the Zod validation gap in `initZodvex` builders

## Migration Table

| v1 Usage | v2 Replacement |
|----------|---------------|
| `zCustomQueryBuilder(query, customization)` | `zCustomQuery(query, customization)` (rename) |
| `zCustomMutationBuilder(mutation, customization)` | `zCustomMutation(mutation, customization)` (rename) |
| `zCustomActionBuilder(action, customization)` | `zCustomAction(action, customization)` (rename) |
| `customCtxWithHooks(fn)` | `customCtx(fn)` from convex-helpers |
| `transforms.output` (audit logging) | `onSuccess` in `customCtx` return |
| `transforms.input` (arg transforms) | Transform args in `customCtx` `input()` |
| `createDatabaseHooks({...})` | Write wrapper functions (Convex's `wrapDatabaseReader` pattern) |
| `composeHooks([...])` | Compose wrapper functions manually |
| `zCustomCtx(fn)` | `customCtx(fn)` from convex-helpers |
| `zq.withContext(ctx)` | `zCustomQuery(customization)` from `initZodvex` |
| `zq.withContext(ctx).withHooks(hooks)` | `zCustomQuery(customization)` with db wrapping in `customCtx` |

## Before / After Examples

### Blessed Builder with Auth

**Before (v1):**
```typescript
import { zCustomQueryBuilder, customCtxWithHooks } from 'zodvex/server'

const hotpotQuery = zCustomQueryBuilder(
  query,
  customCtxWithHooks(async (ctx: QueryCtx) => {
    const user = await getUser(ctx)
    return {
      ctx: { user },
      hooks: { onSuccess: ({ result }) => auditLog(result, user) },
      transforms: { output: (result) => sanitizeForAudit(result) }
    }
  })
)
```

**After (v2):**
```typescript
import { customCtx } from 'convex-helpers/server/customFunctions'
// Option A: via initZodvex
const { zCustomQuery } = initZodvex(schema, server)
const hotpotQuery = zCustomQuery(
  customCtx(async (ctx) => {
    const user = await getUser(ctx)
    return {
      user,
      onSuccess: ({ result }) => {
        // result contains Date instances, SensitiveWrapper, etc.
        auditLog(result, user)
      }
    }
  })
)

// Option B: standalone
import { zCustomQuery } from 'zodvex/server'
const hotpotQuery = zCustomQuery(
  query,
  customCtx(async (ctx) => { ... })
)
```

### DB Security Wrapping

**Before (v1):**
```typescript
const hooks = createDatabaseHooks({
  decode: {
    before: {
      one: async (ctx, wireDoc) => {
        if (!checkRLS(wireDoc, ctx.user)) return null
        return wireDoc
      }
    }
  }
})
const secureQuery = zq.withContext(authCtx).withHooks(hooks)
```

**After (v2):**
```typescript
const secureQuery = zCustomQuery(
  customCtx(async (ctx) => {
    const user = await getUser(ctx)
    // ctx.db is already codec-aware (returns Date, SensitiveWrapper, etc.)
    const secureDb = createSecureReader({ user }, ctx.db, securityRules)
    return { user, db: secureDb }
  })
)
```

### SensitiveField in onSuccess

**Before (v1):**
```typescript
transforms: {
  output: (result, schema) => {
    // Had to use transforms.output because onSuccess ran AFTER encode
    const sensitive = findSensitiveFields(result)
    logSensitiveAccess(sensitive)
    return result
  }
}
```

**After (v2):**
```typescript
onSuccess: ({ result }) => {
  // result.email is a SensitiveWrapper instance
  if (result.email instanceof SensitiveWrapper) {
    logSensitiveAccess(result.email.field, result.email.status)
  }
}
```

## Key Behavioral Changes

1. **`onSuccess` timing:** Now runs BEFORE Zod encode. `result` contains runtime types.
2. **`ctx.db` in customCtx:** Already codec-aware. Reads return Date, SensitiveWrapper, etc.
3. **No hooks API:** Write wrapper functions around `ctx.db` for security.
4. **Zod validation works:** `initZodvex` builders now validate args and encode returns.
```

**Step 2: Commit**

```bash
git add docs/guides/hotpot-migration-v2.md
git commit -m "docs: hotpot migration guide for zodvex v2"
```

---

### Task 3: Update `__tests__/transform-output.test.ts` for deprecation

If this test file exists and tests `transforms.output`, update it to expect the deprecation warning.

**Files:**
- Modify: `__tests__/transform-output.test.ts`

**Step 1: Read the test file**

Read `__tests__/transform-output.test.ts` to understand what it tests.

**Step 2: Add deprecation warning expectation**

If the test uses `transforms.output`, add a `console.warn` capture to verify the deprecation message fires. Don't break the test — just verify the warning appears alongside the existing behavior.

**Step 3: Run the test**

Run: `bun test __tests__/transform-output.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add __tests__/transform-output.test.ts
git commit -m "test: add deprecation warning checks for transforms.output tests"
```

---

### Task 4: Run the full verification suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All pass

**Step 2: Run type checking**

Run: `bun run type-check`
Expected: No errors

**Step 3: Run linting**

Run: `bun run lint`
Expected: Clean (or only pre-existing issues)

**Step 4: Run the build**

Run: `bun run build`
Expected: Builds successfully

**Step 5: Verify test count**

Count the total number of test cases. There should be more tests than before the v2 work started (new de-risking + integration tests).

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore: final v2 verification — all tests, types, lint, build pass"
```

---

## Summary

After completing this plan:
- Full blessed-builder integration test proves all 6 boundaries work
- SensitiveWrapper codec flow tested end-to-end (hotpot's core use case)
- RLS filtering with codec-aware DB tested
- Mutation with codec-aware writes tested
- Hotpot migration guide created with before/after examples
- `transforms.output` test updated for deprecation
- Full verification: tests, types, lint, build all pass

**This completes the zodvex v2 redesign implementation.**

Future work (not in these plans):
- Codegen: validator registry + `_generated/zodvex/` output
- Client-safe model definitions (the `zodTable()` / `defineTable()` issue)
- Evaluate `zodvex/transform` package post-migration
- Remove deprecated exports in a future major version
