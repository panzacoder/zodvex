# Decode Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `decodeResult()` use `.safeParse()` with warn-by-default, throw-on-opt-in behavior so decode failures never crash React render.

**Architecture:** Add `ZodvexDecodeError` (extends `z.ZodError`) to `codecHelpers.ts`. Add `onDecodeError: 'warn' | 'throw'` option to `createCodecHelpers()`. Thread the option through all consumers: `createZodvexHooks`, `ZodvexClient`, `ZodvexReactClient`, `createZodvexActionCtx`, and codegen output.

**Tech Stack:** Zod v4, TypeScript, Bun test runner

**Design doc:** `docs/plans/2026-03-02-decode-error-handling-design.md`

---

### Task 1: ZodvexDecodeError class + decodeResult safeParse

**Files:**
- Modify: `packages/zodvex/src/codecHelpers.ts`
- Test: `packages/zodvex/__tests__/codecHelpers.test.ts` (create)

**Step 1: Write the failing tests**

Create `packages/zodvex/__tests__/codecHelpers.test.ts`:

```typescript
import { describe, expect, it, mock, spyOn } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// Mock convex/server
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

const { createCodecHelpers, ZodvexDecodeError } = await import('../src/codecHelpers')

function fakeRef(path: string) {
  return { _testPath: path } as any
}

const registry = {
  'tasks:get': {
    returns: z.object({
      _id: z.string(),
      title: z.string(),
      createdAt: zx.date()
    })
  }
} as any

describe('ZodvexDecodeError', () => {
  it('is an instance of z.ZodError', () => {
    const err = new ZodvexDecodeError('tasks:get', [], { bad: 'data' })
    expect(err).toBeInstanceOf(z.ZodError)
    expect(err).toBeInstanceOf(ZodvexDecodeError)
  })

  it('has functionPath and wireData properties', () => {
    const wire = { bad: 'data' }
    const err = new ZodvexDecodeError('tasks:get', [], wire)
    expect(err.functionPath).toBe('tasks:get')
    expect(err.wireData).toBe(wire)
  })
})

describe('decodeResult', () => {
  it('default (warn): logs warning and returns raw wire data on decode failure', () => {
    const codec = createCodecHelpers(registry)
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})

    // Pass invalid data — title should be string, not number
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result).toBe(wire) // raw wire data returned
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('tasks:get')
    warnSpy.mockRestore()
  })

  it('throw mode: throws ZodvexDecodeError on decode failure', () => {
    const codec = createCodecHelpers(registry, { onDecodeError: 'throw' })
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }

    try {
      codec.decodeResult(fakeRef('tasks:get'), wire)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZodvexDecodeError)
      expect(err).toBeInstanceOf(z.ZodError)
      expect(err.functionPath).toBe('tasks:get')
      expect(err.wireData).toBe(wire)
    }
  })

  it('successful decode still works normally', () => {
    const codec = createCodecHelpers(registry)
    const wire = { _id: 'x', title: 'Hello', createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result.title).toBe('Hello')
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  it('passthrough when function not in registry (unchanged)', () => {
    const codec = createCodecHelpers(registry)
    const wire = { anything: 'goes' }
    const result = codec.decodeResult(fakeRef('unknown:fn'), wire)
    expect(result).toBe(wire)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codecHelpers.test.ts`
Expected: FAIL — `ZodvexDecodeError` not exported, `createCodecHelpers` doesn't accept options

**Step 3: Implement ZodvexDecodeError + safeParse in codecHelpers.ts**

Modify `packages/zodvex/src/codecHelpers.ts`:

```typescript
import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import { safeEncode } from './normalizeCodecPaths'
import type { AnyRegistry } from './types'
import { stripUndefined } from './utils'

/**
 * Options for codec helper behavior.
 */
export type CodecHelpersOptions = {
  /**
   * How to handle decode failures (schema validation errors on wire data).
   *
   * - `'warn'` (default): log a console.warn and return raw wire data untransformed.
   * - `'throw'`: throw a ZodvexDecodeError (extends z.ZodError).
   */
  onDecodeError?: 'warn' | 'throw'
}

/**
 * Decode error with function path and wire data context.
 * Extends z.ZodError for compatibility with existing Zod tooling
 * (instanceof ZodError checks, Sentry, error boundaries, etc.).
 */
export class ZodvexDecodeError extends z.ZodError {
  readonly functionPath: string
  readonly wireData: unknown

  constructor(functionPath: string, issues: z.core.$ZodIssue[], wireData: unknown) {
    super(issues)
    this.functionPath = functionPath
    this.wireData = wireData
    this.name = 'ZodvexDecodeError'
  }
}

/**
 * Creates shared encode/decode helpers bound to a zodvex registry.
 *
 * These are the core primitives used by all codec boundary implementations:
 * - `encodeArgs`: runtime types -> wire format (e.g., Date -> timestamp number)
 * - `decodeResult`: wire format -> runtime types (e.g., timestamp number -> Date)
 *
 * Both look up the function reference in the registry to find the appropriate
 * Zod schema, then apply the codec transform. Functions not in the registry
 * (or without the relevant schema) pass through unchanged.
 *
 * @param registry - A map of function paths to `{ args?, returns? }` Zod schemas.
 * @param options - Optional configuration for decode error behavior.
 */
export function createCodecHelpers(registry: AnyRegistry, options?: CodecHelpersOptions) {
  const onDecodeError = options?.onDecodeError ?? 'warn'

  /**
   * Encode args from runtime types to wire format.
   *
   * Uses `safeEncode` (not raw `z.encode`) to normalize codec-internal
   * error paths in ZodErrors, then strips undefined values for Convex
   * serialization compatibility.
   *
   * Passthrough when:
   * - args is null/undefined
   * - function is not in the registry
   * - registry entry has no args schema
   */
  function encodeArgs(ref: FunctionReference<any, any, any, any>, args: any): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    return entry?.args && args != null ? stripUndefined(safeEncode(entry.args, args)) : args
  }

  /**
   * Decode a wire result back to runtime types.
   *
   * Uses `.safeParse()` to decode. On failure:
   * - 'warn' (default): logs warning, returns raw wireResult
   * - 'throw': throws ZodvexDecodeError (extends z.ZodError)
   *
   * Passthrough when:
   * - function is not in the registry
   * - registry entry has no returns schema
   */
  function decodeResult(ref: FunctionReference<any, any, any, any>, wireResult: any): any {
    const path = getFunctionName(ref)
    const entry = registry[path]
    if (!entry?.returns) return wireResult

    const result = entry.returns.safeParse(wireResult)
    if (result.success) return result.data

    if (onDecodeError === 'throw') {
      throw new ZodvexDecodeError(path, result.error.issues, wireResult)
    }

    // Default: warn and return raw wire data
    const preview = JSON.stringify(wireResult)
    const truncated = preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
    console.warn(
      `[zodvex] Decode failed for ${path}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}. Returning raw wire data. Preview: ${truncated}`
    )
    return wireResult
  }

  return { encodeArgs, decodeResult }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codecHelpers.test.ts`
Expected: PASS

**Step 5: Export ZodvexDecodeError + CodecHelpersOptions from core**

Modify `packages/zodvex/src/core/index.ts` — update the codecHelpers export line:

```typescript
// Codec helpers (shared encode/decode for client wrappers)
export { createCodecHelpers, ZodvexDecodeError, type CodecHelpersOptions } from '../codecHelpers'
```

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS (existing behavior unchanged — default is 'warn', and existing tests pass valid data)

**Step 7: Commit**

```bash
git add packages/zodvex/src/codecHelpers.ts packages/zodvex/src/core/index.ts packages/zodvex/__tests__/codecHelpers.test.ts
git commit -m "feat: add ZodvexDecodeError and safeParse decode with warn/throw option"
```

---

### Task 2: Thread onDecodeError through createZodvexHooks

