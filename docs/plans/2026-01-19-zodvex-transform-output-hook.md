# zodvex: transformOutput Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `transformOutput` hook to zodvex's custom function builders, enabling context-aware output transforms at the wire boundary.

**Target Branch:** `feat/transform`

**Architecture:** Extend the `CustomizationResult` type to include an optional `transformOutput` callback that runs after validation but before `toConvexJS` encoding.

**Tech Stack:** TypeScript, Zod v4, Convex

---

## Background

### The Problem

zodvex's `customFnBuilder` currently supports:
- `ctx` - Custom context merged with base context
- `args` - Custom args merged with parsed args
- `onSuccess` - Callback after successful execution

However, there's no hook for transforming the output **after validation but before wire encoding**. This is needed for:
- Field-level security (FLS) transforms (SensitiveField → SensitiveWire)
- Context-aware serialization where the transform needs access to security context
- Any use case where the output transform depends on per-request state

### The Solution

Add `transformOutput` to the customization result:

```typescript
interface CustomizationResult<Ctx, Args> {
  ctx?: Ctx
  args?: Args
  onSuccess?: (...) => void
  // NEW
  transformOutput?: (result: unknown, schema: z.ZodTypeAny) => unknown | Promise<unknown>
}
```

The hook:
1. Runs after Zod validation succeeds
2. Receives the validated result and the returns schema
3. Returns the transformed result (which then goes to `toConvexJS`)
4. Has access to security context via closure capture

### Spike Validation

This pattern has been validated in hotpot with 17 passing tests:
- `hotpot/lib/security/spike-transform-output.ts` - Implementation
- `hotpot/lib/security/__tests__/spike-transform-output.test.ts` - Tests

---

## Implementation Tasks

### Task 1: Update CustomizationResult Type

**Files:**
- Modify: `src/custom.ts`

**Step 1: Add transformOutput to the type**

Find the area where customization results are typed (around the `customFnBuilder` function). Add the `transformOutput` property to the customization result type.

The type should be:

```typescript
transformOutput?: (
  result: unknown,
  schema: z.ZodTypeAny
) => unknown | Promise<unknown>
```

**Step 2: Verify type exports**

Ensure the updated type is exported if needed by consumers.

---

### Task 2: Implement transformOutput in customFnBuilder

**Files:**
- Modify: `src/custom.ts`

**Step 1: Extract transformOutput from customization result**

In `customFnBuilder`, after calling `customInput`, extract `transformOutput`:

```typescript
const added: any = await customInput(ctx, pick(allArgs, Object.keys(inputArgs)) as any, extra)
// Add this line to extract transformOutput
const { transformOutput } = added ?? {}
```

**Step 2: Apply transformOutput after validation, before toConvexJS**

Find the section that handles returns validation (around lines 236-251). Modify to apply `transformOutput`:

**Before:**
```typescript
if (returns) {
  let validated: any
  try {
    validated = (returns as z.ZodTypeAny).parse(ret)
  } catch (e) {
    handleZodValidationError(e, 'returns')
  }
  if (added?.onSuccess) {
    await added.onSuccess({ ctx, args: parsed.data, result: validated })
  }
  return toConvexJS(returns as z.ZodTypeAny, validated)
}
```

**After:**
```typescript
if (returns) {
  let validated: any
  try {
    validated = (returns as z.ZodTypeAny).parse(ret)
  } catch (e) {
    handleZodValidationError(e, 'returns')
  }
  if (added?.onSuccess) {
    await added.onSuccess({ ctx, args: parsed.data, result: validated })
  }
  // NEW: Apply transformOutput if provided
  const transformed = added?.transformOutput
    ? await added.transformOutput(validated, returns as z.ZodTypeAny)
    : validated
  return toConvexJS(returns as z.ZodTypeAny, transformed)
}
```

**Step 3: Handle the no-args path**

There's a second code path for functions without args validation (around lines 260-292). Apply the same pattern there:

```typescript
if (returns) {
  let validated: any
  try {
    validated = (returns as z.ZodTypeAny).parse(ret)
  } catch (e) {
    handleZodValidationError(e, 'returns')
  }
  if (added?.onSuccess) {
    await added.onSuccess({ ctx, args: allArgs, result: validated })
  }
  // NEW: Apply transformOutput if provided
  const transformed = added?.transformOutput
    ? await added.transformOutput(validated, returns as z.ZodTypeAny)
    : validated
  return toConvexJS(returns as z.ZodTypeAny, transformed)
}
```

---

### Task 3: Add Tests for transformOutput

**Files:**
- Create: `__tests__/transform-output.test.ts`

**Step 1: Create test file with these test cases**

