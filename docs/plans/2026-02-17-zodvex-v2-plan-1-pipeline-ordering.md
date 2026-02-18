# Plan 1: Pipeline Ordering Fix + De-Risking Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the pipeline ordering bug in `customFnBuilder` so `onSuccess` runs before Zod encode, then prove it with de-risking tests.

**Architecture:** `customFnBuilder` in `src/custom.ts` currently runs `onSuccess` AFTER `validateReturns` (which calls `z.encode`) and `stripUndefined`. The correct order is: handler -> onSuccess (sees runtime types) -> validateReturns/z.encode -> stripUndefined -> return. This fix is the foundation for the entire v2 redesign — if `onSuccess` doesn't see runtime types, the decision to eliminate `transforms.output` and `boundary` config unravels.

**Tech Stack:** TypeScript, Zod v4, Bun test runner, convex-helpers

**Prerequisite reading:**
- `docs/plans/2026-02-17-zodvex-v2-redesign.md` (Section: Pipeline Design)
- `docs/decisions/2026-02-17-runtime-only-middleware.md`

---

### Task 1: Write the pipeline ordering test — `onSuccess` sees runtime types

This is the highest-priority de-risking test. It proves that after the fix, `onSuccess` receives Date instances and custom codec objects, not timestamps and wire format.

**Files:**
- Create: `__tests__/pipeline-ordering.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customFnBuilder } from '../src/custom'
import { zx } from '../src/zx'

// Minimal builder stub that mimics Convex builder
function makeBuilder() {
  return function builder(config: { args?: any; returns?: any; handler: (ctx: any, args: any) => any }) {
    return async (ctx: any, args: any) => config.handler(ctx, args)
  }
}

describe('Pipeline ordering: onSuccess sees runtime types', () => {
  it('onSuccess receives Date instances, not timestamps', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    const customization = {
      args: {},
      input: async (ctx: any) => ({
        ctx: {},
        args: {},
        hooks: {
          onSuccess: ({ result }: any) => {
            onSuccessResult = result
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => {
        return { when: args.when } // args.when is a Date after Zod parse
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    await fn({}, { when: timestamp })

    // CRITICAL: onSuccess must see the Date instance, NOT the encoded timestamp
    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.when).toBeInstanceOf(Date)
    expect(onSuccessResult.when.getTime()).toBe(timestamp)
  })

  it('wire result returned to client is a timestamp (not a Date)', async () => {
    const builder = makeBuilder()
    let wireResult: any = null

    const customization = {
      args: {},
      input: async (ctx: any) => ({
        ctx: {},
        args: {},
        hooks: {
          onSuccess: ({ result }: any) => {
            // onSuccess sees runtime types
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { when: zx.date() },
      returns: z.object({ when: zx.date() }),
      handler: async (_ctx: any, args: any) => {
        return { when: args.when }
      }
    }) as any

    const timestamp = new Date('2025-06-15T00:00:00Z').getTime()
    wireResult = await fn({}, { when: timestamp })

    // Wire result must be encoded (number, not Date)
    expect(typeof wireResult.when).toBe('number')
    expect(wireResult.when).toBe(timestamp)
  })
})
```

**Step 2: Run the test to verify it fails**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: FAIL — `onSuccessResult.when` is a `number` (timestamp), not a `Date`, because `onSuccess` currently runs after `validateReturns` which encodes Date -> timestamp.

**Step 3: Commit the failing test**

```bash
git add __tests__/pipeline-ordering.test.ts
git commit -m "test: add failing test for pipeline ordering bug (onSuccess sees wire types)"
```

---

### Task 2: Fix the pipeline ordering in `customFnBuilder`

**Files:**
- Modify: `src/custom.ts` (lines ~391-419 and ~449-473 — the two handler blocks in `customFnBuilder`)

**Step 1: Understand the current (buggy) pipeline**

The current order in the with-args path (lines 391-419):
```
handler -> transforms.output -> validateReturns(z.encode) -> stripUndefined -> onSuccess -> return
```

The correct order:
```
handler -> onSuccess(sees runtime result) -> validateReturns(z.encode) -> stripUndefined -> return
```

Note: `transforms.output` is being eliminated by this redesign. For now, move `onSuccess` before `validateReturns` and leave `transforms.output` where it is (it will be deprecated in Plan 4).

