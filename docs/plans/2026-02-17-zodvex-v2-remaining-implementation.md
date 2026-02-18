# zodvex v2: Remaining Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the v2 redesign by implementing every item from the design doc (`docs/plans/2026-02-17-zodvex-v2-redesign.md`) that is currently missing or broken.

**Architecture:** zodvex v2's identity is a codec boundary layer. The core promise is that `customFnBuilder` works with convex-helpers' native `Customization` type — including `onSuccess` — without any zodvex wrapper types. The previous implementation attempt fixed pipeline ordering and DB codecs but missed the bridge between convex-helpers' `onSuccess` convention and zodvex's pipeline, left Tier 2 builders without `{ zodTables }`, and skipped `__zodvexMeta` function decoration.

**Tech Stack:** TypeScript, Zod v4, Bun test runner, convex-helpers

**Design doc:** `docs/plans/2026-02-17-zodvex-v2-redesign.md`

---

## Traceability Matrix

Every design doc section mapped to a task in this plan. If an item is already implemented correctly, it's marked "DONE" with no task.

| Design Doc Section | Item | Status | Task |
|---|---|---|---|
| **Identity / What zodvex owns** | Codec primitives (`zx.*`) | DONE | — |
| | Schema definition (`zodTable`, `defineZodSchema`) | DONE | — |
| | Zod->Convex validator mapping | DONE | — |
| | Codec-aware DB wrapper (boundaries 5,6) | DONE | — |
| | Zod pipeline for function args/returns (boundaries 3,4) | DONE (but onSuccess broken) | Task 1 |
| | Codegen + validator registry (boundaries 1,2) | NOT DONE | Task 5 |
| **API Surface / Tier 1** | `initZodvex` returns builders | DONE (returns 9; doc shows 6 — the 3 internal variants are a correct addition) | — |
| | `zCustomQuery` from initZodvex takes 1 arg (customization only) | DONE | — |
| | Blessed builder example uses native `onSuccess` | BROKEN — `customFnBuilder` ignores `added.onSuccess` | Task 1 |
| **API Surface / Tier 2** | `zQueryBuilder(query, { zodTables })` with codec-aware DB | NOT DONE — no `{ zodTables }` parameter | Task 3 |
| | `zCustomQueryBuilder(query, customization, { zodTables })` | NOT DONE | Task 3 |
| **API Surface / Tier 3** | `zQuery(query, { args, returns, handler })` config-object API | NOT DONE — still positional `(query, args, handler, opts)` | Task 4 |
| **Pipeline Design** | Steps 1-4, 6-8 (validation, handler, encode, strip) | DONE | — |
| | Step 5: `onSuccess` runs before encode | Ordering DONE, but only `hooks.onSuccess` path works | Task 1 |
| | `customFnBuilder` accepts convex-helpers' `Customization` directly | Type accepts it, but `onSuccess` dropped | Task 1 |
| **Pipeline / What's eliminated** | `transforms.input` deprecated with runtime warning | DONE (once-per-process) | — |
| | `transforms.output` deprecated with runtime warning | DONE (once-per-process) | — |
| | `CustomizationWithHooks` type eliminated | NOT DONE — still in `customFnBuilder` union | Task 2 |
| | `customCtxWithHooks()` deprecated | DONE (`@deprecated` JSDoc) | — |
| **Database Codec Layer** | `createZodDbReader` / `createZodDbWriter` | DONE | — |
| | `decodeDoc` / `encodeDoc` escape hatches | DONE | — |
| | `RuntimeDoc` / `WireDoc` types exported | DONE | — |
| | `CodecDatabaseReader` / `CodecDatabaseWriter` named types | NOT DONE | Task 3 |
| **Database / What's removed** | `createDatabaseHooks`, `composeHooks`, `DatabaseHooks` | DONE (removed) | — |
| | `src/db/hooks.ts` public API | DONE (file removed) | — |
| **Schema, Codecs & Codegen** | Schema definition, codec primitives | DONE | — |
| | `__zodvexMeta` function decoration | NOT DONE | Task 5 |
| | Codegen: validator registry (`_generated/zodvex/`) | NOT DONE | Task 5 |
| | Open item: client-safe model definitions | EXPLORE during Task 5 | Task 5 |
| **Migration / What gets deprecated** | `zCustomQueryBuilder` -> `zCustomQuery` | DONE (`@deprecated`) | — |
| | `zCustomMutationBuilder` -> `zCustomMutation` | DONE (`@deprecated`) | — |
| | `zCustomActionBuilder` -> `zCustomAction` | DONE (`@deprecated`) | — |
| | `customCtxWithHooks()` -> `customCtx()` | DONE (`@deprecated`) | — |
| | `zCustomCtx()` -> `customCtx()` | N/A — never existed | — |
| | `zCustomCtxWithArgs()` -> `customCtxAndArgs()` | N/A — never existed | — |
| **Migration / What gets removed** | `CustomizationWithHooks` type | NOT DONE — still exported and used | Task 2 |
| | `CustomizationHooks` type | NOT DONE — still exported and used | Task 2 |
| | `CustomizationTransforms` type | NOT DONE — still exported and used | Task 2 |
| | `CustomizationResult` type | NOT DONE — still exported, no `@deprecated` | Task 2 |
| | `CustomizationInputResult` type | NOT DONE — still exported, no `@deprecated` | Task 2 |
| | `buildHandler()` | DONE (removed/never existed) | — |
| **De-risking / Priority 1** | `onSuccess` sees runtime types (Date) | Test exists but uses deprecated path | Task 1 |
| | `onSuccess` sees SensitiveWrapper instances | Test exists but uses deprecated path | Task 1 |
| | `onSuccess` has closure access | Test exists but uses deprecated path | Task 1 |
| **De-risking / Priority 2** | DB reads return runtime types | DONE | — |
| | DB writes accept runtime types | DONE | — |
| | Consumer wrapper composes on codec db | DONE | — |
| **De-risking / Priority 3** | Decode cost benchmark (<25ms for 1000 docs) | DONE | — |
| **De-risking / Priority 4** | Full blessed-builder flow integration test | Test exists but uses deprecated `hooks.onSuccess` path | Task 1 |
| **Post-migration** | Evaluate `zodvex/transform` package | NOT DONE | Task 6 |

