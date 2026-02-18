# zodvex v2 Remaining Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the v2 redesign by implementing every remaining item from the revised design doc (`docs/plans/2026-02-17-zodvex-v2-redesign.md`): native `onSuccess`, `createCodecCustomization`, `__zodvexMeta`, simplified `initZodvex`, type exports, and composition proof.

**Architecture:** zodvex produces composable builders via `zCustomQuery(builder, customization)`. Consumers compose customizations on top using convex-helpers' `customQuery(zq, consumerCustomization)`. zodvex owns codec correctness; convex-helpers owns customization lifecycle. `createCodecCustomization(zodTables)` is the bridge — a standard `Customization` that wraps `ctx.db` with codec-aware reader/writer.

**Tech Stack:** TypeScript, Zod v4, Bun test runner, convex-helpers

**Design doc:** `docs/plans/2026-02-17-zodvex-v2-redesign.md`

---

## Traceability Matrix

Every design doc section mapped to a task. Items already implemented correctly are marked "DONE".

| Design Doc Section | Item | Status | Task |
|---|---|---|---|
| **Identity / What zodvex owns** | Codec primitives (`zx.*`) | DONE | — |
| | Schema definition (`zodTable`, `defineZodSchema`) | DONE | — |
| | Zod->Convex validator mapping | DONE | — |
| | Codec-aware DB wrapper (boundaries 5,6) | DONE | — |
| | Zod pipeline for function args/returns (boundaries 3,4) | DONE (but `onSuccess` only fires via deprecated `hooks` path) | Task 1 |
| | `__zodvexMeta` function decoration | NOT DONE | Task 3 |
| | Codegen + validator registry (boundaries 1,2) | NOT DONE (future — out of scope for this plan) | — |
| **API Surface** | `zCustomQuery(builder, customization?)` | DONE (but `onSuccess` broken) | Task 1 |
| | `createCodecCustomization(zodTables)` | NOT DONE | Task 2 |
| | `initZodvex` returns short names `zq, zm, za, ziq, zim, zia` | NOT DONE — currently returns 9 items with long names | Task 5 |
| **Pipeline Design** | Steps 1-4, 6-8 (validation, handler, encode, strip) | DONE | — |
| | Step 5: `onSuccess` from native convex-helpers `Customization` | NOT DONE — only checks `added?.hooks?.onSuccess` | Task 1 |
| | `customFnBuilder` accepts convex-helpers' `Customization` directly | Type accepts it, but `onSuccess` from `input()` return is dropped | Task 1 |
| **Pipeline / What's eliminated** | `transforms.input` deprecated with runtime warning | DONE (once-per-process) | — |
| | `transforms.output` deprecated with runtime warning | DONE (once-per-process) | — |
| | `CustomizationWithHooks` removed from `customFnBuilder` internal signature | NOT DONE — still in the union | Task 6 |
| **Database Codec Layer** | `createZodDbReader` / `createZodDbWriter` | DONE | — |
| | `createCodecCustomization(zodTables)` export | NOT DONE | Task 2 |
| | `decodeDoc` / `encodeDoc` escape hatches | DONE | — |
| | `RuntimeDoc` / `WireDoc` types exported | DONE | — |
| | `CodecDatabaseReader` / `CodecDatabaseWriter` named types | NOT DONE | Task 2 |
| **Schema, Codecs & Codegen** | Schema definition, codec primitives | DONE | — |
| | `__zodvexMeta` function decoration | NOT DONE | Task 3 |
| | Codegen CLI tool | NOT DONE (future — out of scope) | — |
| **De-risking / Priority 1** | Composition proof: `customQuery(zq, cust)` works | NOT DONE | Task 4 |
| | Multi-layer composition | NOT DONE | Task 4 |
| **De-risking / Priority 2** | `onSuccess` sees runtime types (direct path) | Test exists but uses deprecated `hooks` path | Task 1 |
| | `onSuccess` sees wire types (composed path) — documented trade-off | NOT DONE | Task 4 |
| **De-risking / Priority 3** | DB codec benchmark (<25ms for 1000 docs) | DONE | — |
| **De-risking / Priority 5** | Full blessed-builder integration test | Test exists but uses deprecated `hooks.onSuccess` | Task 6 |
| **Migration / Deprecated** | `zCustomQueryBuilder` → `zCustomQuery` | DONE (`@deprecated`) | — |
| | `customCtxWithHooks()` → `customCtx()` | DONE (`@deprecated`) | — |
| **Migration / Removed** | `CustomizationWithHooks` from `customFnBuilder` signature | NOT DONE | Task 6 |
| | `CustomizationResult` needs `@deprecated` | NOT DONE | Task 6 |
| | `CustomizationInputResult` needs `@deprecated` | NOT DONE | Task 6 |
| **Post-migration** | Evaluate `zodvex/transform` package | NOT DONE | Task 7 |

---

## Task 1: Wire up native `onSuccess` in `customFnBuilder`

This is the critical bug fix. convex-helpers' `Customization.input()` returns `{ ctx, args, onSuccess? }` — with `onSuccess` at top level. zodvex's `customFnBuilder` currently only checks `added?.hooks?.onSuccess` (the deprecated zodvex path, lines 379 and 443 of `src/custom.ts`). It ignores the native `added.onSuccess`.

**Reference:** convex-helpers' `customFunctions.js` lines 266, 284 check `added.onSuccess`. convex-helpers' `Customization` type (`customFunctions.d.ts` lines 55-71) defines `onSuccess` as a top-level property of the `input()` return.