**Step 2: Fix the with-args handler path**

In `src/custom.ts`, find the handler block starting around line 391. Replace the section from `const ret = await handler(...)` through `return result`:

Current (buggy — lines ~391-419):
```typescript
          const ret = await handler(finalCtx, finalArgs)
          // Always run Zod return validation when returns schema is provided
          if (returns) {
            const preTransformed = added?.transforms?.output
              ? await added.transforms.output(ret, returns as z.ZodTypeAny)
              : ret

            const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
            const result = stripUndefined(validated)
            if (added?.hooks?.onSuccess) {
              await added.hooks.onSuccess({
                ctx,
                args: parsed.data,
                result
              })
            }
            return result
          }
          const result = stripUndefined(ret)
          if (added?.hooks?.onSuccess) {
            await added.hooks.onSuccess({ ctx, args: parsed.data, result })
          }
          return result
```

Fixed:
```typescript
          const ret = await handler(finalCtx, finalArgs)

          // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
          if (added?.hooks?.onSuccess) {
            await added.hooks.onSuccess({
              ctx: finalCtx,
              args: parsed.data,
              result: ret
            })
          }

          // Always run Zod return validation when returns schema is provided
          if (returns) {
            const preTransformed = added?.transforms?.output
              ? await added.transforms.output(ret, returns as z.ZodTypeAny)
              : ret

            const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
            return stripUndefined(validated)
          }
          return stripUndefined(ret)
```

**Step 3: Fix the no-args handler path**

Same fix for the second handler block (around lines ~449-473):

Current (buggy):
```typescript
        const ret = await handler(finalCtx, finalArgs)
        if (returns) {
          const preTransformed = added?.transforms?.output
            ? await added.transforms.output(ret, returns as z.ZodTypeAny)
            : ret

          const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
          const result = stripUndefined(validated)
          if (added?.hooks?.onSuccess) {
            await added.hooks.onSuccess({ ctx, args: allArgs, result })
          }
          return result
        }
        const result = stripUndefined(ret)
        if (added?.hooks?.onSuccess) {
          await added.hooks.onSuccess({ ctx, args: allArgs, result })
        }
        return result
```

Fixed:
```typescript
        const ret = await handler(finalCtx, finalArgs)

        // onSuccess MUST run before encode — sees runtime types (Date, SensitiveWrapper)
        if (added?.hooks?.onSuccess) {
          await added.hooks.onSuccess({
            ctx: finalCtx,
            args: allArgs,
            result: ret
          })
        }

        if (returns) {
          const preTransformed = added?.transforms?.output
            ? await added.transforms.output(ret, returns as z.ZodTypeAny)
            : ret

          const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)
          return stripUndefined(validated)
        }
        return stripUndefined(ret)
```

**Step 4: Run the pipeline ordering test**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS — `onSuccess` now sees Date instances.

**Step 5: Run the full test suite to check for regressions**

Run: `bun test`
Expected: All tests pass. The only behavioral change is the timing of `onSuccess` — it now fires earlier in the pipeline.

**Step 6: Commit**

```bash
git add src/custom.ts
git commit -m "fix: move onSuccess before Zod encode in customFnBuilder pipeline"
```

---

### Task 3: Write the SensitiveWrapper de-risking test

This proves that `onSuccess` sees `SensitiveWrapper` instances (the hotpot use case for audit logging).

**Files:**
- Modify: `__tests__/pipeline-ordering.test.ts`

**Step 1: Add the SensitiveWrapper test**

Append to `__tests__/pipeline-ordering.test.ts`, inside the existing describe block:

```typescript
  it('onSuccess receives SensitiveWrapper instances for audit logging', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

    // Simulate hotpot's SensitiveField codec
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
        decode: (wire: any) => wire.status === 'hidden'
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
        hooks: {
          onSuccess: ({ result }: any) => {
            onSuccessResult = result
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

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
    expect(onSuccessResult.email.status).toBe('full')
    expect(onSuccessResult.email.expose()).toBe('user@example.com')

    // Wire result is plain object (encoded)
    expect(wireResult.email).toEqual({ value: 'user@example.com', status: 'full' })
    expect(wireResult.email).not.toBeInstanceOf(SensitiveWrapper)
  })
```