---

## Task 1: Wire up native `onSuccess` in `customFnBuilder`

This is the single most important task. The design doc says zodvex accepts convex-helpers' `Customization` directly. convex-helpers' `input()` returns `{ ctx, args, onSuccess? }` — top-level `onSuccess`. zodvex's `customFnBuilder` currently only checks `added?.hooks?.onSuccess` (the deprecated path). This task fixes that and proves it with tests that use the **native convex-helpers convention**.

**Reference:** convex-helpers' `customFunctions.js` lines 266, 284 check `added.onSuccess`. convex-helpers' `Customization` type (`customFunctions.d.ts` lines 55-71) defines `onSuccess` as a top-level property of the `input()` return.

**Files:**
- Modify: `src/custom.ts` (lines 374-385, 439-449 — the two onSuccess check sites)
- Create: `__tests__/native-onSuccess.test.ts`
- Modify: `__tests__/integration/codec-pipeline.test.ts` (update integration test to use native path)

### Checkpoint: show me `__tests__/native-onSuccess.test.ts` and the diff to `src/custom.ts` before committing.

**Step 1: Write failing tests for native `onSuccess`**

Create `__tests__/native-onSuccess.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { zx } from '../src/zx'

// Minimal builder stub that mimics Convex builder
function makeBuilder() {
  return function builder(config: {
    args?: any
    returns?: any
    handler: (ctx: any, args: any) => any
  }) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

describe('Native onSuccess (convex-helpers Customization convention)', () => {
  it('fires onSuccess returned at top level from input() — with args', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    // This is the convex-helpers native shape — onSuccess at top level, NOT nested in hooks
    const customization = {
      args: {},
      input: async (_ctx: any) => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          onSuccessResult = result
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => {
        return { when: args.when }
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    await fn({}, { when: timestamp })

    // onSuccess MUST fire and see runtime types (Date, not timestamp)
    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.when).toBeInstanceOf(Date)
    expect(onSuccessResult.when.getTime()).toBe(timestamp)
  })

  it('fires onSuccess returned at top level from input() — without args', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    const customization = {
      args: {},
      input: async (_ctx: any) => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          onSuccessResult = result
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      // No args schema
      handler: async () => ({ name: 'test' })
    }) as any

    await fn({}, {})

    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.name).toBe('test')
  })

  it('onSuccess sees runtime types before Zod encode (SensitiveWrapper)', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    const PRIVATE_VALUES = new WeakMap<any, unknown>()

    class SensitiveWrapper {
      public readonly status: 'full' | 'hidden'
      constructor(value: unknown, status: 'full' | 'hidden') {
        PRIVATE_VALUES.set(this, value)
        this.status = status
      }
      static full(value: unknown) { return new SensitiveWrapper(value, 'full') }
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

    const sensitiveString = zx.codec(
      z.object({ value: z.string().nullable(), status: z.enum(['full', 'hidden']) }),
      z.custom<SensitiveWrapper>((val) => val instanceof SensitiveWrapper),
      {
        decode: (wire: any) =>
          wire.status === 'hidden'
            ? new SensitiveWrapper(null, 'hidden')
            : SensitiveWrapper.full(wire.value),
        encode: (runtime: SensitiveWrapper) => runtime.toWire()
      }
    )

    const customization = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          onSuccessResult = result
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      args: {},
      returns: z.object({ email: sensitiveString }),
      handler: async () => {
        return { email: SensitiveWrapper.full('user@example.com') }
      }
    }) as any

    const wireResult = await fn({}, {})

    // onSuccess sees SensitiveWrapper instance
    expect(onSuccessResult.email).toBeInstanceOf(SensitiveWrapper)
    expect(onSuccessResult.email.expose()).toBe('user@example.com')

    // Wire result is plain object (encoded)
    expect(wireResult.email).toEqual({ value: 'user@example.com', status: 'full' })
    expect(wireResult.email).not.toBeInstanceOf(SensitiveWrapper)
  })

  it('onSuccess has closure access to resources created in input()', async () => {
    const builder = makeBuilder()
    let auditLogEntry: any = null

    const customization = {
      args: {},
      input: async (_ctx: any) => {
        const user = { id: 'user-1', name: 'Admin' }
        return {
          ctx: { user },
          args: {},
          onSuccess: ({ result }: any) => {
            auditLogEntry = { userId: user.id, result }
          }
        }
      }
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      args: { id: z.string() },
      returns: z.object({ name: z.string() }),
      handler: async (_ctx: any, { id }: any) => {
        return { name: `Patient ${id}` }
      }
    }) as any

    await fn({}, { id: 'p-1' })

    expect(auditLogEntry).not.toBeNull()
    expect(auditLogEntry.userId).toBe('user-1')
    expect(auditLogEntry.result.name).toBe('Patient p-1')
  })

  it('onSuccess receives augmented ctx', async () => {
    const builder = makeBuilder()
    let onSuccessCtx: any = null

    const customization = {
      args: {},
      input: async (_ctx: any) => ({
        ctx: { user: { id: 'user-1' }, permissions: ['read', 'write'] },
        args: {},
        onSuccess: ({ ctx: successCtx }: any) => {
          onSuccessCtx = successCtx
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      args: {},
      handler: async (ctx: any) => {
        expect(ctx.user.id).toBe('user-1')
        return 'ok'
      }
    }) as any

    await fn({ baseField: true }, {})

    expect(onSuccessCtx).not.toBeNull()
    expect(onSuccessCtx.user.id).toBe('user-1')
    expect(onSuccessCtx.permissions).toEqual(['read', 'write'])
    expect(onSuccessCtx.baseField).toBe(true)
  })

  it('deprecated hooks.onSuccess still works (backward compat)', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    // Deprecated path — hooks.onSuccess nested
    const customization = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        hooks: {
          onSuccess: ({ result }: any) => {
            onSuccessResult = result
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      args: { name: z.string() },
      handler: async (_ctx: any, { name }: any) => ({ name })
    }) as any

    await fn({}, { name: 'test' })

    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.name).toBe('test')
  })
})
```