**Files:**
- Create: `__tests__/native-onSuccess.test.ts`
- Modify: `src/custom.ts:379,443` (the two onSuccess check sites)

### Checkpoint: show me `__tests__/native-onSuccess.test.ts` and the diff to `src/custom.ts` before committing.

**Step 1: Write failing tests for native `onSuccess`**

Create `__tests__/native-onSuccess.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { zx } from '../src/zx'

// Minimal builder stub that mimics Convex builder behavior
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

    // convex-helpers native shape: onSuccess at top level, NOT nested in hooks
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
      handler: async () => ({ name: 'test' })
    }) as any

    await fn({}, {})

    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.name).toBe('test')
  })

  it('onSuccess sees runtime types before Zod encode (Date)', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

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
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => ({ when: args.when })
    }) as any

    const timestamp = 1700000000000
    const wireResult = await fn({}, { when: timestamp })

    // onSuccess sees Date (runtime type)
    expect(onSuccessResult.when).toBeInstanceOf(Date)
    // Wire result is timestamp (encoded)
    expect(typeof wireResult.when).toBe('number')
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

  it('native onSuccess takes precedence over deprecated hooks.onSuccess', async () => {
    const builder = makeBuilder()
    let nativeFired = false
    let deprecatedFired = false

    const customization = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: () => { nativeFired = true },
        hooks: {
          onSuccess: () => { deprecatedFired = true }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization as any)
    const fn = myBuilder({ handler: async () => 'ok' }) as any
    await fn({}, {})

    expect(nativeFired).toBe(true)
    expect(deprecatedFired).toBe(false)
  })
})
```

**Step 2: Run the tests — verify they fail**

Run: `bun test __tests__/native-onSuccess.test.ts`
Expected: Native `onSuccess` tests FAIL (onSuccessResult is null). The deprecated `hooks.onSuccess` test PASSES.

**Step 3: Fix `customFnBuilder` to handle native `onSuccess`**

In `src/custom.ts`, find the two `onSuccess` check sites. Each needs to check BOTH `added?.onSuccess` (native convex-helpers) and `added?.hooks?.onSuccess` (deprecated). Native takes precedence.

**With-args path** (line 379 of `src/custom.ts`):

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
          // Native convex-helpers path (added.onSuccess) takes precedence over deprecated hooks path
          const onSuccess = added?.onSuccess ?? added?.hooks?.onSuccess
          if (onSuccess) {
            await onSuccess({
              ctx: finalCtx,
              args: parsed.data,
              result: ret
            })
          }
```

**No-args path** (line 443 of `src/custom.ts`):

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
Expected: ALL 7 PASS

**Step 5: Run the full test suite**

Run: `bun test`
Expected: All pass. Existing `hooks.onSuccess` tests in `__tests__/pipeline-ordering.test.ts` still pass (backward compat).

**Step 6: Commit**

```bash
git add __tests__/native-onSuccess.test.ts src/custom.ts
git commit -m "fix: wire up native convex-helpers onSuccess in customFnBuilder

customFnBuilder now checks added.onSuccess (convex-helpers' native
Customization convention) in addition to added?.hooks?.onSuccess
(deprecated zodvex path). Native takes precedence when both are present.
This is the core promise of v2: standard Customization from
convex-helpers works directly."
```

---

## Task 2: Create `createCodecCustomization` + `CodecDatabaseReader`/`Writer` types

The design doc lists `createCodecCustomization(zodTables)` as a primary export — a standard convex-helpers `Customization` that wraps `ctx.db` with codec-aware reader/writer. This is currently inlined inside `initZodvex` (lines 89-103 of `src/init.ts`) but not available as a standalone export.

This task also adds the named `CodecDatabaseReader` / `CodecDatabaseWriter` types and exports `ZodTableMap`.

**Files:**
- Create: `__tests__/db/codec-customization.test.ts`
- Modify: `src/db/wrapper.ts:19` (export `ZodTableMap`, add `createCodecCustomization`, add type aliases)
- Modify: `__tests__/exports.test.ts` (add export verification)

### Checkpoint: show me the test file and `wrapper.ts` diff before committing.

**Step 1: Write failing tests**

Create `__tests__/db/codec-customization.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createCodecCustomization } from '../../src/db/wrapper'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional()
})

const zodTables = { events: Events }

// Mock Convex db (writer interface)
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