**Step 2: Run the test**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add __tests__/pipeline-ordering.test.ts
git commit -m "test: prove onSuccess sees SensitiveWrapper instances (audit logging use case)"
```

---

### Task 4: Write the `onSuccess` closure access test

This proves that resources created in `input()` are accessible in the `onSuccess` callback via closure — the pattern hotpot uses for audit logging.

**Files:**
- Modify: `__tests__/pipeline-ordering.test.ts`

**Step 1: Add the closure access test**

```typescript
  it('onSuccess has closure access to resources created in input()', async () => {
    const builder = makeBuilder()
    let auditLogEntry: any = null

    const customization = {
      args: {},
      input: async (ctx: any) => {
        // Simulate resource created during input — e.g., user, security context
        const user = { id: 'user-1', name: 'Admin' }

        return {
          ctx: { user },
          args: {},
          hooks: {
            onSuccess: ({ result }: any) => {
              // Closure captures 'user' from input()
              auditLogEntry = { userId: user.id, result }
            }
          }
        }
      }
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { id: z.string() },
      returns: z.object({ name: z.string() }),
      handler: async (ctx: any, { id }: any) => {
        return { name: `Patient ${id}` }
      }
    }) as any

    await fn({}, { id: 'p-1' })

    expect(auditLogEntry).not.toBeNull()
    expect(auditLogEntry.userId).toBe('user-1')
    expect(auditLogEntry.result.name).toBe('Patient p-1')
  })
```

**Step 2: Run the test**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add __tests__/pipeline-ordering.test.ts
git commit -m "test: prove onSuccess closure captures resources from input()"
```

---

### Task 5: Write the `onSuccess` with no returns schema test

Edge case: `onSuccess` should still fire (with the raw handler result) when no `returns` schema is specified.

**Files:**
- Modify: `__tests__/pipeline-ordering.test.ts`

**Step 1: Add the test**

```typescript
  it('onSuccess fires with handler result when no returns schema', async () => {
    const builder = makeBuilder()
    let onSuccessResult: any = null

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

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: { id: z.string() },
      // No returns schema
      handler: async (_ctx: any, { id }: any) => {
        return { found: true, id }
      }
    }) as any

    await fn({}, { id: 'test-1' })

    expect(onSuccessResult).not.toBeNull()
    expect(onSuccessResult.found).toBe(true)
    expect(onSuccessResult.id).toBe('test-1')
  })
```

**Step 2: Run the test**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS

**Step 3: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add __tests__/pipeline-ordering.test.ts
git commit -m "test: prove onSuccess fires without returns schema"
```

---

### Task 6: Write the `onSuccess` receives augmented ctx test

The `onSuccess` callback should receive the augmented context (with custom additions), not just the base Convex ctx.

**Files:**
- Modify: `__tests__/pipeline-ordering.test.ts`

**Step 1: Add the test**

```typescript
  it('onSuccess receives augmented ctx (not base ctx)', async () => {
    const builder = makeBuilder()
    let onSuccessCtx: any = null

    const customization = {
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: { id: 'user-1' }, permissions: ['read', 'write'] },
        args: {},
        hooks: {
          onSuccess: ({ ctx: successCtx }: any) => {
            onSuccessCtx = successCtx
          }
        }
      })
    }

    const myBuilder = customFnBuilder(builder as any, customization)

    const fn = myBuilder({
      args: {},
      handler: async (ctx: any) => {
        // Handler sees augmented ctx
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
```

**Step 2: Run the test**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS — the fix from Task 2 passes `finalCtx` (augmented) to `onSuccess`, not `ctx` (base).

**Step 3: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add __tests__/pipeline-ordering.test.ts
git commit -m "test: prove onSuccess receives augmented context"
```

---

## Summary

After completing this plan:
- The pipeline ordering bug is fixed in `customFnBuilder`
- 5 de-risking tests prove the foundation holds:
  1. `onSuccess` sees Date instances (not timestamps)
  2. `onSuccess` sees SensitiveWrapper instances (audit logging)
  3. `onSuccess` has closure access to resources from `input()`
  4. `onSuccess` fires correctly without returns schema
  5. `onSuccess` receives augmented context
- Wire result to client is still correctly encoded
- Full test suite passes (no regressions)

**Next plan:** Plan 2 redesigns `initZodvex` to delegate to `customFnBuilder`.
