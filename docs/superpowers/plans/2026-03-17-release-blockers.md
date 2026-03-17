# Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three release blockers for the `feat/codec-end-to-end` branch so it can merge to main.

**Architecture:** Three independent fixes: (1) decouple transform inference in `zx.codec()`/`zodvexCodec()`, (2) add type-level regression tests for `za.withContext()` action context, (3) extend `encodeIndexValue()` to handle union schemas. A prerequisite task wires up the `typechecks/` directory so type tests actually run.

**Tech Stack:** TypeScript 5.x, Zod v4, Bun test runner, Biome linter

**Spec:** `docs/superpowers/specs/2026-03-17-release-blockers-design.md`

---

## Task 0: Wire up typechecks in tsconfig

**Files:**
- Create: `packages/zodvex/tsconfig.typecheck.json`
- Modify: `packages/zodvex/package.json:68`

This is a prerequisite for Tasks 1 and 2 — without it, `.test-d.ts` type assertions are inert.

- [ ] **Step 1: Create `tsconfig.typecheck.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*.ts", "typechecks/**/*.test-d.ts"]
}
```

Note: `rootDir` is set to `"."` (package root) instead of `"src"` so TypeScript accepts files from both `src/` and `typechecks/` directories.

- [ ] **Step 2: Update `type-check` script in `package.json`**

In `packages/zodvex/package.json`, change line 68 from:
```json
"type-check": "bun run tsc --noEmit",
```
to:
```json
"type-check": "bun run tsc -p tsconfig.typecheck.json",
```

- [ ] **Step 3: Verify existing type tests are now checked**

Run: `cd packages/zodvex && bun run type-check`

Expected: passes (the existing `.test-d.ts` files in `typechecks/` should type-check cleanly).

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/tsconfig.typecheck.json packages/zodvex/package.json
git commit -m "chore: wire typechecks/ into type-check script via tsconfig.typecheck.json"
```

---

## Task 1: Decouple transform inference in `zx.codec()` and `zodvexCodec()`

**Files:**
- Modify: `packages/zodvex/src/codec.ts:99-106`
- Modify: `packages/zodvex/src/zx.ts:131-140`
- Create: `packages/zodvex/typechecks/codec-inference.test-d.ts`

### Step group A: Write the type tests first

- [ ] **Step 1: Write failing type test file**

Create `packages/zodvex/typechecks/codec-inference.test-d.ts`:

```typescript
import { z } from 'zod'
import { zodvexCodec } from '../src/codec'
import type { ZodvexCodec } from '../src/types'
import { zx } from '../src/zx'
import type { Equal, Expect } from './test-helpers'

// --- Test 1: Standard codec (zx.date pattern) infers correctly ---
const dateCodec = zx.codec(
  z.number(),
  z.custom<Date>((val) => val instanceof Date),
  {
    decode: (wire) => new Date(wire),
    encode: (date) => date.getTime(),
  }
)
type _DateCodec = Expect<Equal<typeof dateCodec, ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>>>

// --- Test 2: zodvexCodec() also infers correctly ---
const innerCodec = zodvexCodec(
  z.number(),
  z.custom<Date>((val) => val instanceof Date),
  {
    decode: (wire) => new Date(wire),
    encode: (date) => date.getTime(),
  }
)
type _InnerCodec = Expect<Equal<typeof innerCodec, ZodvexCodec<z.ZodNumber, z.ZodCustom<Date, Date>>>>

// --- Test 3: Generic factory with unresolved T ---
// When T is unresolved, z.output<W> can't be computed.
// The caller annotates transform params and WO/RI are inferred from those.
function genericCodecFactory<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({ value: inner, tag: z.literal('wrapped') })

  return zx.codec(wireSchema, z.custom<{ unwrapped: z.output<T> }>(() => true), {
    decode: (wire: { value: z.output<T>; tag: 'wrapped' }) => ({
      unwrapped: wire.value,
    }),
    encode: (runtime: { unwrapped: z.output<T> }) => ({
      value: runtime.unwrapped,
      tag: 'wrapped' as const,
    }),
  })
}