describe('createCodecCustomization', () => {
  it('returns a standard Customization object with args and input', () => {
    const cust = createCodecCustomization(zodTables)
    expect(cust.args).toEqual({})
    expect(cust.input).toBeInstanceOf(Function)
  })

  it('input() wraps ctx.db with codec-aware writer', async () => {
    const cust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    // Seed a wire-format doc
    mockDb.store['events:0'] = {
      _id: 'events:0',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000
    }

    const result = await cust.input!({ db: mockDb } as any, {} as any, {} as any)

    // ctx.db should be codec-wrapped
    const doc = await result.ctx.db.get('events:0')
    expect(doc.startDate).toBeInstanceOf(Date)
    expect(doc.startDate.getTime()).toBe(1700000000000)
  })

  it('codec-wrapped db encodes writes (insert)', async () => {
    const cust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    const result = await cust.input!({ db: mockDb } as any, {} as any, {} as any)

    const id = await result.ctx.db.insert('events', {
      title: 'New Event',
      startDate: new Date(1700000000000)
    })

    // Verify wire format in store
    const stored = mockDb.store[id]
    expect(stored.title).toBe('New Event')
    expect(typeof stored.startDate).toBe('number')
    expect(stored.startDate).toBe(1700000000000)
  })

  it('codec-wrapped db encodes writes (patch)', async () => {
    const cust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    mockDb.store['events:0'] = {
      _id: 'events:0',
      _creationTime: 1000,
      _table: 'events',
      title: 'Old',
      startDate: 1700000000000
    }

    const result = await cust.input!({ db: mockDb } as any, {} as any, {} as any)

    await result.ctx.db.patch('events:0', {
      startDate: new Date(1800000000000)
    })

    expect(typeof mockDb.store['events:0'].startDate).toBe('number')
    expect(mockDb.store['events:0'].startDate).toBe(1800000000000)
  })

  it('does NOT return onSuccess (codec customization has no side effects)', () => {
    const cust = createCodecCustomization(zodTables)
    // input() should not return onSuccess — codec wrapping is pure
    // (onSuccess belongs in consumer's customization, not codec layer)
    expect(cust).not.toHaveProperty('onSuccess')
  })
})
```

**Step 2: Run tests — verify they fail**

Run: `bun test __tests__/db/codec-customization.test.ts`
Expected: FAIL — `createCodecCustomization` is not exported from `src/db/wrapper`.

**Step 3: Implement `createCodecCustomization` + types**

In `src/db/wrapper.ts`, make these changes:

1. Export `ZodTableMap` (line 19, change from `type` to `export type`):

```typescript
/** Map of table name -> zodTable entry. */
export type ZodTableMap = Record<string, ZodTableEntry>
```

2. Add `CodecDatabaseReader` / `CodecDatabaseWriter` types after the factory functions:

```typescript
/** Type of the codec-aware database reader returned by createZodDbReader. */
export type CodecDatabaseReader = ReturnType<typeof createZodDbReader>

/** Type of the codec-aware database writer returned by createZodDbWriter. */
export type CodecDatabaseWriter = ReturnType<typeof createZodDbWriter>
```

3. Add `createCodecCustomization` at the end of the file:

```typescript
/**
 * Creates a standard convex-helpers Customization that wraps ctx.db
 * with a codec-aware writer (which extends reader).
 *
 * This is the primary way to get codec-aware DB operations. Pass it
 * to zCustomQuery/zCustomMutation, or use it via initZodvex which
 * calls this internally.
 *
 * @param zodTables - Map of table name -> zodTable entry
 * @returns A Customization object with args: {} and input that wraps ctx.db
 *
 * @example
 * ```ts
 * const codecCust = createCodecCustomization(schema.zodTables)
 * const zq = zCustomQuery(server.query, codecCust)
 * ```
 */
export function createCodecCustomization(zodTables: ZodTableMap) {
  return {
    args: {},
    input: async (ctx: any) => ({
      ctx: { db: createZodDbWriter(ctx.db, zodTables) },
      args: {}
    })
  }
}
```

**Step 4: Update exports test**

In `__tests__/exports.test.ts`, update the `zodvex/server exports` describe block. Add to the DB codec primitives test:

```typescript
it('exports createCodecCustomization', async () => {
  const { createCodecCustomization } = await import('../src/server')
  expect(createCodecCustomization).toBeDefined()
})
```

**Step 5: Run tests — verify they pass**

Run: `bun test __tests__/db/codec-customization.test.ts`
Expected: ALL PASS

**Step 6: Run the full test suite + type check**

Run: `bun test && bun run type-check`
Expected: All pass.

**Step 7: Commit**

```bash
git add src/db/wrapper.ts __tests__/db/codec-customization.test.ts __tests__/exports.test.ts
git commit -m "feat: add createCodecCustomization + CodecDatabaseReader/Writer types

createCodecCustomization(zodTables) returns a standard convex-helpers
Customization that wraps ctx.db with codec-aware writer. This is the
primary bridge between zodvex's codec layer and convex-helpers'
composition model. Also exports CodecDatabaseReader, CodecDatabaseWriter,
and ZodTableMap types."
```

---

## Task 3: `__zodvexMeta` function decoration

The design doc specifies that builders attach `__zodvexMeta` to function exports for codegen discovery. `customFnBuilder` needs to decorate the function returned by `builder({...})` with `{ zodArgs, zodReturns }`.

**Files:**
- Create: `__tests__/zodvex-meta.test.ts`
- Modify: `src/custom.ts:334,409` (the two `return builder({...})` sites)

### Checkpoint: show me the test file and `custom.ts` diff before committing.

**Step 1: Write failing tests**

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

const noOpCustomization = {
  args: {},
  input: async () => ({ ctx: {}, args: {} })
}

describe('__zodvexMeta function decoration', () => {
  it('attaches zodArgs and zodReturns to the returned function', () => {
    const builder = makeBuilder()
    const myBuilder = customFnBuilder(builder as any, noOpCustomization as any)

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
    const myBuilder = customFnBuilder(builder as any, noOpCustomization as any)

    const argsSchema = { name: z.string() }

    const fn = myBuilder({
      args: argsSchema,
      handler: async (_ctx: any, args: any) => args
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBe(argsSchema)
    expect(fn.__zodvexMeta.zodReturns).toBeUndefined()
  })

  it('attaches metadata for functions without args (no-args path)', () => {
    const builder = makeBuilder()
    const myBuilder = customFnBuilder(builder as any, noOpCustomization as any)

    const returnsSchema = z.object({ name: z.string() })

    const fn = myBuilder({
      returns: returnsSchema,
      handler: async () => ({ name: 'hello' })
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBeUndefined()
    expect(fn.__zodvexMeta.zodReturns).toBe(returnsSchema)
  })

  it('attaches metadata for functions with no args and no returns', () => {
    const builder = makeBuilder()
    const myBuilder = customFnBuilder(builder as any, noOpCustomization as any)

    const fn = myBuilder({
      handler: async () => 'hello'
    }) as any

    expect(fn.__zodvexMeta).toBeDefined()
    expect(fn.__zodvexMeta.zodArgs).toBeUndefined()
    expect(fn.__zodvexMeta.zodReturns).toBeUndefined()
  })

  it('preserves the original args shape (not ZodObject)', () => {
    const builder = makeBuilder()
    const myBuilder = customFnBuilder(builder as any, noOpCustomization as any)

    // Raw shape object (most common usage)
    const argsShape = { id: z.string(), when: zx.date() }

    const fn = myBuilder({
      args: argsShape,
      handler: async (_ctx: any, args: any) => args
    }) as any

    // zodArgs should be the raw shape, not a ZodObject wrapper
    expect(fn.__zodvexMeta.zodArgs).toBe(argsShape)
  })
})
```

