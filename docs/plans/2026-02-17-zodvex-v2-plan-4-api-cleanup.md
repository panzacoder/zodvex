# Plan 4: API Surface Cleanup — Deprecations, Deduplication, Exports

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up the public API: remove duplicate builder names, deprecate zodvex's custom context helpers, eliminate dead types, and update the export structure to match the v2 design.

**Architecture:** Per the v2 redesign, zodvex's API surface should be:
- **Tier 1:** `initZodvex` (recommended) -> returns `zQuery`, `zMutation`, `zAction`, `zCustomQuery`, `zCustomMutation`, `zCustomAction`
- **Tier 2:** Standalone `zCustomQuery`, `zCustomMutation`, `zCustomAction` from `zodvex/server` (for library authors)
- **Tier 3:** Raw `zQuery(builder, ...)` positional API (backward compat / escape hatch)

**Tech Stack:** TypeScript, Zod v4, Bun test runner

**Prerequisite:** Plan 3 (DB codec simplification) must be complete.

**Prerequisite reading:**
- `docs/plans/2026-02-17-zodvex-v2-redesign.md` (Sections: API Surface, Migration Strategy)
- `src/builders.ts` — duplicate builder functions
- `src/custom.ts` — types to clean up
- `src/server/index.ts` — export structure

---

### Task 1: Deprecate `zCustomQueryBuilder` / `zCustomMutationBuilder` / `zCustomActionBuilder`

These are identical to `zCustomQuery` / `zCustomMutation` / `zCustomAction` in `src/custom.ts`. The `*Builder` variants in `src/builders.ts` are the duplicates.

**Files:**
- Modify: `src/builders.ts`

**Step 1: Add deprecation notices**

Add `@deprecated` JSDoc to each function in `src/builders.ts`:

```typescript
/**
 * @deprecated Use `zCustomQuery` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomQueryBuilder<...>(...) { ... }

/**
 * @deprecated Use `zCustomMutation` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomMutationBuilder<...>(...) { ... }

/**
 * @deprecated Use `zCustomAction` from 'zodvex/server' instead. This is an identical function with a different name.
 */
export function zCustomActionBuilder<...>(...) { ... }
```

Don't remove them yet — consumers need migration time.

**Step 2: Run the full test suite**

