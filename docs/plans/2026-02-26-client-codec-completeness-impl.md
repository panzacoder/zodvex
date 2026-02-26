# Client Codec Completeness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the codec gap for imperative calls on pre-existing Convex clients by extracting shared codec helpers, making ZodvexClient accept existing clients, and adding ZodvexReactClient.

**Architecture:** Extract encode/decode into `createCodecHelpers` (the primitive). Refactor `ZodvexClient` to accept `{ client }`. Add `ZodvexReactClient` wrapping `ConvexReactClient` with codec transforms on all data-carrying methods. All paths share `createCodecHelpers` internally.

**Tech Stack:** TypeScript, Zod v4, Convex SDK (`convex/browser`, `convex/react`, `convex/server`), Bun test runner

**Design doc:** `docs/plans/2026-02-26-client-codec-completeness-design.md`

---

### Task 1: `createCodecHelpers` — the shared primitive

**Files:**
- Create: `packages/zodvex/src/codecHelpers.ts`
- Test: `packages/zodvex/__tests__/codec-helpers.test.ts`

**Step 1: Write the failing test**

Create `packages/zodvex/__tests__/codec-helpers.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// Mock convex/server — we need getFunctionName to work
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

const { createCodecHelpers } = await import('../src/codecHelpers')

function fakeRef(path: string) {
  return { _testPath: path } as any
}

const taskReturnsSchema = z.object({
  _id: z.string(),
  title: z.string(),
  createdAt: zx.date()
})

const taskArgsSchema = z.object({
  title: z.string(),
  dueAt: zx.date()
})

const registry = {
  'tasks:list': { returns: z.array(taskReturnsSchema) },
  'tasks:create': { args: taskArgsSchema, returns: taskReturnsSchema },
  'plain:noCodec': {}
}

describe('createCodecHelpers', () => {
  const { encodeArgs, decodeResult } = createCodecHelpers(registry as any)

  describe('encodeArgs', () => {
    it('encodes Date -> number via codec', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      const wire = encodeArgs(fakeRef('tasks:create'), { title: 'Test', dueAt: dueDate })
      expect(wire.title).toBe('Test')
      expect(typeof wire.dueAt).toBe('number')
      expect(wire.dueAt).toBe(dueDate.getTime())
    })

    it('strips undefined from encoded args', () => {
      const optRegistry = {
        'notes:create': { args: z.object({ title: z.string(), desc: z.string().optional() }) }
      }
      const { encodeArgs: enc } = createCodecHelpers(optRegistry)
      const wire = enc(fakeRef('notes:create'), { title: 'Hello' })
      expect(wire.title).toBe('Hello')
      expect('desc' in wire).toBe(false)
    })

    it('passes args through when no args schema', () => {
      const raw = { foo: 'bar' }
      expect(encodeArgs(fakeRef('tasks:list'), raw)).toEqual(raw)
    })

    it('passes args through when function not in registry', () => {
      const raw = { x: 1 }
      expect(encodeArgs(fakeRef('unknown:fn'), raw)).toEqual(raw)
    })

    it('passes args through when args is null', () => {
      expect(encodeArgs(fakeRef('tasks:create'), null)).toBeNull()
    })
  })

  describe('decodeResult', () => {
    it('decodes number -> Date via codec', () => {
      const ts = 1700000000000
      const result = decodeResult(
        fakeRef('tasks:list'),
        [{ _id: 'abc', title: 'Test', createdAt: ts }]
      )
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(ts)
    })

    it('passes through when no returns schema', () => {
      const raw = { data: 42 }
      expect(decodeResult(fakeRef('plain:noCodec'), raw)).toEqual(raw)
    })

    it('passes through when function not in registry', () => {
      const raw = { foo: 'bar' }
      expect(decodeResult(fakeRef('unknown:fn'), raw)).toEqual(raw)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/codec-helpers.test.ts`
Expected: FAIL — `Cannot find module '../src/codecHelpers'`

**Step 3: Write minimal implementation**

Create `packages/zodvex/src/codecHelpers.ts`:

```typescript
import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { safeEncode } from './normalizeCodecPaths'
import type { AnyRegistry } from './types'
import { stripUndefined } from './utils'

/**
 * Creates registry-bound encode/decode helpers for codec transforms.
 *
 * This is the shared primitive used internally by ZodvexClient,
 * ZodvexReactClient, createZodvexHooks, and createZodvexActionCtx.
 * Also exported for consumers who wrap their own Convex clients.
 *
 * @param registry - Function path -> { args?, returns? } Zod schema map.
 *   Typically the `zodvexRegistry` from `_zodvex/api.ts`.
 */
export function createCodecHelpers(registry: AnyRegistry) {
  /** Encode runtime args to wire format via the registry's args schema. */
  function encodeArgs(ref: FunctionReference<any, any, any, any>, args: any): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    return entry?.args && args != null ? stripUndefined(safeEncode(entry.args, args)) : args
  }

  /** Decode wire result to runtime types via the registry's returns schema. */
  function decodeResult(ref: FunctionReference<any, any, any, any>, wireResult: any): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  return { encodeArgs, decodeResult }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/zodvex/__tests__/codec-helpers.test.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add packages/zodvex/src/codecHelpers.ts packages/zodvex/__tests__/codec-helpers.test.ts
git commit -m "feat: add createCodecHelpers — shared encode/decode primitive"
```

---

### Task 2: Export `createCodecHelpers` from `zodvex/core`

**Files:**
- Modify: `packages/zodvex/src/core/index.ts`
- Modify: `packages/zodvex/__tests__/exports.test.ts`

**Step 1: Write the failing test**

Add to the `zodvex/core exports` describe block in `exports.test.ts`:

```typescript
it('exports createCodecHelpers', async () => {
  const { createCodecHelpers } = await import('../src/core')
  expect(createCodecHelpers).toBeDefined()
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/exports.test.ts`
Expected: FAIL — `createCodecHelpers` not exported

**Step 3: Add the export**

In `packages/zodvex/src/core/index.ts`, add after the codec utilities line:

```typescript
// Codec helpers (shared encode/decode for client wrappers)
export { createCodecHelpers } from '../codecHelpers'
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/zodvex/__tests__/exports.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/zodvex/src/core/index.ts packages/zodvex/__tests__/exports.test.ts
git commit -m "feat: export createCodecHelpers from zodvex/core"
```

---

### Task 3: Refactor `ZodvexClient` — accept existing client, expose `.convex`

**Files:**
- Modify: `packages/zodvex/src/client/zodvexClient.ts`
- Modify: `packages/zodvex/src/client/index.ts`
- Modify: `packages/zodvex/__tests__/zodvex-client.test.ts`

**Step 1: Write the failing tests**

Add these tests to `zodvex-client.test.ts` inside the existing `describe('ZodvexClient', ...)`:

```typescript
// ---- constructor with existing client -----------------------------------

describe('constructor with existing client', () => {
  it('wraps an existing ConvexClient without creating a new one', () => {
    const existingClient = new (MockConvexClient as any)('https://existing.convex.cloud')
    const zc = new ZodvexClient(registry as any, { client: existingClient })
    expect(zc.convex).toBe(existingClient)
  })

  it('uses the existing client for queries', async () => {
    const existingClient = new (MockConvexClient as any)('https://existing.convex.cloud')
    const zc = new ZodvexClient(registry as any, { client: existingClient })

    const now = Date.now()
    mockQueryImpl = () => [{ _id: 'abc', title: 'Test', createdAt: now }]

    const result = await zc.query(fakeRef('tasks:list'))
    expect(result[0].createdAt).toBeInstanceOf(Date)
  })
})

// ---- .convex accessor ---------------------------------------------------

describe('.convex accessor', () => {
  it('exposes the inner ConvexClient', () => {
    expect(client.convex).toBeDefined()
    expect(client.convex).toBeInstanceOf(MockConvexClient)
  })
})
```