**Files:**
- Modify: `packages/zodvex/src/react/hooks.ts`
- Modify: `packages/zodvex/__tests__/react-hooks.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of the `useZodQuery` describe block in `packages/zodvex/__tests__/react-hooks.test.ts`:

```typescript
    it('default: warns and returns raw wire data on decode failure', () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
      // title should be string — pass a number to trigger decode failure
      mockQueryResult = [{ _id: 'abc', title: 123, createdAt: Date.now() }]

      const result = useZodQuery(fakeRef('tasks:list'))

      expect(result).toBe(mockQueryResult) // raw wire data
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('throw mode: throws ZodvexDecodeError on decode failure', () => {
      const throwHooks = createZodvexHooks(registry as any, { onDecodeError: 'throw' })
      mockQueryResult = [{ _id: 'abc', title: 123, createdAt: Date.now() }]

      expect(() => throwHooks.useZodQuery(fakeRef('tasks:list'))).toThrow()
    })
```

Add `spyOn` to the imports at the top of the file:
```typescript
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/react-hooks.test.ts`
Expected: FAIL — `createZodvexHooks` doesn't accept options

**Step 3: Thread options through hooks.ts**

Modify `packages/zodvex/src/react/hooks.ts` — update `createZodvexHooks` signature:

```typescript
import type { CodecHelpersOptions } from '../codecHelpers'

export function createZodvexHooks<R extends AnyRegistry>(registry: R, options?: CodecHelpersOptions) {
  const codec = createCodecHelpers(registry, options)
  // ... rest unchanged
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/react-hooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/zodvex/src/react/hooks.ts packages/zodvex/__tests__/react-hooks.test.ts
git commit -m "feat: thread onDecodeError option through createZodvexHooks"
```

---

### Task 3: Thread onDecodeError through ZodvexClient + ZodvexReactClient

**Files:**
- Modify: `packages/zodvex/src/client/zodvexClient.ts`
- Modify: `packages/zodvex/src/react/zodvexReactClient.ts`

**Step 1: Update ZodvexClient**

In `packages/zodvex/src/client/zodvexClient.ts`:

Add `onDecodeError` to `ZodvexClientOptions`:

```typescript
import type { CodecHelpersOptions } from '../codecHelpers'

export type ZodvexClientOptions = ({ url: string; token?: string | null } | { client: ConvexClient }) & CodecHelpersOptions
```

Update constructor to pass options:

```typescript
  constructor(registry: R, options: ZodvexClientOptions) {
    this.codec = createCodecHelpers(registry, { onDecodeError: options.onDecodeError })
    // ... rest unchanged
```

**Step 2: Update ZodvexReactClient**

In `packages/zodvex/src/react/zodvexReactClient.ts`:

Add `onDecodeError` to `ZodvexReactClientOptions`:

```typescript
import type { CodecHelpersOptions } from '../codecHelpers'

export type ZodvexReactClientOptions = ({ url: string } | { client: ConvexReactClient }) & CodecHelpersOptions
```

Update constructor:

```typescript
  constructor(registry: R, options: ZodvexReactClientOptions) {
    this.codec = createCodecHelpers(registry, { onDecodeError: options.onDecodeError })
    // ... rest unchanged
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS — no breaking changes, default behavior unchanged

**Step 4: Commit**

```bash
git add packages/zodvex/src/client/zodvexClient.ts packages/zodvex/src/react/zodvexReactClient.ts
git commit -m "feat: thread onDecodeError through ZodvexClient and ZodvexReactClient"
```

---

### Task 4: Thread onDecodeError through actionCtx

**Files:**
- Modify: `packages/zodvex/src/actionCtx.ts`

**Step 1: Update createZodvexActionCtx**

In `packages/zodvex/src/actionCtx.ts`:

```typescript
import type { CodecHelpersOptions } from './codecHelpers'

export function createZodvexActionCtx<DM extends GenericDataModel>(
  registry: AnyRegistry,
  ctx: GenericActionCtx<DM>,
  options?: CodecHelpersOptions
): GenericActionCtx<DM> {
  const codec = createCodecHelpers(registry, options)
  // ... rest unchanged
```

**Step 2: Find and update callers of createZodvexActionCtx**

Search for `createZodvexActionCtx(` in `src/` — thread the options through from `initZodvex` or wherever it's called.

**Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/zodvex/src/actionCtx.ts
git commit -m "feat: thread onDecodeError through createZodvexActionCtx"
```

---

### Task 5: Update codegen output

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts`

**Step 1: Update generated client.ts template**

The codegen output in `generate.ts` creates:
```typescript
export const { encodeArgs, decodeResult } = createCodecHelpers(zodvexRegistry)
```

This should remain as-is — the default ('warn') is correct for generated code. No changes needed unless we want to thread an option through codegen config.

**Step 2: Verify codegen tests still pass**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: PASS — generated output unchanged

**Step 3: Commit (skip if no changes)**

No commit needed if codegen output is unchanged.

---

### Task 6: Build + type-check + final verification

**Step 1: Run type-check**

Run: `bun run type-check`
Expected: PASS (or pre-existing init.ts error only)

**Step 2: Run full test suite**

Run: `bun test`
Expected: All PASS

**Step 3: Run build**

Run: `bun run build`
Expected: tsup succeeds

**Step 4: Run lint**

Run: `bun run lint`
Expected: PASS or minor formatting issues (fix with `bun run lint:fix`)