Run: `bun test`
Expected: All pass (deprecation notices don't break anything)

**Step 3: Commit**

```bash
git add src/builders.ts
git commit -m "deprecate: zCustomQueryBuilder/MutationBuilder/ActionBuilder (use zCustomQuery etc.)"
```

---

### Task 2: Deprecate `customCtxWithHooks` and remove `CustomizationWithHooks` type

Per the v2 design, `customCtxWithHooks` is replaced by `customCtx` from convex-helpers (pipeline ordering fix means `onSuccess` works correctly without a special wrapper). `CustomizationWithHooks`, `CustomizationHooks`, `CustomizationTransforms`, and `CustomizationResult` types are no longer needed.

**Files:**
- Modify: `src/custom.ts`

**Step 1: Add deprecation to `customCtxWithHooks`**

```typescript
/**
 * @deprecated Use `customCtx` from 'convex-helpers/server/customFunctions' instead.
 * With the pipeline ordering fix, `onSuccess` in convex-helpers' `Customization` type
 * now correctly sees runtime types (Date, SensitiveWrapper) before Zod encoding.
 * `transforms.output` is replaced by `onSuccess`.
 * `transforms.input` is replaced by consumer logic in `customCtx`.
 */
export function customCtxWithHooks<...>(...) { ... }
```

**Step 2: Add deprecation to types**

```typescript
/**
 * @deprecated Use `Customization` from 'convex-helpers/server/customFunctions' instead.
 */
export type CustomizationWithHooks<...> = { ... }

/**
 * @deprecated Use `onSuccess` in convex-helpers' `Customization` type instead.
 */
export type CustomizationHooks = { ... }

/**
 * @deprecated Transforms are no longer needed. Use `onSuccess` for output observation
 * and consumer logic in `customCtx` for input transformation.
 */
export type CustomizationTransforms = { ... }
```

**Step 3: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/custom.ts
git commit -m "deprecate: customCtxWithHooks and related types (use convex-helpers customCtx)"
```

---

### Task 3: Verify and update the exports test

`__tests__/exports.test.ts` verifies the public API surface. Update it to reflect the v2 changes.

**Files:**
- Read: `__tests__/exports.test.ts` (to understand current expectations)
- Modify: `__tests__/exports.test.ts`

**Step 1: Read the exports test**

Read `__tests__/exports.test.ts` to understand what it currently checks.

**Step 2: Update the test to match the new API**

The test should verify:
- `zodvex` exports everything from `core` and `server`
- `zodvex/server` exports: `initZodvex`, `zCustomQuery`, `zCustomMutation`, `zCustomAction`, `zQueryBuilder`, `zMutationBuilder`, `zActionBuilder`, `customCtx` (re-exported from convex-helpers), `customFnBuilder`, `defineZodSchema`, `zodTable`, `createZodDbReader`, `createZodDbWriter`, `decodeDoc`, `encodeDoc`, `WireDoc`, `RuntimeDoc`
- `zodvex/core` exports: `zodvexCodec`, `zx`, `zodToConvex`, `zodToConvexFields`, and other client-safe utilities
- Deprecated exports still exist (for backward compat): `zCustomQueryBuilder`, `zCustomMutationBuilder`, `zCustomActionBuilder`, `customCtxWithHooks`
- Removed from exports: `DatabaseHooks`, `createDatabaseHooks`, `composeHooks`, `zCustomCtx`, `zCustomCtxWithArgs`

**Step 3: Run the test**

Run: `bun test __tests__/exports.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add __tests__/exports.test.ts
git commit -m "test: update exports test for v2 API surface"
```

---

### Task 4: Update `src/server/index.ts` exports

Ensure the server module cleanly exports the v2 API.

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Review and update exports**

The current file re-exports from `../builders`, `../custom`, `../db`, `../init`, `../schema`, `../tables`. This is mostly correct but verify:

1. `customCtx` re-export from convex-helpers — keep this, it's a convenience
2. `../builders` — still exports `zQueryBuilder`, `zMutationBuilder`, `zActionBuilder` (non-deprecated) and deprecated `zCustom*Builder` variants
3. `../custom` — exports `customFnBuilder`, `zCustomQuery`, `zCustomMutation`, `zCustomAction`, and deprecated types
4. `../db` — now exports only `decodeDoc`, `encodeDoc`, `createZodDbReader`, `createZodDbWriter`, `WireDoc`, `RuntimeDoc`
5. `../init` — exports `initZodvex`
6. `../schema` — exports `defineZodSchema`
7. `../tables` — exports `zodTable`

No changes needed if the file is already `export * from ...` for each module.

**Step 2: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 3: Run type checking**

Run: `bun run type-check`
Expected: No errors

**Step 4: Commit (if changes were needed)**

```bash
git add src/server/index.ts
git commit -m "chore: verify server exports match v2 API surface"
```

---

### Task 5: Remove `transforms.output` support from `customFnBuilder`

Now that `onSuccess` runs before Zod encode (Plan 1), `transforms.output` is redundant. Hotpot's audit logging should use `onSuccess` instead.

**Files:**
- Modify: `src/custom.ts`

**Step 1: Deprecate `transforms.output` (don't remove yet)**

In `customFnBuilder`, add a console.warn when `transforms.output` is used:

```typescript
// In the handler, before the transforms.output usage:
if (added?.transforms?.output) {
  console.warn(
    '[zodvex] transforms.output is deprecated. Use onSuccess in your Customization instead. ' +
    'onSuccess now correctly sees runtime types (Date, SensitiveWrapper) before Zod encoding.'
  )
}
```

**Step 2: Write a test verifying the deprecation warning**

In `__tests__/pipeline-ordering.test.ts`, add:

```typescript
describe('transforms.output deprecation', () => {
  it('logs deprecation warning when transforms.output is used', async () => {
    const builder = makeBuilder()
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: any[]) => warnings.push(args.join(' '))

    try {
      const customization = {
        args: {},
        input: async () => ({
          ctx: {},
          args: {},
          transforms: {
            output: (result: any) => result
          }
        })
      }

      const myBuilder = customFnBuilder(builder as any, customization)
      const fn = myBuilder({
        args: {},
        returns: z.object({ name: z.string() }),
        handler: async () => ({ name: 'test' })
      }) as any

      await fn({}, {})

      expect(warnings.some(w => w.includes('transforms.output is deprecated'))).toBe(true)
    } finally {
      console.warn = originalWarn
    }
  })
})
```

**Step 3: Run the tests**

Run: `bun test __tests__/pipeline-ordering.test.ts`
Expected: PASS

**Step 4: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/custom.ts __tests__/pipeline-ordering.test.ts
git commit -m "deprecate: transforms.output with warning (use onSuccess instead)"
```

---

### Task 6: Remove `transforms.input` support from `customFnBuilder`

`transforms.input` is replaced by consumer logic in `customCtx` — the consumer transforms args in their `input()` function.

**Files:**
- Modify: `src/custom.ts`

**Step 1: Deprecate `transforms.input` (don't remove yet)**

Add a similar console.warn:

```typescript
if (added?.transforms?.input) {
  console.warn(
    '[zodvex] transforms.input is deprecated. Transform args in your customCtx input() function instead.'
  )
}
```

**Step 2: Run the full test suite**

Run: `bun test`
Expected: All pass. Check if any existing tests use `transforms.input` — update them to note the deprecation.

**Step 3: Commit**

```bash
git add src/custom.ts
git commit -m "deprecate: transforms.input with warning (transform args in customCtx instead)"
```

---

### Task 7: Run final verification

**Step 1: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 2: Run type checking**

Run: `bun run type-check`
Expected: No errors

**Step 3: Run linting**

Run: `bun run lint`
Expected: No errors (or only pre-existing ones)

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup for v2 API surface"
```

---

## Summary

After completing this plan:
- `zCustomQueryBuilder` / `zCustomMutationBuilder` / `zCustomActionBuilder` deprecated (with `@deprecated` JSDoc)
- `customCtxWithHooks` deprecated (with `@deprecated` JSDoc)
- `CustomizationWithHooks`, `CustomizationHooks`, `CustomizationTransforms` deprecated
- `transforms.output` and `transforms.input` deprecated with runtime warnings
- Exports test updated for v2 API surface
- Server exports verified clean
- All deprecated exports still work (backward compat)
- Full test suite passes, type checking passes, linting passes

**Next plan:** Plan 5 handles codegen and the validator registry.