Also add at the top of the describe block after `createZodvexClient` import, add `ZodvexClient` to the destructuring (it's already there).

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/zodvex-client.test.ts`
Expected: FAIL — `.convex` property doesn't exist, constructor doesn't accept `{ client }`

**Step 3: Refactor the implementation**

Rewrite `packages/zodvex/src/client/zodvexClient.ts`:

```typescript
import type { AuthTokenFetcher } from 'convex/browser'
import { ConvexClient } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { createCodecHelpers } from '../codecHelpers'
import type { AnyRegistry } from '../types'

export type ZodvexClientOptions =
  | { url: string; token?: string | null }
  | { client: ConvexClient }

/** Wrap a static token string as an AuthTokenFetcher for ConvexClient */
function tokenToFetcher(token: string): AuthTokenFetcher {
  return async () => token
}

export class ZodvexClient<R extends AnyRegistry = AnyRegistry> {
  /** The underlying ConvexClient — exposed for sharing with other layers. */
  readonly convex: ConvexClient
  private codec: ReturnType<typeof createCodecHelpers>

  constructor(registry: R, options: ZodvexClientOptions) {
    this.codec = createCodecHelpers(registry)
    if ('client' in options) {
      this.convex = options.client
    } else {
      this.convex = new ConvexClient(options.url)
      if (options.token) this.convex.setAuth(tokenToFetcher(options.token))
    }
  }

  async query<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args']
  ): Promise<Q['_returnType']> {
    const wireResult = await this.convex.query(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  async mutate<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args']
  ): Promise<M['_returnType']> {
    const wireResult = await this.convex.mutation(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<M>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  subscribe<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    callback: (result: Q['_returnType']) => void
  ): () => void {
    const wireArgs = this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    return this.convex.onUpdate(ref, wireArgs, (wireResult: FunctionReturnType<Q>) => {
      callback(this.codec.decodeResult(ref, wireResult))
    })
  }

  setAuth(token: string | null) {
    this.convex.setAuth(async () => token)
  }

  async close() {
    await this.convex.close()
  }
}

export function createZodvexClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexClientOptions
): ZodvexClient<R> {
  return new ZodvexClient(registry, options)
}
```

Update `packages/zodvex/src/client/index.ts` to re-export the type:

```typescript
export type { ZodvexClientOptions } from './zodvexClient'
export { createZodvexClient, ZodvexClient } from './zodvexClient'
```

(This is unchanged — the type union is already captured by the export.)

**Step 4: Run all existing + new tests**

Run: `bun test packages/zodvex/__tests__/zodvex-client.test.ts`
Expected: PASS — all existing tests still green, new tests pass

**Step 5: Commit**

```bash
git add packages/zodvex/src/client/zodvexClient.ts packages/zodvex/src/client/index.ts packages/zodvex/__tests__/zodvex-client.test.ts
git commit -m "feat: ZodvexClient accepts existing ConvexClient, exposes .convex"
```

---

### Task 4: Refactor hooks and actionCtx to use `createCodecHelpers`

Internal refactor — existing tests are the safety net. No new tests needed.

**Files:**
- Modify: `packages/zodvex/src/react/hooks.ts`
- Modify: `packages/zodvex/src/actionCtx.ts`

**Step 1: Run existing tests to establish baseline**

Run: `bun test packages/zodvex/__tests__/react-hooks.test.ts packages/zodvex/__tests__/action-ctx.test.ts`
Expected: PASS — baseline green

**Step 2: Refactor `hooks.ts`**

Replace the inline encode/decode logic with `createCodecHelpers`:

```typescript
import type { OptionalRestArgsOrSkip } from 'convex/react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { createCodecHelpers } from '../codecHelpers'
import type { AnyRegistry } from '../types'

/**
 * Creates zodvex-aware React hooks that automatically decode query results
 * and encode mutation arguments using the Zod schemas in the registry.
 *
 * Returned hooks are drop-in replacements for Convex's `useQuery` and
 * `useMutation` — they delegate to the real hooks, then apply codec
 * transforms so that runtime types (e.g. Date) are used instead of wire
 * types (e.g. number timestamps).
 *
 * @param registry - A map of function paths to `{ args?, returns? }` Zod schemas.
 *   Typically generated by zodvex codegen into `_zodvex/client.ts`.
 *
 * @example
 * ```typescript
 * import { zodvexRegistry } from '../_zodvex/client'
 * export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)
 *
 * // In a component:
 * const tasks = useZodQuery(api.tasks.list, { status: 'active' })
 * //    ^? Task[] — createdAt is Date, not number
 * ```
 */
export function createZodvexHooks<R extends AnyRegistry>(registry: R) {
  const codec = createCodecHelpers(registry)

  // Overload 1: drop-in compatible with Convex's useQuery
  function useZodQuery<Query extends FunctionReference<'query', any, any, any>>(
    ref: Query,
    ...args: OptionalRestArgsOrSkip<Query>
  ): FunctionReturnType<Query> | undefined
  // Overload 2: composable — accepts Args | 'skip' union for wrappers
  function useZodQuery<Query extends FunctionReference<'query', any, any, any>>(
    ref: Query,
    args: Query['_args'] | 'skip'
  ): FunctionReturnType<Query> | undefined
  // Implementation
  function useZodQuery(ref: FunctionReference<'query', any, any, any>, ...restArgs: any[]) {
    const args = restArgs[0]
    const wireResult = useQuery(
      ref,
      ...((args === 'skip' ? ['skip'] : [args]) as OptionalRestArgsOrSkip<typeof ref>)
    )

    // Loading state — Convex returns undefined while the subscription is pending
    if (wireResult === undefined) return undefined

    // Decode: wire format -> runtime types (e.g., timestamp number -> Date)
    return codec.decodeResult(ref, wireResult)
  }

  /**
   * Drop-in replacement for Convex's `useMutation`.
   *
   * Returns an async function that:
   * 1. Encodes the args through the `args` schema (runtime -> wire format)
   * 2. Calls the real mutation with the wire args
   * 3. Decodes the result through the `returns` schema (wire -> runtime format)
   *
   * Functions not in the registry pass args and results through unchanged.
   */
  function useZodMutation<Mutation extends FunctionReference<'mutation', any, any, any>>(
    ref: Mutation
  ) {
    const rawMutate = useMutation(ref)

    return async (args: FunctionArgs<Mutation>): Promise<FunctionReturnType<Mutation>> => {
      const wireArgs = codec.encodeArgs(ref, args)
      const wireResult = await (rawMutate as any)(wireArgs)
      return codec.decodeResult(ref, wireResult)
    }
  }

  return { useZodQuery, useZodMutation }
}

/**
 * The return type of `createZodvexHooks` — useful for typing module-level
 * exports in generated client files.
 */
export type ZodvexHooks = ReturnType<typeof createZodvexHooks>
```

**Step 3: Refactor `actionCtx.ts`**

```typescript
import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import { createCodecHelpers } from './codecHelpers'
import type { AnyRegistry } from './types'

/**
 * Wraps an action context's runQuery/runMutation with automatic
 * codec transforms via the zodvex registry.
 *
 * - Args are encoded (runtime -> wire) before calling the inner function
 * - Results are decoded (wire -> runtime) before returning to the handler
 * - Functions not in the registry pass through unchanged
 *
 * @internal Used by initZodvex when registry option is provided.
 */
export function createZodvexActionCtx<DM extends GenericDataModel>(
  registry: AnyRegistry,
  ctx: GenericActionCtx<DM>
): GenericActionCtx<DM> {
  const codec = createCodecHelpers(registry)

  return {
    ...ctx,
    runQuery: async (ref: any, ...restArgs: any[]) => {
      const wireArgs = codec.encodeArgs(ref, restArgs[0])
      const wireResult = await ctx.runQuery(ref, wireArgs)
      return codec.decodeResult(ref, wireResult)
    },
    runMutation: async (ref: any, ...restArgs: any[]) => {
      const wireArgs = codec.encodeArgs(ref, restArgs[0])
      const wireResult = await ctx.runMutation(ref, wireArgs)
      return codec.decodeResult(ref, wireResult)
    }
  } as GenericActionCtx<DM>
}
```

**Step 4: Run existing tests to verify no regressions**

Run: `bun test packages/zodvex/__tests__/react-hooks.test.ts packages/zodvex/__tests__/action-ctx.test.ts packages/zodvex/__tests__/zodvex-client.test.ts`
Expected: PASS — all existing tests still green

**Step 5: Commit**

```bash
git add packages/zodvex/src/react/hooks.ts packages/zodvex/src/actionCtx.ts
git commit -m "refactor: hooks and actionCtx use createCodecHelpers internally"
```

---

### Task 5: `ZodvexReactClient` — new class

**Files:**
- Create: `packages/zodvex/src/react/zodvexReactClient.ts`
- Modify: `packages/zodvex/src/react/index.ts`
- Create: `packages/zodvex/__tests__/zodvex-react-client.test.ts`

**Step 1: Write the failing test**

Create `packages/zodvex/__tests__/zodvex-react-client.test.ts`:

```typescript
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/react — simulate ConvexReactClient
// ---------------------------------------------------------------------------

let mockQueryImpl: ((ref: any, args: any) => any) | undefined
let mockMutationImpl: ((ref: any, args: any) => any) | undefined
let mockActionImpl: ((ref: any, args: any) => any) | undefined
let mockWatchQueryImpl:
  | ((ref: any, args: any, opts: any) => { onUpdate: any; localQueryResult: any; journal: any })
  | undefined
let mockSetAuthCalls: any[] = []
let mockClearAuthCalled = false
let mockCloseCalled = false

class MockConvexReactClient {
  constructor(public address: string) {}

  get url() {
    return this.address
  }

  async query(ref: any, ...args: any[]) {
    if (mockQueryImpl) return mockQueryImpl(ref, args[0])
    return args[0]
  }

  async mutation(ref: any, ...argsAndOptions: any[]) {
    if (mockMutationImpl) return mockMutationImpl(ref, argsAndOptions[0])
    return argsAndOptions[0]
  }

  async action(ref: any, ...args: any[]) {
    if (mockActionImpl) return mockActionImpl(ref, args[0])
    return args[0]
  }

  watchQuery(ref: any, ...argsAndOptions: any[]) {
    if (mockWatchQueryImpl) return mockWatchQueryImpl(ref, argsAndOptions[0], argsAndOptions[1])
    return {
      onUpdate: (cb: () => void) => () => {},
      localQueryResult: () => undefined,
      journal: () => undefined
    }
  }

  prewarmQuery(_opts: any) {}

  setAuth(...args: any[]) {
    mockSetAuthCalls.push(args)
  }

  clearAuth() {
    mockClearAuthCalled = true
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true }
  }

  subscribeToConnectionState(cb: any) {
    return () => {}
  }

  async close() {
    mockCloseCalled = true
  }
}