**Step 2: Run tests — verify they fail**

Run: `bun test __tests__/zodvex-meta.test.ts`
Expected: FAIL — `fn.__zodvexMeta` is undefined.

**Step 3: Attach `__zodvexMeta` in `customFnBuilder`**

In `src/custom.ts`, modify the `customBuilder` function (inside `customFnBuilder`). There are two code paths that call `builder({...})` — one for with-args (line 334) and one for no-args (line 409).

**With-args path** (line 334 of `src/custom.ts`):

Replace:
```typescript
      return builder({
        args: convexArgs,
        ...returnValidator,
        handler: async (ctx: Ctx, allArgs: any) => {
```

With:
```typescript
      const registered = builder({
        args: convexArgs,
        ...returnValidator,
        handler: async (ctx: Ctx, allArgs: any) => {
```

And at the end of this `if (args) { ... }` block (before the closing `}`), instead of the implicit return from `return builder({...})`, add:

```typescript
      // ... handler implementation unchanged ...
      })
      ;(registered as any).__zodvexMeta = {
        zodArgs: fn.args,
        zodReturns: fn.returns
      }
      return registered
```

**No-args path** (line 409 of `src/custom.ts`):

Same pattern:

```typescript
    const registered = builder({
      args: inputArgs,
      ...returnValidator,
      handler: async (ctx: Ctx, allArgs: any) => {
        // ... unchanged ...
      }
    })
    ;(registered as any).__zodvexMeta = {
      zodArgs: undefined,
      zodReturns: fn.returns
    }
    return registered
```

**Important:** `fn.args` is the original args from the consumer config (the raw Zod shape or ZodObject, before conversion to Convex validators). `fn.returns` is the original returns Zod schema (may be undefined). These are captured at the top of `customBuilder` on line 294: `const { args, handler = fn, returns: maybeObject, ...extra } = fn`.

Note: Use `fn.args` (the original input), NOT the computed `argsSchema` (which is always a ZodObject). The consumer may have passed a raw shape like `{ id: z.string() }`, and codegen needs the original form.

**Step 4: Run the tests — verify they pass**

Run: `bun test __tests__/zodvex-meta.test.ts`
Expected: ALL 5 PASS

**Step 5: Run the full test suite**

Run: `bun test`
Expected: All pass.

**Step 6: Commit**

```bash
git add __tests__/zodvex-meta.test.ts src/custom.ts
git commit -m "feat: attach __zodvexMeta to functions built by customFnBuilder

Decorated functions carry { zodArgs, zodReturns } metadata for codegen
discovery. zodArgs is the original consumer-provided shape (not the
ZodObject wrapper). zodReturns is the Zod schema for return validation.
Both may be undefined when not provided."
```

---

## Task 4: Composition proof tests

This is the de-risking priority 1 from the design doc. If `customQuery(zq, customization)` doesn't compose correctly, the entire architecture falls apart. These tests also verify the `onSuccess` ordering trade-off.

**Important context:** convex-helpers' `customQuery` is not importable in unit tests (it requires real Convex server types). Instead, we simulate the composition pattern by manually chaining: call the outer `input()` to augment ctx, then pass augmented ctx to the inner builder. This tests the same code paths without a Convex runtime.

**Files:**
- Create: `__tests__/composition-proof.test.ts`

### Checkpoint: show me the test file before committing.

**Step 1: Write composition proof tests**

