# Hooks & Transforms Removal Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove zodvex's custom hooks/transforms system from `customFnBuilder`. Align with convex-helpers' `onSuccess` convention (top-level on `input` return). Simplify the function builder pipeline.

**Rationale:**
- `hooks.onSuccess` is redundant with convex-helpers' top-level `onSuccess`
- `transforms.input` (post-validation arg transform) has no use case that can't be done in the handler's first line
- `transforms.output` (pre-validation return transform) is replaced by `onSuccess` now that hotpot's audit logger supports both SensitiveField and SensitiveWire formats
- DB-level codec wrapping (via `initZodvex` / `createCodecCustomization`) handles wire↔runtime conversion; function-level transforms are a redundant layer

**Prerequisite:** Hotpot must migrate from `transforms.output` to `onSuccess` first. See `docs/plans/2026-02-18-hotpot-hooks-migration.md`.

**Tech Stack:** TypeScript, Zod v4, Convex, convex-helpers, Bun test runner

---

### What's being removed

| Item | Location | Lines |
|------|----------|-------|
| `CustomizationHooks` type | `src/custom.ts:29-36` | 8 |
| `CustomizationTransforms` type | `src/custom.ts:41-46` | 6 |
| `CustomizationResult` type | `src/custom.ts:52-64` | 13 |
| `CustomizationInputResult` type | `src/custom.ts:70-78` | 9 |
| `CustomizationWithHooks` type | `src/custom.ts:87-101` | 15 |
| `customCtxWithHooks` function | `src/custom.ts:129-150` | 22 |
| `transforms.input` checks (2 sites) | `src/custom.ts:384-389, 445-450` | 12 |
| `transforms.output` checks (2 sites) | `src/custom.ts:397-399, 458-460` | 6 |
| `hooks.onSuccess` nesting (4 sites) | `src/custom.ts:406,418,467,475` | simplify |
| Transform input tests | `__tests__/transform-input.test.ts` | 301 (delete file) |
| Transform output tests | `__tests__/transform-output.test.ts` | 334 (delete file) |
| Export test reference | `__tests__/exports.test.ts:89,92` | 2 |
| README hooks section | `README.md:533-597` | ~65 |
| CONTRIBUTING reference | `CONTRIBUTING.md:90` | 1 |
| CLAUDE.md reference | `CLAUDE.md:45` | 1 |

### What's staying

- **`onSuccess` (top-level)** — convex-helpers convention, already supported via dual-check `added?.hooks?.onSuccess ?? added?.onSuccess`. After removal, simplify to just `added?.onSuccess`.
- **`extra` args pattern** — hotpot's `required` entitlement checking flows through `extra` parameter. Unchanged.
- **`zCustomQuery`/`zCustomMutation`/`zCustomAction`** — unchanged API, just simpler internals.

---

### Task 1: Remove types and `customCtxWithHooks` function

**Files:**
- Modify: `src/custom.ts`

**Step 1: Write failing test**

Add to `__tests__/custom.test.ts` (or create if needed):

```typescript
it('customCtxWithHooks is no longer exported', async () => {
  const mod = await import('../src/custom')
  expect((mod as any).customCtxWithHooks).toBeUndefined()
})
```

**Step 2: Remove from `src/custom.ts`**

Delete these blocks:
1. `CustomizationHooks` type (lines 26-36)
2. `CustomizationTransforms` type (lines 38-46)
3. `CustomizationResult` type (lines 48-64)
4. `CustomizationInputResult` type (lines 66-78)
5. `CustomizationWithHooks` type (lines 80-101)
6. `customCtxWithHooks` function (lines 103-150)
7. The `CustomizationWithHooks` reference in `customFnBuilder` parameter type (line 309)

For line 309, change:
```typescript
customization:
  | Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
  | CustomizationWithHooks<Ctx, CustomCtx, CustomMadeArgs, ExtraArgs>
```
to:
```typescript
customization: Customization<Ctx, CustomArgsValidator, CustomCtx, CustomMadeArgs, ExtraArgs>
```

Also remove the comment on line 362 referencing `CustomizationWithHooks`.

**Step 3: Run tests**

Run: `bun test __tests__/custom.test.ts`
Expected: PASS (the new test passes, existing non-transform tests still pass)

**Step 4: Commit**

```bash
git add src/custom.ts __tests__/custom.test.ts
git commit -m "refactor: remove customCtxWithHooks and hooks/transforms types"
```

---

### Task 2: Simplify `customFnBuilder` — remove transforms, simplify onSuccess

**Files:**
- Modify: `src/custom.ts`

**Step 1: Remove transforms.input checks**

At lines ~384-389 (with-args path) and ~445-450 (no-args path), delete:

```typescript
// Apply input transform if provided (after validation, before handler)
if (added?.transforms?.input) {
  finalArgs = (await added.transforms.input(finalArgs, argsSchema)) as Record<
    string,
    unknown
  >
}
```

Change `let finalArgs` to `const finalArgs` at both sites (no longer mutated).