// The factory should return ZodvexCodec with the schema types preserved
const stringWrapped = genericCodecFactory(z.string())
type _FactoryReturn = Expect<
  Equal<
    typeof stringWrapped,
    ZodvexCodec<
      z.ZodObject<{ value: z.ZodString; tag: z.ZodLiteral<'wrapped'> }>,
      z.ZodCustom<{ unwrapped: string }, { unwrapped: string }>
    >
  >
>
```

- [ ] **Step 2: Run type-check to verify it fails**

Run: `cd packages/zodvex && bun run type-check`

Expected: Test 3 (generic factory) should fail because `z.output<W>` can't resolve through the generic `T`, causing the callback parameter types to not match the constrained `z.output<W>` / `z.input<R>` in the current signature.

### Step group B: Update the signatures

- [ ] **Step 3: Update `zodvexCodec()` in `codec.ts`**

In `packages/zodvex/src/codec.ts`, replace lines 99-106:

```typescript
export function zodvexCodec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R> {
```

with:

```typescript
export function zodvexCodec<
  W extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
  WO = z.output<W>,
  RI = z.output<R>
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): ZodvexCodec<W, R> {
```

- [ ] **Step 4: Update `codec()` in `zx.ts`**

In `packages/zodvex/src/zx.ts`, replace lines 131-140:

```typescript
function codec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R> {
```

with:

```typescript
function codec<
  W extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
  WO = z.output<W>,
  RI = z.output<R>
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): ZodvexCodec<W, R> {
```

- [ ] **Step 5: Run type-check to verify all tests pass**

Run: `cd packages/zodvex && bun run type-check`

Expected: PASS — all three type test scenarios pass, including the generic factory.

- [ ] **Step 6: Run runtime tests to verify no regressions**

Run: `bun test packages/zodvex/__tests__/codec.test.ts`

Expected: PASS — existing codec runtime behavior unchanged.

- [ ] **Step 7: Run full test suite**

Run: `bun test`

Expected: same 906 pass / 3 fail (the 3 existing failures are unrelated).

- [ ] **Step 8: Commit**

```bash
git add packages/zodvex/src/codec.ts packages/zodvex/src/zx.ts packages/zodvex/typechecks/codec-inference.test-d.ts
git commit -m "feat: decouple transform inference in zx.codec() and zodvexCodec()

Add WO/RI type params with defaults to z.output<W>/z.output<R>.
When TS can't resolve the defaults (generic wire schemas), caller
annotations on transform params drive inference instead.

No runtime changes — purely type-level improvement."
```

---

## Task 2: Type-level regression tests for `za.withContext()` action context

**Files:**
- Create: `packages/zodvex/typechecks/action-context.test-d.ts`
- Create: `examples/task-manager/convex/actions.ts`

### Step group A: Type test

- [ ] **Step 1: Write type test file**

Create `packages/zodvex/typechecks/action-context.test-d.ts`:

```typescript
import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import type { Overwrite } from '../src/types'
import type { Equal, Expect } from './test-helpers'

// --- Test 1: Overwrite<T, {}> preserves T ---
type ActionCtx = GenericActionCtx<GenericDataModel>
type WithEmpty = Overwrite<ActionCtx, {}>
// auth should still be accessible — not collapsed to never
type _AuthPreserved = Expect<Equal<WithEmpty['auth'], ActionCtx['auth']>>

// --- Test 2: Overwrite<T, Record<string, never>> guard clause ---
// This is the bug case — Record<string, never> has keyof = string,
// which would collapse T via Omit<T, string> without the guard clause.
type WithRecordNever = Overwrite<ActionCtx, Record<string, never>>
// Guard clause: keyof Record<string, never> is string, NOT never.
// But our Overwrite has: keyof U extends never ? T : Omit<T, keyof U> & U
// keyof Record<string, never> = string, string extends never = false,
// so this hits the Omit branch. The guard only helps for {}.
// This documents the current behavior — {} is the correct fix, not Record<string, never>.
type _RecordNeverCollapses = Expect<Equal<keyof WithRecordNever, string>>

// --- Test 3: NoCodecCtx ({}) flows through ZodvexBuilder.withContext correctly ---
// Simulate what za.withContext() does: the input customization sees
// Overwrite<InputCtx, CodecCtx> where CodecCtx = {} for actions.
type SimulatedInput = Overwrite<ActionCtx, {}>
// The input should be the full ActionCtx
type _InputIsActionCtx = Expect<Equal<SimulatedInput, ActionCtx>>

// --- Test 4: After .withContext(), custom ctx merges cleanly ---
type CustomCtx = { securityCtx: string }
type MergedCodecAndCustom = Overwrite<{}, CustomCtx>
type _MergedIsCustom = Expect<Equal<MergedCodecAndCustom, CustomCtx>>
type FinalHandlerCtx = Overwrite<ActionCtx, MergedCodecAndCustom>
// Handler should see ActionCtx & { securityCtx: string }
type _HasAuth = Expect<Equal<FinalHandlerCtx['auth'], ActionCtx['auth']>>
type _HasSecurityCtx = Expect<Equal<FinalHandlerCtx['securityCtx'], string>>
```

- [ ] **Step 2: Run type-check to verify it passes**

Run: `cd packages/zodvex && bun run type-check`

Expected: PASS — confirms the `NoCodecCtx = {}` fix is working. If any assertion fails, we have a live bug to investigate.

### Step group B: Example app action

- [ ] **Step 3: Add action with `.withContext()` to example app**

Create `examples/task-manager/convex/actions.ts`:

```typescript
import { v } from 'convex/values'
import { z } from 'zod'
import { za } from './functions'

// Simple action with .withContext() to verify action context types work.
// If za.withContext() collapsed ctx to { [k: string]: never }, this would
// fail type-checking because ctx.auth would not be accessible.
const authedAction = za.withContext({
  args: {},
  input: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return {
      ctx: { userId: identity?.subject ?? 'anonymous' },
      args: {},
    }
  },
})

export const ping = authedAction({
  args: { message: z.string() },
  handler: async (ctx, { message }) => {
    // ctx.userId comes from .withContext() customization
    return `${ctx.userId}: ${message}`
  },
  returns: z.string(),
})

// Base za (no withContext) should also type-check — ctx.auth must be accessible
export const health = za({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return identity ? 'authenticated' : 'anonymous'
  },
  returns: z.string(),
})
```

- [ ] **Step 4: Type-check the example app**

Run: `cd examples/task-manager && npx tsc --noEmit`

Expected: PASS — both the `.withContext()` action and the bare `za` action type-check.

- [ ] **Step 5: Commit**

```bash
git add packages/zodvex/typechecks/action-context.test-d.ts examples/task-manager/convex/actions.ts
git commit -m "test: add type-level regression tests for za.withContext() context types