Create `__tests__/composition-proof.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { createCodecCustomization } from '../src/db/wrapper'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

// --- Test fixtures ---

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional()
})

const zodTables = { events: Events }

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
        unique: async () => null,
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

// Minimal builder stub
function makeBuilder() {
  return function builder(config: any) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

// --- Composition simulation ---
// In production: customQuery(zq, customization)
// In test: we simulate by manually calling the composition chain.
// This produces the same runtime behavior.

/**
 * Simulate convex-helpers' customQuery(innerBuilder, outerCustomization).
 *
 * convex-helpers' customQuery wraps the inner builder so that:
 * 1. The outer customization's input() runs first, augmenting ctx
 * 2. The inner builder's handler runs with augmented ctx
 * 3. The outer customization's onSuccess runs after the inner handler returns
 *
 * The key detail: the inner builder's handler includes zodvex's encode step.
 * So onSuccess from the OUTER layer sees ENCODED (wire) types.
 */
function simulateCustomQuery(
  innerBuilder: (config: any) => any,
  outerCustomization: { args?: any; input?: (ctx: any, args: any, extra: any) => any }
) {
  return function composedBuilder(config: any) {
    return async (ctx: any, args: any) => {
      // Step 1: outer customization augments ctx
      const added = outerCustomization.input
        ? await outerCustomization.input(ctx, {}, {})
        : { ctx: {}, args: {} }

      const augmentedCtx = { ...ctx, ...(added?.ctx ?? {}) }

      // Step 2: inner builder's handler runs (includes zodvex encode)
      const innerFn = innerBuilder(config)
      const result = await innerFn(augmentedCtx, args)

      // Step 3: outer onSuccess runs AFTER inner handler (sees wire types)
      if (added?.onSuccess) {
        await added.onSuccess({ ctx: augmentedCtx, args, result })
      }

      return result
    }
  }
}

describe('Composition proof: customQuery(zq, customization)', () => {
  it('codec customization wraps ctx.db — reads decode wire→runtime', async () => {
    const codecCust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    mockDb.store['events:0'] = {
      _id: 'events:0',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000
    }

    // zq = zCustomQuery(builder, codecCust)
    const zq = customFnBuilder(makeBuilder() as any, codecCust as any)

    const getEvent = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => ctx.db.get(id)
    }) as any

    const result = await getEvent({ db: mockDb }, { id: 'events:0' })

    // No returns schema → no encode → runtime types returned
    expect(result.startDate).toBeInstanceOf(Date)
    expect(result.startDate.getTime()).toBe(1700000000000)
  })

  it('onSuccess from DIRECT customization sees runtime types (Date)', async () => {
    let onSuccessResult: any = null

    // Direct path: zCustomQuery(builder, customizationWithOnSuccess)
    const directCust = {
      args: {},
      input: async (ctx: any) => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => {
          onSuccessResult = result
        }
      })
    }

    const zq = customFnBuilder(makeBuilder() as any, directCust as any)

    const fn = zq({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => ({ when: args.when })
    }) as any

    const wireResult = await fn({}, { when: 1700000000000 })

    // Direct path: onSuccess sees runtime types (Date)
    expect(onSuccessResult.when).toBeInstanceOf(Date)
    // Wire result is encoded (timestamp)
    expect(typeof wireResult.when).toBe('number')
  })

  it('onSuccess from COMPOSED customization sees wire types (documented trade-off)', async () => {
    let outerOnSuccessResult: any = null

    const codecCust = createCodecCustomization(zodTables)

    // Inner builder: zq = zCustomQuery(builder, codecCust)
    const zq = (config: any) => customFnBuilder(makeBuilder() as any, codecCust as any)(config)

    // Outer customization with onSuccess
    const outerCust = {
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: { id: 'u1' } },
        args: {},
        onSuccess: ({ result }: any) => {
          outerOnSuccessResult = result
        }
      })
    }

    // Simulate: customQuery(zq, outerCust)
    const composedBuilder = simulateCustomQuery(
      (config: any) => zq(config),
      outerCust
    )

    const fn = composedBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => ({ when: args.when })
    })

    const mockDb = createMockDb()
    const wireResult = await fn({ db: mockDb }, { when: 1700000000000 })

    // COMPOSED path: onSuccess sees WIRE types (encoded by zodvex before returning)
    // This is the documented trade-off from the design doc
    expect(typeof outerOnSuccessResult.when).toBe('number')
    expect(outerOnSuccessResult.when).toBe(1700000000000)

    // Wire result is also encoded
    expect(typeof wireResult.when).toBe('number')
  })

  it('multi-layer composition: codec → auth → security', async () => {
    const codecCust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    mockDb.store['events:0'] = {
      _id: 'events:0',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000
    }

    // Layer 1: codec (zodvex)
    const zq = customFnBuilder(makeBuilder() as any, codecCust as any)

    // Layer 2: auth (consumer) — simulated composition
    const authCust = {
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: { id: 'user-1', role: 'doctor' } },
        args: {}
      })
    }

    // Layer 3: security (consumer) — simulated composition
    const securityCust = {
      args: {},
      input: async (ctx: any) => {
        // Wraps the existing (codec-aware) db with security check
        const secureDb = {
          ...ctx.db,
          get: async (id: any) => {
            const doc = await ctx.db.get(id)
            if (!doc) return null
            // Simple RLS: only doctor role can read
            if (ctx.user?.role !== 'doctor') return null
            return doc
          }
        }
        return { ctx: { db: secureDb }, args: {} }
      }
    }

    // Build: security(auth(zq(handler)))
    const authQuery = simulateCustomQuery(
      (config: any) => zq(config) as any,
      authCust
    )
    const secureQuery = simulateCustomQuery(
      (config: any) => authQuery(config),
      securityCust
    )

    const fn = secureQuery({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => ctx.db.get(id)
    })

    const result = await fn({ db: mockDb }, { id: 'events:0' })

    // Multi-layer: codec decoded, auth added user, security filtered
    expect(result).not.toBeNull()
    expect(result.startDate).toBeInstanceOf(Date)
  })

  it('args:{} from customization does not interfere with zodvex args', async () => {
    // This verifies the key constraint: customQuery(zq, cust) works
    // when cust.args is {} (no custom args from customization layer)
    const codecCust = createCodecCustomization(zodTables)
    const mockDb = createMockDb()

    const zq = customFnBuilder(makeBuilder() as any, codecCust as any)

    const fn = zq({
      args: { title: z.string(), when: zx.date() },
      returns: z.object({ title: z.string(), when: zx.date() }),
      handler: async (_ctx: any, args: any) => ({
        title: args.title,
        when: args.when
      })
    }) as any

    const ts = 1700000000000
    const result = await fn({ db: mockDb }, { title: 'Test', when: ts })

    // Args parsed through Zod (timestamp → Date in handler)
    // Returns encoded through Zod (Date → timestamp in wire result)
    expect(typeof result.when).toBe('number')
    expect(result.when).toBe(ts)
    expect(result.title).toBe('Test')
  })
})
```