**Step 2: Run the tests — verify they fail**

Run: `bun test __tests__/native-onSuccess.test.ts`
Expected: The native `onSuccess` tests FAIL (onSuccessResult is null). The deprecated `hooks.onSuccess` test PASSES.

**Step 3: Fix `customFnBuilder` to handle native `onSuccess`**

In `src/custom.ts`, find the two `onSuccess` check sites. Each needs to check BOTH `added?.onSuccess` (native convex-helpers) and `added?.hooks?.onSuccess` (deprecated zodvex path).

**With-args path** (around line 378):

Replace:
```typescript
          // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
          if (added?.hooks?.onSuccess) {
            await added.hooks.onSuccess({
              ctx: finalCtx,
              args: parsed.data,
              result: ret
            })
          }
```

With:
```typescript
          // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
          // Check native convex-helpers path (added.onSuccess) first, then deprecated path
          const onSuccess = added?.onSuccess ?? added?.hooks?.onSuccess
          if (onSuccess) {
            await onSuccess({
              ctx: finalCtx,
              args: parsed.data,
              result: ret
            })
          }
```

**No-args path** (around line 443):

Replace:
```typescript
        // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
        if (added?.hooks?.onSuccess) {
          await added.hooks.onSuccess({
            ctx: finalCtx,
            args: allArgs,
            result: ret
          })
        }
```

With:
```typescript
        // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
        const onSuccess = added?.onSuccess ?? added?.hooks?.onSuccess
        if (onSuccess) {
          await onSuccess({
            ctx: finalCtx,
            args: allArgs,
            result: ret
          })
        }
```

**Step 4: Run the native onSuccess tests — verify they pass**

Run: `bun test __tests__/native-onSuccess.test.ts`
Expected: ALL PASS — both native and deprecated paths work.

**Step 5: Update the integration test to use native `onSuccess`**

In `__tests__/integration/codec-pipeline.test.ts`, find the "blessed builder with onSuccess audit" test (around line 282-309). Change it from the deprecated `hooks.onSuccess` path to the native convex-helpers path.