**Step 2: Remove transforms.output checks**

At lines ~397-399 (with-args path) and ~458-460 (no-args path), simplify:

```typescript
// BEFORE
const preTransformed = added?.transforms?.output
  ? await added.transforms.output(ret, returns as z.ZodTypeAny)
  : ret
const validated = validateReturns(returns as z.ZodTypeAny, preTransformed)

// AFTER
const validated = validateReturns(returns as z.ZodTypeAny, ret)
```

Remove the associated comments about transforms.

**Step 3: Simplify onSuccess to top-level only**

At all 4 sites (lines ~406, ~418, ~467, ~475), change:

```typescript
// BEFORE
const onSuccess = added?.hooks?.onSuccess ?? added?.onSuccess

// AFTER
const onSuccess = added?.onSuccess
```

Remove the comments about dual-check / zodvex convention.

**Step 4: Run existing tests**

Run: `bun test -- --exclude __tests__/transform-input.test.ts --exclude __tests__/transform-output.test.ts`
Expected: All non-transform tests PASS

**Step 5: Commit**

```bash
git add src/custom.ts
git commit -m "refactor: remove transforms pipeline and hooks.onSuccess nesting from customFnBuilder"
```

---

### Task 3: Delete transform test files

**Files:**
- Delete: `__tests__/transform-input.test.ts` (301 lines)
- Delete: `__tests__/transform-output.test.ts` (334 lines)

**Step 1: Delete files**

```bash
rm __tests__/transform-input.test.ts __tests__/transform-output.test.ts
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: PASS (all remaining tests pass)

**Step 3: Commit**

```bash
git add -u __tests__/transform-input.test.ts __tests__/transform-output.test.ts
git commit -m "test: remove transform-input and transform-output test files"
```

---

### Task 4: Add onSuccess integration test

**Files:**
- Modify: `__tests__/custom.test.ts` (or appropriate test file)

Verify that convex-helpers' `onSuccess` convention still works after the simplification:

```typescript
describe('onSuccess (convex-helpers convention)', () => {
  it('fires after handler with result', async () => {
    let captured: any
    const builder = (fn: any) => fn

    const customized = zCustomQuery(builder as any, {
      args: {},
      input: async (ctx: any) => ({
        ctx: {},
        args: {},
        onSuccess: ({ result }: any) => { captured = result }
      })
    })

    const fn = customized({
      args: { x: z.number() },
      returns: z.number(),
      handler: async (_ctx: any, { x }: any) => x * 2
    })

    await fn.handler({}, { x: 5 })
    expect(captured).toBe(10)
  })
})
```

**Step 1: Write test, run, verify PASS**

Run: `bun test __tests__/custom.test.ts`

**Step 2: Commit**

```bash
git add __tests__/custom.test.ts
git commit -m "test: verify onSuccess convention after hooks/transforms removal"
```

---

### Task 5: Update exports and docs

**Files:**
- Modify: `__tests__/exports.test.ts` — remove `customCtxWithHooks` assertion
- Modify: `README.md` — remove Hooks and Transforms section (~lines 533-597), update pipeline description
- Modify: `CONTRIBUTING.md` — remove `customCtxWithHooks` reference (line 90)
- Modify: `CLAUDE.md` — update `custom.ts` description (line 45)

**Step 1: Update export test**

In `__tests__/exports.test.ts`, remove `customCtxWithHooks` from the import (line 89) and the `expect` assertion (line 92).

**Step 2: Update docs**

README.md: Remove the "Hooks and Transforms" section (lines 533-597). Update the pipeline description to show `onSuccess` as the only hook point. Keep `zx.codec()` docs (those are a different concept — Zod codecs, not function-level transforms).

CONTRIBUTING.md line 90: Remove `customCtxWithHooks` from the list.

CLAUDE.md line 45: Change description of `custom.ts` to remove hooks/transforms mention:
```
- **custom.ts** - Custom function builders (`zCustomQuery`, `zCustomMutation`, `zCustomAction`) for more advanced use cases.
```

**Step 3: Run full verification**

```bash
bun test
bun run build
bun run lint
bun run type-check
```

**Step 4: Commit**

```bash
git add __tests__/exports.test.ts README.md CONTRIBUTING.md CLAUDE.md
git commit -m "docs: remove hooks/transforms from exports, README, and project docs"
```

---

### Summary

| Task | What | Risk |
|------|------|------|
| 1 | Remove types + `customCtxWithHooks` | Low — pure deletion |
| 2 | Simplify `customFnBuilder` | Medium — 8 code sites, verify no regressions |
| 3 | Delete transform test files | Low — mechanical |
| 4 | Add onSuccess integration test | Low — verify the kept path works |
| 5 | Update exports + docs | Low — mechanical |

**Net effect:** ~73 lines of types + ~22 lines of function + ~18 lines of pipeline code removed from `src/custom.ts`. 635 lines of tests deleted. README ~65 lines simplified. Clean alignment with convex-helpers' `onSuccess` convention.