**Step 2: Run composition proof tests**

Run: `bun test __tests__/composition-proof.test.ts`
Expected: ALL 5 PASS (depends on Task 1 and Task 2 being complete)

**Step 3: Run full test suite**

Run: `bun test`
Expected: All pass.

**Step 4: Commit**

```bash
git add __tests__/composition-proof.test.ts
git commit -m "test: composition proof — customQuery(zq, cust) composes correctly

Proves the v2 architecture's core claim: zodvex builders compose with
convex-helpers' customQuery. Tests cover:
- Codec customization wraps ctx.db (reads decode)
- Direct onSuccess sees runtime types
- Composed onSuccess sees wire types (documented trade-off)
- Multi-layer composition (codec → auth → security)
- Empty args from customization doesn't interfere with Zod args"
```

---

## Task 5: Simplify `initZodvex`

The design doc says `initZodvex` returns `{ zq, zm, za, ziq, zim, zia }` — 6 builders with short names. The current implementation returns 9 items with long names and includes `makeZCustomQuery`/`makeZCustomMutation`/`makeZCustomAction` factory functions that are replaced by convex-helpers' `customQuery(zq, ...)` composition.

This is a breaking change (v2 major version bump).

**Files:**
- Create: `__tests__/init-v2.test.ts`
- Modify: `src/init.ts`
- Modify: `__tests__/init.test.ts` (update for new API)

### Checkpoint: show me the test file and `init.ts` diff before committing.

**Step 1: Write tests for new `initZodvex` API**

Create `__tests__/init-v2.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { initZodvex } from '../src/init'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date()
})

const Users = zodTable('users', {
  name: z.string(),
  email: z.string()
})

const schema = defineZodSchema({ events: Events, users: Users })

// Mock server
const server = {
  query: (config: any) => config,
  mutation: (config: any) => config,
  action: (config: any) => config,
  internalQuery: (config: any) => config,
  internalMutation: (config: any) => config,
  internalAction: (config: any) => config
}

describe('initZodvex v2 — short names', () => {
  it('returns exactly zq, zm, za, ziq, zim, zia', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zq).toBeDefined()
    expect(result.zm).toBeDefined()
    expect(result.za).toBeDefined()
    expect(result.ziq).toBeDefined()
    expect(result.zim).toBeDefined()
    expect(result.zia).toBeDefined()

    // Should be exactly 6 keys
    expect(Object.keys(result)).toHaveLength(6)
  })

  it('does NOT return long names or factory functions', () => {
    const result = initZodvex(schema, server as any) as any
    expect(result.zQuery).toBeUndefined()
    expect(result.zMutation).toBeUndefined()
    expect(result.zAction).toBeUndefined()
    expect(result.zInternalQuery).toBeUndefined()
    expect(result.zInternalMutation).toBeUndefined()
    expect(result.zInternalAction).toBeUndefined()
    expect(result.zCustomQuery).toBeUndefined()
    expect(result.zCustomMutation).toBeUndefined()
    expect(result.zCustomAction).toBeUndefined()
  })

  it('zq produces a working codec-aware builder', () => {
    const { zq } = initZodvex(schema, server as any)
    const fn = zq({
      args: { title: z.string() },
      handler: async (_ctx: any, { title }: any) => title
    })
    expect(fn).toBeDefined()
  })

  it('za produces a builder without DB wrapping', () => {
    const { za } = initZodvex(schema, server as any)
    const fn = za({
      args: { input: z.string() },
      handler: async (_ctx: any, { input }: any) => input
    })
    expect(fn).toBeDefined()
  })
})
```

**Step 2: Run tests — verify they fail**

Run: `bun test __tests__/init-v2.test.ts`
Expected: FAIL — `result.zq` is undefined (current returns `zQuery`).

**Step 3: Rewrite `initZodvex`**

Replace the entire implementation in `src/init.ts` with:

```typescript
import type {
  ActionBuilder,
  FunctionVisibility,
  GenericDataModel,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { zCustomAction, zCustomMutation, zCustomQuery } from './custom'
import { createCodecCustomization } from './db/wrapper'

type ZodTables = Record<string, { name: string; table: any; schema: { doc: any; base: any } }>

type ZodSchema = {
  tables: Record<string, any>
  zodTables: ZodTables
}

type Server<DataModel extends GenericDataModel> = {
  query: QueryBuilder<DataModel, 'public'>
  internalQuery: QueryBuilder<DataModel, 'internal'>
  mutation: MutationBuilder<DataModel, 'public'>
  internalMutation: MutationBuilder<DataModel, 'internal'>
  action: ActionBuilder<DataModel, 'public'>
  internalAction: ActionBuilder<DataModel, 'internal'>
}

/** NoOp customization for actions (no ctx.db wrapping). */
const actionNoOp = {
  args: {},
  input: async () => ({ ctx: {}, args: {} })
}

/**
 * One-time setup that creates codec-aware builders for your Convex project.
 *
 * Returns pre-configured builders with short names. Each query/mutation builder
 * automatically wraps `ctx.db` with codec-aware read/write using your zodTable
 * schemas. Action builders do NOT wrap ctx.db (actions have no DB in Convex).
 *
 * For "blessed builders" (auth, security, etc.), compose with convex-helpers:
 * ```ts
 * import { customQuery } from 'convex-helpers/server/customFunctions'
 * const hotpotQuery = customQuery(zq, hotpotCustomization)
 * ```
 *
 * @param schema - Schema from `defineZodSchema()` containing zodTable refs
 * @param server - Convex server functions (`query`, `mutation`, `action`, and internal variants)
 * @returns `{ zq, zm, za, ziq, zim, zia }` — codec-aware builders
 *
 * @example
 * ```ts
 * const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server)
 *
 * export const getEvent = zq({
 *   args: { id: zx.id('events') },
 *   returns: Events.schema.doc.nullable(),
 *   handler: async (ctx, { id }) => ctx.db.get(id),
 * })
 * ```
 */
export function initZodvex<DataModel extends GenericDataModel>(
  schema: ZodSchema,
  server: Server<DataModel>
) {
  const codecCust = createCodecCustomization(schema.zodTables)

  return {
    zq: zCustomQuery(server.query, codecCust as any),
    zm: zCustomMutation(server.mutation, codecCust as any),
    za: zCustomAction(server.action, actionNoOp as any),
    ziq: zCustomQuery(server.internalQuery, codecCust as any),
    zim: zCustomMutation(server.internalMutation, codecCust as any),
    zia: zCustomAction(server.internalAction, actionNoOp as any)
  }
}
```

**Step 4: Update existing `__tests__/init.test.ts`**

The existing test file references the old API (`result.zQuery`, `result.zCustomQuery`, etc.). Update all references to use the new short names (`result.zq`, `result.zm`, etc.). Remove tests for the factory functions (`makeZCustomQuery`, etc.) since those are eliminated.

Key changes:
- `result.zQuery` → `result.zq`
- `result.zMutation` → `result.zm`
- `result.zAction` → `result.za`
- `result.zInternalQuery` → `result.ziq`
- `result.zInternalMutation` → `result.zim`
- `result.zInternalAction` → `result.zia`
- Remove tests for `result.zCustomQuery` (factory function — eliminated)
- Remove tests for `result.zCustomMutation` (factory function — eliminated)
- Remove tests for `result.zCustomAction` (factory function — eliminated)

**Step 5: Update any integration tests that use `initZodvex` return values**

Search for usages: `grep -rn "initZodvex" __tests__/`. Update each to use short names.

Known files:
- `__tests__/integration/codec-pipeline.test.ts` — uses `const { zCustomQuery } = initZodvex(...)`. Change to destructure `zq` and use `zq` directly (since `zCustomQuery` was the factory function, now eliminated). For the blessed builder pattern, the test should compose manually instead of using the factory.

**Step 6: Run tests — verify they pass**

Run: `bun test __tests__/init-v2.test.ts && bun test __tests__/init.test.ts`
Expected: ALL PASS

**Step 7: Run full test suite + type check**

Run: `bun test && bun run type-check`
Expected: All pass.

**Step 8: Commit**

```bash
git add src/init.ts __tests__/init.test.ts __tests__/init-v2.test.ts __tests__/integration/codec-pipeline.test.ts
git commit -m "feat: simplify initZodvex — return short names, remove factory functions

initZodvex now returns { zq, zm, za, ziq, zim, zia } — 6 builders with
short names. Factory functions (makeZCustomQuery etc.) are removed.
For blessed builders, compose with convex-helpers' customQuery:
  const hotpotQuery = customQuery(zq, hotpotCustomization)

Uses createCodecCustomization internally instead of inline codec wrapping.

BREAKING: initZodvex return shape changed (v2 major version bump)."
```

---

## Task 6: Type cleanup + integration test update

Remove `CustomizationWithHooks` from `customFnBuilder`'s internal signature. Add `@deprecated` JSDoc to `CustomizationResult` and `CustomizationInputResult`. Update the integration test to use native `onSuccess` instead of deprecated `hooks.onSuccess`.

**Files:**
- Modify: `src/custom.ts:286-288` (remove `CustomizationWithHooks` from union)
- Modify: `src/custom.ts:53,71` (add `@deprecated` to types)
- Modify: `__tests__/integration/codec-pipeline.test.ts:299-307` (native `onSuccess`)
- Modify: `__tests__/exports.test.ts` (update assertions)

### Checkpoint: show me the `custom.ts` diff and integration test diff before committing.

**Step 1: Remove `CustomizationWithHooks` from `customFnBuilder` signature**

In `src/custom.ts`, lines 286-288:

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

**Step 2: Add `@deprecated` to `CustomizationResult` and `CustomizationInputResult`**

In `src/custom.ts`, line 49 (before `CustomizationResult`):

Add:
```typescript
/**
 * @deprecated Use convex-helpers' `Customization` type directly.
 * The `hooks` and `transforms` properties are no longer needed.
 */
```

In `src/custom.ts`, line 67 (before `CustomizationInputResult`):