Replace the return object from `input()`:
```typescript
        return {
          ctx: { user, db: secureDb },
          args: {},
          hooks: {
            onSuccess: ({ result }: any) => {
              auditLog.push({ userId: user.id, action: 'read', result })
            }
          }
        }
```

With the native convex-helpers shape:
```typescript
        return {
          ctx: { user, db: secureDb },
          args: {},
          onSuccess: ({ result }: any) => {
            auditLog.push({ userId: user.id, action: 'read', result })
          }
        }
```

**Step 6: Run the integration test — verify it passes**

Run: `bun test __tests__/integration/codec-pipeline.test.ts`
Expected: PASS — the integration test now uses the native path and still works.

**Step 7: Run the full test suite**

Run: `bun test`
Expected: All pass. The existing `hooks.onSuccess` tests in `__tests__/pipeline-ordering.test.ts` should still pass (backward compat).

**Step 8: Commit**

```bash
git add __tests__/native-onSuccess.test.ts src/custom.ts __tests__/integration/codec-pipeline.test.ts
git commit -m "fix: wire up native convex-helpers onSuccess in customFnBuilder

customFnBuilder now checks added.onSuccess (convex-helpers' native
Customization convention) in addition to added?.hooks?.onSuccess
(deprecated zodvex path). This is the core promise of v2: standard
Customization from convex-helpers works directly."
```

---

## Task 2: Remove deprecated zodvex wrapper types from `customFnBuilder`

With native `onSuccess` working (Task 1), the deprecated `CustomizationWithHooks` type and its supporting types are no longer needed in `customFnBuilder`'s union. This task removes them from the internal signature while keeping the deprecated exports for backward compat.

**Files:**
- Modify: `src/custom.ts`
- Modify: `__tests__/exports.test.ts`

### Checkpoint: show me the diff to `src/custom.ts` before committing.

**Step 1: Remove `CustomizationWithHooks` from `customFnBuilder` signature**

In `src/custom.ts`, find the `customFnBuilder` function signature (around line 286-288):

Replace:
```typescript
  customization:
    | Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
    | CustomizationWithHooks<Ctx, CustomCtx, CustomMadeArgs, ExtraArgs>
```

With:
```typescript
  customization: Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
```

**Step 2: Remove the `hooks` check from the deprecated transform paths**

The `added?.hooks?.onSuccess` fallback from Task 1 will still fire if someone passes `hooks` inside their `input()` return (since `??` falls through to it). No code change needed — the fallback is forward-compatible.

However, check if the `added?.transforms?.input` and `added?.transforms?.output` checks still compile. These properties aren't on convex-helpers' `Customization` type, but they're accessed via `any` casts in the handler. They should still work at runtime for consumers who haven't migrated yet.

**Step 3: Add `@deprecated` to `CustomizationResult` and `CustomizationInputResult`**

These two types are missing `@deprecated` annotations. Add them:

```typescript
/**
 * @deprecated Use convex-helpers' `Customization` type directly.
 * The `hooks` and `transforms` properties are no longer needed.
 */
export type CustomizationResult<...> = { ... }

/**
 * @deprecated Use convex-helpers' `Customization` type directly.
 */
export type CustomizationInputResult<...> = { ... }
```

**Step 4: Update exports test**