Verifies NoCodecCtx = {} fix prevents action context collapse.
Adds example app action exercising .withContext() in consumer context."
```

---

## Task 3: Union index encoding in `encodeIndexValue()`

**Files:**
- Modify: `packages/zodvex/src/db.ts:124-133`
- Modify: `packages/zodvex/__tests__/db.test.ts` (add tests after line 674)

### Step group A: Write the failing tests

- [ ] **Step 1: Write union index encoding tests**

Add the following tests to `packages/zodvex/__tests__/db.test.ts`, after the existing `withIndex encoding` describe block (after line 674):

```typescript
describe('withIndex encoding — union schemas', () => {
  // Discriminated union doc schema matching the notification model pattern
  const unionDocSchema = z.discriminatedUnion('kind', [
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('email'),
      recipientId: z.string(),
      createdAt: zx.date(),
    }),
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('push'),
      recipientId: z.string(),
      createdAt: zx.date(),
    }),
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('in_app'),
      recipientId: z.string(),
      createdAt: zx.date(),
    }),
  ])

  it('encodes a codec field (zx.date) through a union schema via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_created' as any, (q: any) =>
        q.eq('createdAt', new Date(1700000000000))
      )
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('createdAt')
    expect(captured[0].value).toBe(1700000000000)
  })

  it('encodes discriminator literals through a per-field union via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_kind' as any, (q: any) => q.eq('kind', 'push'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('kind')
    expect(captured[0].value).toBe('push')
  })

  it('encodes compound index fields on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_recipient_and_kind' as any, (q: any) =>
        q.eq('recipientId', 'user123').eq('kind', 'email')
      )
      .first()

    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual({ method: 'eq', field: 'recipientId', value: 'user123' })
    expect(captured[1]).toEqual({ method: 'eq', field: 'kind', value: 'email' })
  })

  it('encodes codec field through .gte() on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_created' as any, (q: any) =>
        q.gte('createdAt', new Date(1700000000000))
      )
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('gte')
    expect(captured[0].value).toBe(1700000000000)
  })

  it('passes through non-codec fields unchanged on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_recipient' as any, (q: any) =>
        q.eq('recipientId', 'user123')
      )
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('user123')
  })

  it('handles plain z.union (non-discriminated) the same way', async () => {
    const plainUnionSchema = z.union([
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        type: z.literal('a'),
        timestamp: zx.date(),
      }),
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        type: z.literal('b'),
        timestamp: zx.date(),
      }),
    ])

    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, plainUnionSchema)

    await chain
      .withIndex('by_timestamp' as any, (q: any) =>
        q.eq('timestamp', new Date(1700000000000))
      )
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe(1700000000000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: The new union tests FAIL — codec fields return `Date` objects instead of encoded `number` values, because `encodeIndexValue` falls through to `return value` for union schemas.

### Step group B: Implement the fix

- [ ] **Step 3: Update `encodeIndexValue` in `db.ts`**

In `packages/zodvex/src/db.ts`, replace lines 124-133:

```typescript
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value
  // Top-level: encode through the field's schema
  if (schema instanceof z.ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }
  return value
}
```

with:

```typescript
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value

  // Object schemas: encode through the field's schema directly
  if (schema instanceof z.ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }

  // Union schemas (ZodDiscriminatedUnion extends ZodUnion): build a per-field
  // union from all variants, then encode through that. Handles discriminator
  // literals and codec fields (e.g., zx.date()) correctly.
  // Non-object variants are skipped — union tables require object variants.
  if (schema instanceof z.ZodUnion) {
    const fieldSchemas = (schema as z.ZodUnion).options
      .filter((v: z.ZodTypeAny): v is z.ZodObject<any> => v instanceof z.ZodObject)
      .map((v: z.ZodObject<any>) => v.shape[fieldPath])
      .filter(Boolean)
    if (fieldSchemas.length === 1) return z.encode(fieldSchemas[0], value)
    if (fieldSchemas.length > 1)
      return z.encode(
        z.union(fieldSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        value
      )
  }

  return value
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/db.test.ts`

Expected: PASS — all union index encoding tests pass, existing tests still pass.

- [ ] **Step 5: Run full test suite**

Run: `bun test`

Expected: same 906+6 pass / 3 fail (same 3 pre-existing failures).

- [ ] **Step 6: Lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/zodvex/src/db.ts packages/zodvex/__tests__/db.test.ts
git commit -m "fix: encode index values through union schemas in withIndex

encodeIndexValue now handles ZodUnion/ZodDiscriminatedUnion by building
a per-field union from all variant schemas. Uses only public Zod v4 API
(instanceof, .options, .shape). Fixes silent encoding skip for codec
fields like zx.date() on union tables."
```

---

## Task 4: Final verification

- [ ] **Step 1: Run full type-check**

Run: `cd packages/zodvex && bun run type-check`

Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun test`

Expected: 912+ pass / 3 fail (same pre-existing failures only)

- [ ] **Step 3: Run lint**

Run: `bun run lint`

Expected: PASS

- [ ] **Step 4: Build**

Run: `bun run build`

Expected: PASS