Add:
```typescript
/**
 * @deprecated Use convex-helpers' `Customization` type directly.
 */
```

**Step 3: Update the integration test to use native `onSuccess`**

In `__tests__/integration/codec-pipeline.test.ts`, find the blessed builder test (around line 299-307). This currently uses `hooks: { onSuccess: ... }`. Change to native `onSuccess`.

Replace:
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

With:
```typescript
        return {
          ctx: { user, db: secureDb },
          args: {},
          onSuccess: ({ result }: any) => {
            auditLog.push({ userId: user.id, action: 'read', result })
          }
        }
```

**Step 4: Verify the `customFnBuilder` still works with deprecated types at runtime**

Even though `CustomizationWithHooks` is removed from the TypeScript signature, consumers may still pass objects with `hooks` and `transforms` at runtime (via `as any` casts or JavaScript). The runtime code still checks `added?.hooks?.onSuccess` and `added?.transforms?.input` etc., so it works. No runtime change needed.

**Step 5: Run the full test suite + type check + lint**

Run: `bun test && bun run type-check && bun run lint`

If type-check fails because internal code references `CustomizationWithHooks` in type positions, fix those usages. The type is still exported (deprecated, not removed), so external consumers can still import it.

Expected: All pass.

**Step 6: Commit**

```bash
git add src/custom.ts __tests__/integration/codec-pipeline.test.ts __tests__/exports.test.ts
git commit -m "refactor: remove CustomizationWithHooks from internal signature, deprecate result types

customFnBuilder now accepts only convex-helpers' Customization type.
CustomizationResult and CustomizationInputResult marked @deprecated.
Integration test updated to use native onSuccess instead of deprecated
hooks.onSuccess path."
```

---

## Task 7: Final verification + `zodvex/transform` evaluation

Run the full verification suite and evaluate whether `zodvex/transform` still provides value.

**Files:**
- Read: `src/transform/index.ts` (understand exports)
- No files modified unless evaluation warrants removal

### Checkpoint: show me the evaluation results and test output before committing.

**Step 1: Run full verification**

```bash
bun test
bun run type-check
bun run lint
bun run build
```

Expected: All clean.

**Step 2: Count test cases**

Run: `bun test 2>&1 | tail -5`
Note the total. Should be 440+ (was 433 before this plan).

**Step 3: Verify deprecation warnings fire at most once**

Run: `bun test 2>&1 | grep -c "deprecated"`
Expected: Each deprecated warning appears at most once per test file.

**Step 4: Evaluate `zodvex/transform`**

Read `src/transform/index.ts` and answer:
1. What does it export? (`transformBySchema`, `walkSchema`, etc.)
2. Is it used by zodvex's core pipeline? (codecs, customFnBuilder, initZodvex)
3. Is it used by consumers? (check test imports)
4. Can it be replaced by Zod v4's native `z.encode` / `z.decode`?

Document findings in the commit message. The most likely outcome: `transformBySchema` and `walkSchema` were the original codec pipeline before we adopted `z.encode`/`z.decode`. They're still exported from `zodvex/core` for consumers who use them directly, but zodvex's internal pipeline no longer depends on them.

**Recommendation:** Keep them exported (removing would be a breaking change), but add `@deprecated` JSDoc pointing consumers to `z.encode`/`z.decode`. Mark as candidates for removal in the next major version.

**Step 5: If deprecation annotations needed, add them**

Add `@deprecated` JSDoc to `transformBySchema` and `walkSchema` in `src/transform/index.ts` (or wherever they're defined). Update export comments.

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final verification + zodvex/transform evaluation

Full suite passes (N tests). Type-check, lint, build all clean.

zodvex/transform evaluation: transformBySchema and walkSchema were the
pre-v2 codec pipeline. They're superseded by Zod v4's native z.encode/
z.decode which zodvex now uses internally. Keeping them exported for
backward compat, marked @deprecated."
```

---

## Verification Checklist

After all tasks are complete, every item must be verified:

- [ ] `customFnBuilder` handles `added.onSuccess` (native convex-helpers path)
- [ ] `customFnBuilder` handles `added?.hooks?.onSuccess` (backward compat)
- [ ] Native `onSuccess` takes precedence when both are present
- [ ] `createCodecCustomization(zodTables)` exported and functional
- [ ] `CodecDatabaseReader` / `CodecDatabaseWriter` types exported
- [ ] `ZodTableMap` type exported
- [ ] `fn.__zodvexMeta` attached by `customFnBuilder` with `{ zodArgs, zodReturns }`
- [ ] `initZodvex` returns `{ zq, zm, za, ziq, zim, zia }` (6 keys, short names)
- [ ] `initZodvex` does NOT return factory functions
- [ ] `CustomizationWithHooks` removed from `customFnBuilder` signature
- [ ] `CustomizationResult` has `@deprecated` JSDoc
- [ ] `CustomizationInputResult` has `@deprecated` JSDoc
- [ ] Integration test uses native `onSuccess`, not deprecated `hooks.onSuccess`
- [ ] Composition proof: `customQuery(zq, cust)` works (5 tests)
- [ ] onSuccess ordering: direct sees runtime types, composed sees wire types
- [ ] `zodvex/transform` evaluated and documented
- [ ] All tests pass (`bun test`)
- [ ] Type checking passes (`bun run type-check`)
- [ ] Linting passes (`bun run lint`)
- [ ] Build succeeds (`bun run build`)
- [ ] Deprecation warnings fire at most once per process