mock.module('convex/react', () => ({
  ConvexReactClient: MockConvexReactClient
}))

mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

const { ZodvexReactClient, createZodvexReactClient } = await import(
  '../src/react/zodvexReactClient'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeRef(path: string) {
  return { _testPath: path } as any
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const taskReturnsSchema = z.object({
  _id: z.string(),
  title: z.string(),
  createdAt: zx.date()
})

const taskArgsSchema = z.object({
  title: z.string(),
  dueAt: zx.date()
})

const registry = {
  'tasks:list': { returns: z.array(taskReturnsSchema) },
  'tasks:create': { args: taskArgsSchema, returns: taskReturnsSchema },
  'plain:noCodec': {}
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZodvexReactClient', () => {
  let client: InstanceType<typeof ZodvexReactClient>
  let mockInner: InstanceType<typeof MockConvexReactClient>

  beforeEach(() => {
    mockQueryImpl = undefined
    mockMutationImpl = undefined
    mockActionImpl = undefined
    mockWatchQueryImpl = undefined
    mockSetAuthCalls = []
    mockClearAuthCalled = false
    mockCloseCalled = false
    mockInner = new (MockConvexReactClient as any)('https://test.convex.cloud')
    client = createZodvexReactClient(registry as any, { client: mockInner })
  })

  // ---- constructor -------------------------------------------------------

  describe('constructor', () => {
    it('wraps an existing ConvexReactClient', () => {
      expect(client.convex).toBe(mockInner)
    })

    it('creates a ConvexReactClient from url', () => {
      const c = createZodvexReactClient(registry as any, { url: 'https://new.convex.cloud' })
      expect(c.convex).toBeDefined()
      expect(c.convex.url).toBe('https://new.convex.cloud')
    })

    it('returns a ZodvexReactClient instance', () => {
      expect(client).toBeInstanceOf(ZodvexReactClient)
    })
  })

  // ---- query -------------------------------------------------------------

  describe('query', () => {
    it('encodes args and decodes results', async () => {
      const ts = 1700000000000
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockQueryImpl = (_ref, args) => {
        capturedArgs = args
        return { _id: 'abc', title: 'Test', createdAt: ts }
      }

      const result = await client.query(fakeRef('tasks:create'), {
        title: 'Test',
        dueAt: dueDate
      })

      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('passes through when function not in registry', async () => {
      const raw = { foo: 'bar' }
      mockQueryImpl = () => raw
      const result = await client.query(fakeRef('unknown:fn'), {})
      expect(result).toEqual(raw)
    })
  })

  // ---- mutation ----------------------------------------------------------

  describe('mutation', () => {
    it('encodes args and decodes results', async () => {
      const ts = 1700000000000
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockMutationImpl = (_ref, args) => {
        capturedArgs = args
        return { _id: 'new1', title: 'Created', createdAt: ts }
      }

      const result = await client.mutation(fakeRef('tasks:create'), {
        title: 'Created',
        dueAt: dueDate
      })

      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ---- action ------------------------------------------------------------

  describe('action', () => {
    it('encodes args and decodes results', async () => {
      const ts = 1700000000000
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockActionImpl = (_ref, args) => {
        capturedArgs = args
        return { _id: 'act1', title: 'Action', createdAt: ts }
      }

      const result = await client.action(fakeRef('tasks:create'), {
        title: 'Action',
        dueAt: dueDate
      })

      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ---- watchQuery --------------------------------------------------------

  describe('watchQuery', () => {
    it('decodes localQueryResult via codec', () => {
      const ts = 1700000000000
      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => () => {},
        localQueryResult: () => [{ _id: 'abc', title: 'Watch', createdAt: ts }],
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'), {})
      const result = watch.localQueryResult()

      expect(result).toHaveLength(1)
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(ts)
    })

    it('returns undefined from localQueryResult when loading', () => {
      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => () => {},
        localQueryResult: () => undefined,
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'), {})
      expect(watch.localQueryResult()).toBeUndefined()
    })

    it('memoizes decoded result by wire reference identity', () => {
      const wireData = [{ _id: 'abc', title: 'Memo', createdAt: 1700000000000 }]
      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => () => {},
        localQueryResult: () => wireData, // same reference each call
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'), {})
      const result1 = watch.localQueryResult()
      const result2 = watch.localQueryResult()

      // Same wire reference → same decoded reference (memoized)
      expect(result1).toBe(result2)
    })

    it('re-decodes when wire reference changes', () => {
      let callCount = 0
      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => () => {},
        localQueryResult: () => {
          callCount++
          // New array each call = new reference
          return [{ _id: 'abc', title: `Call ${callCount}`, createdAt: 1700000000000 }]
        },
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'), {})
      const result1 = watch.localQueryResult()
      const result2 = watch.localQueryResult()

      // Different wire references → different decoded objects
      expect(result1).not.toBe(result2)
    })

    it('encodes args passed to watchQuery', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockWatchQueryImpl = (_ref, args) => {
        capturedArgs = args
        return {
          onUpdate: (cb: () => void) => () => {},
          localQueryResult: () => undefined,
          journal: () => undefined
        }
      }

      client.watchQuery(fakeRef('tasks:create'), { title: 'Watch', dueAt: dueDate })

      expect(capturedArgs).toBeDefined()
      expect(typeof capturedArgs.dueAt).toBe('number')
    })

    it('delegates onUpdate and journal unchanged', () => {
      let onUpdateCalled = false
      const journalValue = { cursor: 'abc' }
      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => {
          onUpdateCalled = true
          return () => {}
        },
        localQueryResult: () => undefined,
        journal: () => journalValue
      })

      const watch = client.watchQuery(fakeRef('tasks:list'), {})
      watch.onUpdate(() => {})
      expect(onUpdateCalled).toBe(true)
      expect(watch.journal()).toBe(journalValue)
    })
  })

  // ---- pass-through methods ----------------------------------------------

  describe('pass-through methods', () => {
    it('delegates setAuth', () => {
      const fetcher = async () => 'token'
      client.setAuth(fetcher)
      expect(mockSetAuthCalls).toHaveLength(1)
    })

    it('delegates clearAuth', () => {
      client.clearAuth()
      expect(mockClearAuthCalled).toBe(true)
    })

    it('delegates close', async () => {
      await client.close()
      expect(mockCloseCalled).toBe(true)
    })

    it('exposes url from inner client', () => {
      expect(client.url).toBe('https://test.convex.cloud')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/zodvex-react-client.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `packages/zodvex/src/react/zodvexReactClient.ts`:

```typescript
import { ConvexReactClient } from 'convex/react'
import type {
  ArgsAndOptions,
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  MutationOptions,
  OptionalRestArgs,
  Watch,
  WatchQueryOptions
} from 'convex/react'
import type { AuthTokenFetcher } from 'convex/browser'
import { createCodecHelpers } from '../codecHelpers'
import type { AnyRegistry } from '../types'

export type ZodvexReactClientOptions =
  | { url: string }
  | { client: ConvexReactClient }

export class ZodvexReactClient<R extends AnyRegistry = AnyRegistry> {
  /** The underlying ConvexReactClient — pass to ConvexProvider or auth providers. */
  readonly convex: ConvexReactClient
  private codec: ReturnType<typeof createCodecHelpers>

  constructor(registry: R, options: ZodvexReactClientOptions) {
    this.codec = createCodecHelpers(registry)
    if ('client' in options) {
      this.convex = options.client
    } else {
      this.convex = new ConvexReactClient(options.url)
    }
  }

  // --- Data methods (codec-wrapped) ---

  async query<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    ...args: OptionalRestArgs<Q>
  ): Promise<Q['_returnType']> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.query(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  async mutation<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    ...args: OptionalRestArgs<M>
  ): Promise<M['_returnType']> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.mutation(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  async action<A extends FunctionReference<'action', any, any, any>>(
    ref: A,
    ...args: OptionalRestArgs<A>
  ): Promise<A['_returnType']> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.action(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  watchQuery<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    ...argsAndOptions: any[]
  ): Watch<FunctionReturnType<Q>> {
    const wireArgs = this.codec.encodeArgs(ref, argsAndOptions[0])
    const innerWatch = this.convex.watchQuery(ref, wireArgs, argsAndOptions[1])

    // Memoize last decoded result by wire reference identity to avoid
    // redundant Zod parse when localQueryResult() is called multiple times
    // between server transitions.
    //
    // Convex's client creates a new object per server transition via
    // jsonToConvex() in remote_query_set.ts, but returns the same reference
    // for repeated reads within a single transition window.
    // See: convex/src/browser/sync/optimistic_updates_impl.ts
    //   TODO(CX-733) — Convex's internal tracker for client-side result
    //   memoization (not yet public).
    let lastWire: unknown
    let lastDecoded: unknown

    return {
      onUpdate: (cb: () => void) => innerWatch.onUpdate(cb),
      localQueryResult: () => {
        const wire = innerWatch.localQueryResult()
        if (wire === lastWire) return lastDecoded as FunctionReturnType<Q> | undefined
        lastWire = wire
        lastDecoded =
          wire === undefined ? undefined : this.codec.decodeResult(ref, wire)
        return lastDecoded as FunctionReturnType<Q> | undefined
      },
      journal: () => innerWatch.journal()
    } as Watch<FunctionReturnType<Q>>
  }

  // --- Pass-through methods (no codec needed) ---

  setAuth(fetchToken: AuthTokenFetcher, onChange?: (isAuthenticated: boolean) => void): void {
    this.convex.setAuth(fetchToken, onChange)
  }

  clearAuth(): void {
    this.convex.clearAuth()
  }

  async close(): Promise<void> {
    await this.convex.close()
  }

  get url(): string {
    return this.convex.url
  }

  connectionState() {
    return this.convex.connectionState()
  }

  subscribeToConnectionState(cb: (state: any) => void): () => void {
    return this.convex.subscribeToConnectionState(cb)
  }
}

export function createZodvexReactClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexReactClientOptions
): ZodvexReactClient<R> {
  return new ZodvexReactClient(registry, options)
}
```

**Note:** The exact type imports from `convex/react` may need adjustment based on what's actually exported. The implementation should match what the Convex SDK exposes. Use `any` casts where Convex types are overly restrictive — the test suite validates runtime behavior.

**Step 4: Run test to verify it passes**

Run: `bun test packages/zodvex/__tests__/zodvex-react-client.test.ts`
Expected: PASS

**Step 5: Update `react/index.ts` exports**

Modify `packages/zodvex/src/react/index.ts`:

```typescript
export type { ZodvexHooks } from './hooks'
export { createZodvexHooks } from './hooks'
export type { ZodvexReactClientOptions } from './zodvexReactClient'
export { createZodvexReactClient, ZodvexReactClient } from './zodvexReactClient'
```

**Step 6: Run full test suite**

Run: `bun test`
Expected: PASS — no regressions

**Step 7: Commit**

```bash
git add packages/zodvex/src/react/zodvexReactClient.ts packages/zodvex/src/react/index.ts packages/zodvex/__tests__/zodvex-react-client.test.ts
git commit -m "feat: add ZodvexReactClient with codec transforms on all data methods"
```

---

### Task 6: Update codegen to emit new exports

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts`
- Modify: `packages/zodvex/__tests__/codegen-generate.test.ts` (if it asserts on client.ts content)

**Step 1: Update `generateClientFile()`**

In `packages/zodvex/src/codegen/generate.ts`, replace the `generateClientFile` function:

```typescript
export function generateClientFile(): string {
  return `${HEADER}
import { createZodvexHooks } from 'zodvex/react'
import { createZodvexReactClient, type ZodvexReactClientOptions } from 'zodvex/react'
import { createZodvexClient, type ZodvexClientOptions } from 'zodvex/client'
import { createCodecHelpers } from 'zodvex/core'
import { zodvexRegistry } from './api'

export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

export const createClient = (options: ZodvexClientOptions) =>
  createZodvexClient(zodvexRegistry, options)

export const createReactClient = (options: ZodvexReactClientOptions) =>
  createZodvexReactClient(zodvexRegistry, options)

export const { encodeArgs, decodeResult } = createCodecHelpers(zodvexRegistry)
`
}
```

**Step 2: Update codegen tests if needed**

Check `packages/zodvex/__tests__/codegen-generate.test.ts` — if it asserts on the exact content of `generateClientFile()`, update the assertions to include the new exports.

**Step 3: Run codegen tests**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: PASS

**Step 4: Run full test suite**

Run: `bun test`
Expected: PASS — all green

**Step 5: Commit**

```bash
git add packages/zodvex/src/codegen/generate.ts packages/zodvex/__tests__/codegen-generate.test.ts
git commit -m "feat: codegen emits createReactClient and codec helpers in client.ts"
```

---

### Task 7: Final verification — build, lint, type-check

**Step 1: Build**

Run: `bun run build`
Expected: Clean build, no errors

**Step 2: Type-check**

Run: `bun run type-check`
Expected: No type errors

**Step 3: Lint**

Run: `bun run lint`
Expected: Clean (run `bun run lint:fix` if needed)

**Step 4: Full test suite**

Run: `bun test`
Expected: All tests pass

**Step 5: Commit any lint/format fixes**

```bash
git add -A
git commit -m "chore: lint and format fixes"
```