```typescript
/// <reference types="bun-types" />
import { describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { customCtx, zCustomQueryBuilder } from '../src'

// Mock Convex query builder
const mockQueryBuilder = (fn: any) => fn

describe('transformOutput hook', () => {
  it('calls transformOutput after validation', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        transformOutput: (result) => {
          callOrder.push('transformOutput')
          return result
        },
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => {
        callOrder.push('handler')
        return 'result'
      },
    })

    await fn.handler({}, {})

    expect(callOrder).toEqual(['handler', 'transformOutput'])
  })

  it('transformOutput receives validated result and schema', async () => {
    let receivedResult: unknown
    let receivedSchema: z.ZodTypeAny | null = null

    const returnsSchema = z.object({ value: z.number() })

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        transformOutput: (result, schema) => {
          receivedResult = result
          receivedSchema = schema
          return result
        },
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: returnsSchema,
      handler: async () => ({ value: 123 }),
    })

    await fn.handler({}, {})

    expect(receivedResult).toEqual({ value: 123 })
    expect(receivedSchema).toBe(returnsSchema)
  })

  it('transformOutput can modify the result', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        transformOutput: (result) => ({
          ...(result as object),
          transformed: true,
        }),
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.object({ value: z.number() }),
      handler: async () => ({ value: 42 }),
    })

    const result = await fn.handler({}, {})

    expect(result).toMatchObject({ value: 42, transformed: true })
  })

  it('transformOutput has access to context via closure', async () => {
    let capturedValue = ''

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => {
        const secretValue = 'captured-in-closure'
        return {
          transformOutput: (result) => {
            capturedValue = secretValue
            return result
          },
        }
      })
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => 'test',
    })

    await fn.handler({}, {})

    expect(capturedValue).toBe('captured-in-closure')
  })

  it('transformOutput is called after onSuccess', async () => {
    const callOrder: string[] = []

    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        onSuccess: async () => {
          callOrder.push('onSuccess')
        },
        transformOutput: (result) => {
          callOrder.push('transformOutput')
          return result
        },
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.string(),
      handler: async () => {
        callOrder.push('handler')
        return 'result'
      },
    })

    await fn.handler({}, {})

    expect(callOrder).toEqual(['handler', 'onSuccess', 'transformOutput'])
  })

  it('works without transformOutput (backward compatible)', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        ctx: { extra: 'value' },
      }))
    )

    const fn = builder({
      args: z.object({ input: z.string() }),
      returns: z.string(),
      handler: async (ctx, args) => `Hello, ${args.input}!`,
    })

    const result = await fn.handler({}, { input: 'World' })

    expect(result).toBe('Hello, World!')
  })

  it('transformOutput can be async', async () => {
    const builder = zCustomQueryBuilder(
      mockQueryBuilder,
      customCtx(async () => ({
        transformOutput: async (result) => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return { ...(result as object), async: true }
        },
      }))
    )

    const fn = builder({
      args: z.object({}),
      returns: z.object({ value: z.number() }),
      handler: async () => ({ value: 1 }),
    })

    const result = await fn.handler({}, {})

    expect(result).toMatchObject({ value: 1, async: true })
  })
})
```

**Step 2: Run tests**

```bash
bun test __tests__/transform-output.test.ts
```

Expected: All tests pass.

---

### Task 4: Update Documentation

**Files:**
- Modify: `README.md` (if exists)

**Step 1: Add transformOutput to customCtx documentation**

Add a section explaining the new hook:

```markdown
### transformOutput Hook

The `transformOutput` hook allows you to transform the validated result before it's encoded for wire transport. This is useful for context-aware serialization.

```typescript
const secureQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx) => {
    const securityCtx = await getSecurityContext(ctx)
    return {
      ctx: { securityCtx },
      // Transform output with access to security context
      transformOutput: (result, schema) => {
        return transformSensitiveFields(result, securityCtx)
      },
    }
  })
)
```

The hook:
- Runs after Zod validation succeeds
- Receives the validated result and returns schema
- Can be sync or async
- Has access to values from customCtx via closure
```

---

### Task 5: Commit and Push

**Step 1: Stage changes**

```bash
git add src/custom.ts __tests__/transform-output.test.ts
```

**Step 2: Commit**

```bash
git commit -m "feat: add transformOutput hook to custom function builders

Adds a new transformOutput callback to customCtx that runs after
validation but before toConvexJS encoding. This enables context-aware
output transforms for use cases like field-level security.

The hook:
- Receives validated result and returns schema
- Can be sync or async
- Has access to context via closure capture
- Is fully backward compatible (optional)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

**Step 3: Push to feat/transform**

```bash
git push origin feat/transform
```

---

## Verification

After implementation, verify with:

1. **Unit tests pass**: `bun test`
2. **Type check passes**: `bun run type-check`
3. **Lint passes**: `bun run lint`

---

## Integration with Hotpot

Once this is merged and published, update hotpot's `convex/hotpot/secure.ts`:

```typescript
// Before (with any cast workaround):
export const hotpotQuery: typeof baseQueryBuilder = ((config: HotpotQueryConfig) => {
  // ... wrapper with any casts
}) as any

// After (clean implementation):
export const hotpotQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx: QueryCtx): Promise<HotpotQueryCtx> => {
    const securityCtx = await resolveContext(ctx)
    const db = createSecureReader(ctx.db, securityCtx, securityConfig)
    return {
      ctx: { db, securityCtx },
      transformOutput: (result, schema) => toWireFormat(result, schema),
    }
  }),
)
```

This eliminates all `any` casts and properly integrates the wire boundary transform. 