In `__tests__/exports.test.ts`, update the "does NOT export removed symbols" test to verify the types are still accessible (they're deprecated, not removed — removal happens in a future major version):

No change needed if the test already doesn't check for these types. Just verify the existing tests still pass.

**Step 5: Run the full test suite**

Run: `bun test`
Expected: All pass.

**Step 6: Run type checking**

Run: `bun run type-check`
Expected: Clean. If any internal code references `CustomizationWithHooks` in type positions that break, fix those usages.

**Step 7: Commit**

```bash
git add src/custom.ts __tests__/exports.test.ts
git commit -m "refactor: remove CustomizationWithHooks from customFnBuilder signature

customFnBuilder now accepts only convex-helpers' Customization type.
The deprecated types (CustomizationWithHooks, CustomizationHooks, etc.)
remain exported for backward compat but are no longer in the internal
function signature."
```

---

## Task 3: Add `{ zodTables }` to Tier 2 builders + export `CodecDatabaseReader`/`Writer` types

The design doc shows Tier 2 builders accepting an optional `{ zodTables }` parameter for codec-aware DB wrapping without `initZodvex`. This task also adds the named `CodecDatabaseReader`/`CodecDatabaseWriter` types from the design doc's export table.

**Files:**
- Modify: `src/builders.ts` (add `{ zodTables }` option to `zQueryBuilder`, `zMutationBuilder`)
- Modify: `src/db/wrapper.ts` (export `CodecDatabaseReader`/`CodecDatabaseWriter` types)
- Modify: `src/db/index.ts` (verify re-exports)
- Create: `__tests__/builders-codec.test.ts`
- Modify: `__tests__/exports.test.ts`

### Checkpoint: show me the new test file and the `builders.ts` diff before committing.

**Step 1: Write failing tests for Tier 2 `{ zodTables }` option**

Create `__tests__/builders-codec.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zQueryBuilder, zMutationBuilder } from '../src/builders'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date()
})

const zodTables = { events: Events }

// Mock Convex builder
function makeQueryBuilder() {
  return function builder(config: any) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

function makeMutationBuilder() {
  return function builder(config: any) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

// Mock Convex db
function createMockDb() {
  const store: Record<string, any> = {}
  return {
    store,
    get: async (id: string) => store[id] ?? null,
    query: (table: string) => {
      const docs = Object.values(store).filter((d: any) => d._table === table)
      let chain: any
      chain = {
        withIndex: () => chain,
        filter: () => chain,
        order: () => chain,
        collect: async () => docs,
        first: async () => docs[0] ?? null,
        unique: async () => (docs.length === 1 ? docs[0] : null),
        take: async (n: number) => docs.slice(0, n)
      }
      return chain
    },
    insert: async (table: string, doc: any) => {
      const id = `${table}:${Object.keys(store).length}`
      store[id] = { _id: id, _creationTime: Date.now(), _table: table, ...doc }
      return id
    },
    patch: async (id: string, patch: any) => {
      store[id] = { ...store[id], ...patch }
    },
    delete: async (id: string) => {
      delete store[id]
    }
  }
}

describe('Tier 2 builders with { zodTables }', () => {
  it('zQueryBuilder with zodTables wraps ctx.db for codec-aware reads', async () => {
    const zq = zQueryBuilder(makeQueryBuilder() as any, { zodTables })

    const getEvent = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        return ctx.db.get(id)
      }
    })

    const mockDb = createMockDb()
    mockDb.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000
    }

    const result = await (getEvent as any)({ db: mockDb }, { id: 'events:1' })

    expect(result).not.toBeNull()
    expect(result.startDate).toBeInstanceOf(Date)
    expect(result.startDate.getTime()).toBe(1700000000000)
  })

  it('zQueryBuilder WITHOUT zodTables does NOT wrap ctx.db', async () => {
    const zq = zQueryBuilder(makeQueryBuilder() as any)

    const getEvent = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        return ctx.db.get(id)
      }
    })

    const mockDb = createMockDb()
    mockDb.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000
    }

    const result = await (getEvent as any)({ db: mockDb }, { id: 'events:1' })

    // No codec wrapping — raw Convex behavior
    expect(result).not.toBeNull()
    expect(typeof result.startDate).toBe('number')
  })

  it('zMutationBuilder with zodTables wraps ctx.db for codec-aware writes', async () => {
    const zm = zMutationBuilder(makeMutationBuilder() as any, { zodTables })

    const createEvent = zm({
      args: { title: z.string(), startDate: zx.date() },
      handler: async (ctx: any, args: any) => {
        // args.startDate is a Date after Zod parse
        expect(args.startDate).toBeInstanceOf(Date)
        return ctx.db.insert('events', args)
      }
    })

    const mockDb = createMockDb()

    const id = await (createEvent as any)(
      { db: mockDb },
      { title: 'Meeting', startDate: 1700000000000 }
    )

    // Verify wire format in store
    const stored = mockDb.store[id]
    expect(stored.title).toBe('Meeting')
    expect(typeof stored.startDate).toBe('number') // encoded back
  })
})
```

**Step 2: Run tests — verify they fail**

Run: `bun test __tests__/builders-codec.test.ts`
Expected: FAIL — `zQueryBuilder` doesn't accept a second argument.

**Step 3: Add `{ zodTables }` option to `zQueryBuilder`**

In `src/builders.ts`, update `zQueryBuilder` to accept an optional second argument:

```typescript
export function zQueryBuilder<Builder extends (fn: any) => any>(
  builder: Builder,
  options?: { zodTables?: ZodTableMap }
) {
  return <...>(config: { ... }) => {
    if (options?.zodTables) {
      // Wrap handler to inject codec-aware db
      const innerHandler = config.handler
      const wrappedHandler = async (ctx: any, args: any) => {
        const codecDb = createZodDbReader(ctx.db, options.zodTables!)
        return innerHandler({ ...ctx, db: codecDb }, args)
      }
      return zQuery(builder, config.args ?? ({} as any), wrappedHandler, {
        returns: config.returns
      }) as any
    }
    return zQuery(builder, config.args ?? ({} as any), config.handler, {
      returns: config.returns
    }) as any
  }
}
```

Do the same for `zMutationBuilder` (use `createZodDbWriter`) and `zActionBuilder` (no DB wrapping — actions don't have `ctx.db`).

Add the necessary imports at the top of `builders.ts`:
```typescript
import { createZodDbReader, createZodDbWriter } from './db/wrapper'
import type { ZodTableMap } from './db/wrapper'  // you'll need to export this type
```

Note: `ZodTableMap` is currently a file-local type in `wrapper.ts`. Export it.

**Step 4: Export `CodecDatabaseReader` / `CodecDatabaseWriter` types**

In `src/db/wrapper.ts`, add these named types based on the return types of the factory functions:

```typescript
/** Type of the codec-aware database reader returned by createZodDbReader. */
export type CodecDatabaseReader = ReturnType<typeof createZodDbReader>

/** Type of the codec-aware database writer returned by createZodDbWriter. */
export type CodecDatabaseWriter = ReturnType<typeof createZodDbWriter>
```

**Step 5: Update exports test**

In `__tests__/exports.test.ts`, in the `zodvex/server exports` describe block, update the DB codec primitives test:

```typescript
it('exports DB codec primitives and types', async () => {
  const { decodeDoc, encodeDoc, createZodDbReader, createZodDbWriter } = await import(
    '../src/server'
  )
  expect(decodeDoc).toBeDefined()
  expect(encodeDoc).toBeDefined()
  expect(createZodDbReader).toBeDefined()
  expect(createZodDbWriter).toBeDefined()
  // CodecDatabaseReader, CodecDatabaseWriter, RuntimeDoc, WireDoc are type-only exports
  // verified by bun run type-check
})
```

**Step 6: Run tests — verify they pass**

Run: `bun test __tests__/builders-codec.test.ts`
Expected: PASS

**Step 7: Run the full test suite + type check**

Run: `bun test && bun run type-check`
Expected: All pass.

**Step 8: Commit**

```bash
git add src/builders.ts src/db/wrapper.ts __tests__/builders-codec.test.ts __tests__/exports.test.ts
git commit -m "feat: add { zodTables } option to Tier 2 builders + CodecDatabaseReader/Writer types

zQueryBuilder and zMutationBuilder now accept an optional { zodTables }
parameter for codec-aware DB wrapping without initZodvex. Also exports
CodecDatabaseReader and CodecDatabaseWriter named types."
```

---

## Task 4: Align Tier 3 raw wrapper API with design doc

The design doc shows `zQuery(query, { args, returns, handler })` — a config-object API. The current implementation uses `zQuery(query, args, handler, { returns })` — a positional API. This task adds the config-object overload while keeping the positional API for backward compat.

**Files:**
- Modify: `src/wrappers.ts`
- Create: `__tests__/wrappers-config-api.test.ts`

### Checkpoint: show me the test file and `wrappers.ts` changes before committing.

**Step 1: Write failing tests for config-object API**

Create `__tests__/wrappers-config-api.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zQuery, zMutation, zAction } from '../src/wrappers'
import { zx } from '../src/zx'

function makeBuilder() {
  return function builder(config: any) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

describe('Tier 3 config-object API: zQuery(builder, { args, returns, handler })', () => {
  it('zQuery accepts config object with args, returns, handler', async () => {
    const query = makeBuilder()

    const getEvent = zQuery(query as any, {
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, { when }: any) => {
        expect(when).toBeInstanceOf(Date)
        return { when }
      }
    })

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    const result = await (getEvent as any)({}, { when: timestamp })

    // Returns are encoded (Date -> timestamp)
    expect(typeof result.when).toBe('number')
    expect(result.when).toBe(timestamp)
  })

  it('zQuery config object works without returns', async () => {
    const query = makeBuilder()

    const getEvent = zQuery(query as any, {
      args: { name: z.string() },
      handler: async (_ctx: any, { name }: any) => ({ name })
    })

    const result = await (getEvent as any)({}, { name: 'test' })
    expect(result.name).toBe('test')
  })

  it('zMutation accepts config object', async () => {
    const mutation = makeBuilder()

    const create = zMutation(mutation as any, {
      args: { name: z.string() },
      handler: async (_ctx: any, { name }: any) => ({ created: name })
    })

    const result = await (create as any)({}, { name: 'test' })
    expect(result.created).toBe('test')
  })

  it('zAction accepts config object', async () => {
    const action = makeBuilder()

    const doThing = zAction(action as any, {
      args: { input: z.string() },
      handler: async (_ctx: any, { input }: any) => ({ output: input })
    })

    const result = await (doThing as any)({}, { input: 'test' })
    expect(result.output).toBe('test')
  })

  it('positional API still works (backward compat)', async () => {
    const query = makeBuilder()

    const getEvent = zQuery(query as any, { name: z.string() }, async (_ctx: any, { name }: any) => {
      return { name }
    })

    const result = await (getEvent as any)({}, { name: 'test' })
    expect(result.name).toBe('test')
  })
})
```

**Step 2: Run the tests — verify they fail**

Run: `bun test __tests__/wrappers-config-api.test.ts`
Expected: FAIL — `zQuery` doesn't accept a config object as second arg.

**Step 3: Add config-object overload to `zQuery`**

In `src/wrappers.ts`, add an overload that detects when the second argument is a config object (has a `handler` property) vs. a Zod schema / shape:

```typescript
export function zQuery<...>(
  query: Builder,
  inputOrConfig: A | { args?: A; returns?: R; handler: (...) => any; skipConvexValidation?: boolean },
  handler?: (...) => any,
  options?: { returns?: R }
) {
  // Detect config-object form
  if (inputOrConfig && typeof inputOrConfig === 'object' && 'handler' in inputOrConfig
      && !(inputOrConfig instanceof z.ZodType)) {
    const config = inputOrConfig as any
    return zQuery(query, config.args ?? ({} as any), config.handler, {
      returns: config.returns
    })
  }

  // Existing positional implementation...
}
```

Apply the same pattern to `zMutation` and `zAction`.

**Step 4: Run the tests — verify they pass**

Run: `bun test __tests__/wrappers-config-api.test.ts`
Expected: ALL PASS

**Step 5: Run the full test suite**

Run: `bun test`
Expected: All pass — no regressions on existing positional API usage.

**Step 6: Commit**

```bash
git add src/wrappers.ts __tests__/wrappers-config-api.test.ts
git commit -m "feat: add config-object overload to Tier 3 wrappers

zQuery, zMutation, zAction now accept zQuery(builder, { args, returns,
handler }) in addition to the existing positional API. Matches the
design doc's Tier 3 API surface."
```

---

## Task 5: `__zodvexMeta` function decoration + codegen foundation

The design doc specifies that builders from `initZodvex` attach `__zodvexMeta` to function exports for codegen discovery. This task implements the decoration and explores the client-safe model definition open item. The actual codegen CLI tool is NOT implemented here — just the metadata attachment that codegen would consume.

**Files:**
- Modify: `src/custom.ts` (attach `__zodvexMeta` in `customFnBuilder`)
- Create: `__tests__/zodvex-meta.test.ts`

### Checkpoint: show me the test file and `custom.ts` diff before committing.

**Step 1: Write failing tests for `__zodvexMeta`**

Create `__tests__/zodvex-meta.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { zx } from '../src/zx'

function makeBuilder() {
  return function builder(config: any) {
    const fn = async (ctx: any, args: any) => config.handler(ctx, args)
    return fn
  }
}

describe('__zodvexMeta function decoration', () => {
  it('attaches zodArgs and zodReturns to the returned function', () => {
    const builder = makeBuilder()
    const customization = {
      args: {},
      input: async () => ({ ctx: {}, args: {} })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const argsSchema = { id: z.string(), when: zx.date() }
    const returnsSchema = z.object({ name: z.string(), when: zx.date() })

    const fn = myBuilder({
      args: argsSchema,
      returns: returnsSchema,
      handler: async (_ctx: any, args: any) => args
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBe(argsSchema)
    expect(fn.__zodvexMeta.zodReturns).toBe(returnsSchema)
  })

  it('attaches metadata even without returns schema', () => {
    const builder = makeBuilder()
    const customization = {
      args: {},
      input: async () => ({ ctx: {}, args: {} })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const argsSchema = { name: z.string() }

    const fn = myBuilder({
      args: argsSchema,
      handler: async (_ctx: any, args: any) => args
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBe(argsSchema)
    expect(fn.__zodvexMeta.zodReturns).toBeUndefined()
  })

  it('attaches metadata for functions without args', () => {
    const builder = makeBuilder()
    const customization = {
      args: {},
      input: async () => ({ ctx: {}, args: {} })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)

    const fn = myBuilder({
      handler: async () => 'hello'
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBeUndefined()
    expect(fn.__zodvexMeta.zodReturns).toBeUndefined()
  })
})
```

**Step 2: Run tests — verify they fail**

Run: `bun test __tests__/zodvex-meta.test.ts`
Expected: FAIL — `fn.__zodvexMeta` is undefined.

**Step 3: Attach `__zodvexMeta` in `customFnBuilder`**

In `src/custom.ts`, in the `customBuilder` function (inside `customFnBuilder`), after the two `return builder(...)` calls, attach the metadata. The challenge is that `builder(...)` returns the Convex registration, which is what gets exported. We need to attach `__zodvexMeta` to that return value.

Find the two `return builder({...})` sites (with-args and no-args paths). Wrap each:

```typescript
    // With-args path:
    if (args) {
      // ... existing validation ...
      const registered = builder({ ... })
      ;(registered as any).__zodvexMeta = {
        zodArgs: fn.args,
        zodReturns: fn.returns
      }
      return registered
    }

    // No-args path:
    const registered = builder({ ... })
    ;(registered as any).__zodvexMeta = {
      zodArgs: undefined,
      zodReturns: fn.returns
    }
    return registered
```

Note: `fn.args` here is the original args validator from the consumer (the Zod schema, not the converted Convex validator). `fn.returns` is the original returns validator (may be undefined).

**Step 4: Run the tests — verify they pass**

Run: `bun test __tests__/zodvex-meta.test.ts`
Expected: ALL PASS

**Step 5: Explore client-safe model definitions**

This is the design doc's open item. `zodTable()` calls `defineTable()` which is server-only, making model files non-importable from client code. Read `src/tables.ts` and document findings:

1. Can `zodTable` be split into a client-safe part (Zod schema capture) and a server-only part (`defineTable` call)?
2. Would `defineZodModel()` (captures Zod schema without `defineTable()`) be a useful primitive?
3. What would the codegen input look like if model files are importable from client code?

Write findings as a brief comment block at the bottom of this plan file (not a separate doc).

**Step 6: Run the full test suite + type check**

Run: `bun test && bun run type-check`
Expected: All pass.

**Step 7: Commit**

```bash
git add src/custom.ts __tests__/zodvex-meta.test.ts
git commit -m "feat: attach __zodvexMeta to functions built by customFnBuilder

Decorated functions carry { zodArgs, zodReturns } metadata for codegen
discovery. The actual codegen CLI tool is future work — this lays the
foundation by ensuring metadata is available on every function built
through the zodvex pipeline."
```

---

## Task 6: Evaluate `zodvex/transform` package + final verification

The design doc says to evaluate whether `zodvex/transform` still provides value after the redesign. This task does that evaluation and runs final verification.

**Files:**
- Read: `src/transform/index.ts` (understand what it exports)
- Modify: `__tests__/exports.test.ts` (update tier labels to match design doc, if needed)

### Checkpoint: show me the evaluation results before any changes.

**Step 1: Evaluate `zodvex/transform`**

Read `src/transform/index.ts` and all files it imports. Answer:
1. What does it export? (`transformBySchema`, `walkSchema`, etc.)
2. Is any of this used by zodvex's core pipeline? (codecs, customFnBuilder, initZodvex)
3. Is any of this used by consumers? (grep for imports in test files)
4. Can it be replaced by Zod v4's native `z.encode` / `z.decode`?

Document findings as a comment in the commit message. If the evaluation shows it should be removed, do so. If it should stay, note why.

**Step 2: Fix exports test tier labels**

In `__tests__/exports.test.ts`, the test names say "Tier 2 builders" for `zCustomQuery` etc. and "Tier 3 builders" for `zQueryBuilder` etc. The design doc defines:
- Tier 2 = `zQueryBuilder`, `zCustomQueryBuilder` (standalone builders)
- Tier 3 = raw `zQuery` wrappers

Update the test names to match the design doc's tier classification.

**Step 3: Run final verification**

```bash
bun test
bun run type-check
bun run lint
bun run build
```

Expected: All clean.

**Step 4: Count test cases and verify coverage**

Run: `bun test`
Note the total test count. It should be notably higher than before (was 433).

**Step 5: Grep for deprecated warnings**

```bash
bun test 2>&1 | grep -c "deprecated"
```

Each deprecated warning should appear at most once (once-per-process guards from the earlier remediation).

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: evaluate zodvex/transform, fix tier labels, final verification

[Include transform evaluation findings here]"
```

---

## Client-Safe Model Definitions (Exploration Notes)

_This section is populated during Task 5, Step 5. Leave blank until then._

---

## Verification Checklist

After all tasks are complete, verify every item:

- [ ] `customFnBuilder` handles `added.onSuccess` (native convex-helpers path)
- [ ] `customFnBuilder` handles `added?.hooks?.onSuccess` (backward compat)
- [ ] Integration test uses native `onSuccess`, not deprecated `hooks.onSuccess`
- [ ] `CustomizationWithHooks` removed from `customFnBuilder` union signature
- [ ] All deprecated types have `@deprecated` JSDoc
- [ ] `zQueryBuilder(builder, { zodTables })` wraps `ctx.db` with codec awareness
- [ ] `zMutationBuilder(builder, { zodTables })` wraps `ctx.db` with codec awareness
- [ ] `CodecDatabaseReader` / `CodecDatabaseWriter` types exported from `zodvex/server`
- [ ] `zQuery(builder, { args, returns, handler })` config-object API works
- [ ] Positional `zQuery(builder, args, handler, { returns })` still works
- [ ] `fn.__zodvexMeta` attached by `customFnBuilder` with `{ zodArgs, zodReturns }`
- [ ] `zodvex/transform` package evaluated and decision documented
- [ ] All tests pass (`bun test`)
- [ ] Type checking passes (`bun run type-check`)
- [ ] Linting passes (`bun run lint`)
- [ ] Build succeeds (`bun run build`)
- [ ] Deprecation warnings fire at most once per process
