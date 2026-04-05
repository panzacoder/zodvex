# Full zod/mini Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a consumer imports from `zodvex/mini`, all internal schema construction uses `zod/mini` — no full `zod` in the dependency graph.

**Architecture:** A `zod-factory.ts` module replaces `import { z } from 'zod'` in all 14 internal files. The entrypoint (`zodvex/core` or `zodvex/mini`) calls `setZodFactory(z)` at module load time, before any schema construction occurs. All chained method calls (`.optional()`, `.nullable()`, `.refine()`, `.describe()`) are converted to functional forms that work in both full zod and zod/mini.

**Tech Stack:** TypeScript, Zod v4 (both `zod` and `zod/mini`), tsup, vitest

**Spec:** `docs/superpowers/specs/2026-04-02-full-mini-mode-design.md`

---

### Task 1: Create `zod-factory.ts` — the swappable z namespace

**Files:**
- Modify: `packages/zodvex/src/zod-core.ts`

The existing `zod-core.ts` already re-exports core classes and functions. We add the factory mechanism to the same file rather than creating a new module, since every consumer already imports from it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/zodvex/__tests__/zod-factory.test.ts
import { describe, test, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { z as zm } from 'zod/mini'

describe('zod-factory', () => {
  test('getZ() returns full zod by default', async () => {
    // Fresh import to avoid module cache
    const { getZ } = await import('../src/zod-core')
    const z = getZ()
    expect(typeof z.object).toBe('function')
    expect(typeof z.string).toBe('function')
  })

  test('setZodFactory switches the z namespace', async () => {
    const { getZ, setZodFactory } = await import('../src/zod-core')
    setZodFactory(zm as any)
    const z = getZ()
    // Schemas from mini should have fewer own properties
    const obj = z.object({ name: z.string() })
    expect(Object.getOwnPropertyNames(obj).length).toBeLessThan(30)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- packages/zodvex/__tests__/zod-factory.test.ts`
Expected: FAIL — `getZ` and `setZodFactory` are not exported

- [ ] **Step 3: Add factory mechanism to `zod-core.ts`**

Add these lines at the end of `packages/zodvex/src/zod-core.ts`:

```ts
// ---------------------------------------------------------------------------
// Swappable z namespace — the entrypoint (core/ or mini/) calls setZodFactory()
// at module load time, before any schema construction runs.
// ---------------------------------------------------------------------------
import type { z as ZodNamespace } from 'zod'

/**
 * The z namespace type. Compatible with both `zod` and `zod/mini` since
 * mini exports the same construction functions (object, array, string, etc.).
 */
export type ZodFactory = typeof ZodNamespace

let _z: ZodFactory | undefined

/**
 * Set the Zod namespace used for all internal schema construction.
 * Called once by the entrypoint module (zodvex/core or zodvex/mini).
 */
export function setZodFactory(z: ZodFactory): void {
  _z = z
}

/**
 * Get the current Zod namespace. Falls back to full `zod` if no
 * entrypoint has been loaded yet (backwards compatibility).
 */
export function getZ(): ZodFactory {
  if (!_z) {
    // Lazy fallback: import full zod synchronously.
    // This only runs if someone uses zodvex internals without going through
    // an entrypoint (e.g., direct import from zodvex/server). Safe because
    // 'zod' is always a peer dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _z = require('zod').z
  }
  return _z
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- packages/zodvex/__tests__/zod-factory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/zodvex/src/zod-core.ts packages/zodvex/__tests__/zod-factory.test.ts
git commit -m "feat: add zod factory to zod-core.ts for swappable z namespace"
```

---

### Task 2: Wire entrypoints to call `setZodFactory()`

**Files:**
- Modify: `packages/zodvex/src/core/index.ts`
- Modify: `packages/zodvex/src/mini/index.ts`
- Modify: `packages/zodvex/src/index.ts` (root entrypoint)

- [ ] **Step 1: Add `setZodFactory` call to `core/index.ts`**

Add at the TOP of `packages/zodvex/src/core/index.ts`, before all other exports:

```ts
// Initialize the z factory with full zod — must run before any module
// that uses getZ() is imported via the re-exports below.
import { z } from 'zod'
import { setZodFactory } from '../zod-core'
setZodFactory(z)
```

- [ ] **Step 2: Update `mini/index.ts` to set zod/mini factory**

Add at the TOP of `packages/zodvex/src/mini/index.ts`, before all other exports:

```ts
// Initialize the z factory with zod/mini — must run before any module
// that uses getZ() is imported via the re-exports below.
import { z } from 'zod/mini'
import { setZodFactory } from '../zod-core'
setZodFactory(z as any)
```

Note: `as any` is needed because `zod/mini`'s `z` type is not identical to full `zod`'s `z` type (it lacks method types on returned schemas), but the construction functions are structurally compatible at runtime.

- [ ] **Step 3: Add `setZodFactory` call to root `index.ts`**

Add at the TOP of `packages/zodvex/src/index.ts`, before the re-exports:

```ts
// Initialize the z factory with full zod for the root entrypoint.
import { z } from 'zod'
import { setZodFactory } from './zod-core'
setZodFactory(z)
```

- [ ] **Step 4: Run the full test suite**

Run: `bun run test`
Expected: All 860 tests pass (no behavior change yet — factory defaults to full zod)

- [ ] **Step 5: Commit**

```
git add packages/zodvex/src/core/index.ts packages/zodvex/src/mini/index.ts packages/zodvex/src/index.ts
git commit -m "feat: wire entrypoints to call setZodFactory at load time"
```

---

### Task 3: Migrate internal files from `import { z } from 'zod'` to `getZ()`

This is the bulk of the work — 14 files. Each file's `import { z } from 'zod'` is removed and replaced with `import { getZ } from './zod-core'`. Inside functions, `const z = getZ()` retrieves the current namespace.

**Important rules:**
1. `import type { z } from 'zod'` stays — type-only imports are erased at compile time
2. Type annotations like `z.ZodObject<any>`, `z.ZodError` that appear in runtime positions (casts, extends) need to use core types instead (e.g., `as $ZodObject`, `extends $ZodError`)
3. Chained methods must be converted to functional forms (handled in Task 4)

**Files to migrate** (14 files, in dependency order to avoid breakage):

**Batch A — leaf modules (no internal z construction deps):**
- `packages/zodvex/src/serverUtils.ts` — only type ref (`z.ZodError`), convert to `import type` + use `$ZodError`
- `packages/zodvex/src/boundaryHelpers.ts` — only `z.ZodError` class extension, already imports `$ZodError` from core

**Batch B — schema construction modules:**
- `packages/zodvex/src/ids.ts`
- `packages/zodvex/src/codec.ts`
- `packages/zodvex/src/zx.ts`
- `packages/zodvex/src/utils.ts`
- `packages/zodvex/src/results.ts`
- `packages/zodvex/src/schemaHelpers.ts`
- `packages/zodvex/src/model.ts`
- `packages/zodvex/src/tables.ts`

**Batch C — wrapper/builder modules:**
- `packages/zodvex/src/builders.ts`
- `packages/zodvex/src/wrappers.ts`
- `packages/zodvex/src/custom.ts`

**Batch D — remaining:**
- `packages/zodvex/src/rules.ts`
- `packages/zodvex/src/db.ts`
- `packages/zodvex/src/registry.ts`
- `packages/zodvex/src/form/mantine/index.ts`

For each file, the migration pattern is:

```ts
// BEFORE
import { z } from 'zod'

export function myFunction() {
  return z.object({ name: z.string() })
}

// AFTER
import { getZ } from './zod-core'

export function myFunction() {
  const z = getZ()
  return z.object({ name: z.string() })
}
```

For module-level constants (like `results.ts` which defines `zVoidMutationResult` at module scope), these must become lazy:

```ts
// BEFORE
export const zVoidMutationResult = z.discriminatedUnion('success', [...])

// AFTER — lazy getter pattern
let _zVoidMutationResult: ReturnType<typeof createZVoidMutationResult> | undefined
function createZVoidMutationResult() {
  const z = getZ()
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true) }),
    z.object({ success: z.literal(false), error: z.string() })
  ])
}
export function zVoidMutationResult() {
  if (!_zVoidMutationResult) _zVoidMutationResult = createZVoidMutationResult()
  return _zVoidMutationResult
}
```

**OR** — if no consumer uses `zVoidMutationResult` at module scope (only in `returns:` options which execute later), just move the construction inside the function:

```ts
export const zVoidMutationResult = () => {
  const z = getZ()
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true) }),
    z.object({ success: z.literal(false), error: z.string() })
  ])
}
```

Check if this is a breaking API change — if consumers use `zVoidMutationResult` directly as a schema (not calling it as a function), converting it to a function is breaking. Check the example apps and hotpot for usage before deciding.

- [ ] **Step 1: Migrate Batch A** (serverUtils.ts, boundaryHelpers.ts)

`serverUtils.ts`: Remove `import { z } from 'zod'`. The file already imports `$ZodError` from `./zod-core`. Change the `z.ZodError` type annotation in `formatZodIssues` parameter to use `$ZodError`, and the `z.ZodError` cast in `handleZodValidationError` to just `$ZodError`.

`boundaryHelpers.ts`: Change `extends z.ZodError` to `extends $ZodError`. Change `z.core.$ZodIssue` type references to direct imports from `zod/v4/core`. Remove `import { z } from 'zod'`.

- [ ] **Step 2: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 3: Commit Batch A**

```
git commit -m "refactor: migrate serverUtils and boundaryHelpers off import { z } from 'zod'"
```

- [ ] **Step 4: Migrate Batch B** (ids, codec, zx, utils, results, schemaHelpers, model, tables)

For each file:
1. Remove `import { z } from 'zod'`
2. Add `import { getZ } from './zod-core'` (if not already importing from zod-core)
3. At each function that uses `z.*()`, add `const z = getZ()` as the first line
4. Keep `import type { z } from 'zod'` if there are type-only references that can't be expressed via core types
5. Convert any remaining `z.ZodObject<any>` casts to core equivalents where possible

Special cases:
- `results.ts` — module-level constants (`zVoidMutationResult`, `zFormError`) need lazy init or function conversion. Check consumer usage first.
- `ids.ts` and `zx.ts` — `.refine().describe()` chains convert in Task 4

- [ ] **Step 5: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 6: Commit Batch B**

```
git commit -m "refactor: migrate schema construction modules to getZ() factory"
```

- [ ] **Step 7: Migrate Batch C** (builders, wrappers, custom)

Same pattern — replace `import { z } from 'zod'` with `getZ()` calls inside functions.

- [ ] **Step 8: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 9: Commit Batch C**

```
git commit -m "refactor: migrate wrapper/builder modules to getZ() factory"
```

- [ ] **Step 10: Migrate Batch D** (rules, db, registry, form/mantine)

`rules.ts`: `z.any()` → `getZ().any()`
`db.ts`: `z.union(...)` → `getZ().union(...)`; type casts `z.ZodObject<any>` → use core types
`registry.ts`: `z.toJSONSchema(...)` → `getZ().toJSONSchema(...)`
`form/mantine/index.ts`: `z.safeParse(...)` → use `safeParse()` from `zod/v4/core` (already exported from zod-core.ts)

- [ ] **Step 11: Run tests**

Run: `bun run test`
Expected: PASS

- [ ] **Step 12: Commit Batch D**

```
git commit -m "refactor: migrate remaining modules to getZ() factory"
```

---

### Task 4: Eliminate method chaining — convert to functional forms

All `.optional()`, `.nullable()`, `.refine()`, `.describe()` chains must become `z.optional()`, `z.nullable()`, `z.refine()`, `z.describe()` function calls.

**Files with chaining (16 sites in 5 files):**

- [ ] **Step 1: Convert `model.ts`** (6 sites)

```ts
// Line 244: z.number().optional()
z.optional(z.number())

// Line 253: z.string().nullable().optional()
z.optional(z.nullable(z.string()))

// Line 315: z.string().nullable().optional()
z.optional(z.nullable(z.string()))

// Line 330: z.number().optional()
z.optional(z.number())

// Line 344: z.number().optional()
z.optional(z.number())
```

- [ ] **Step 2: Convert `tables.ts`** (5 sites)

```ts
// Line 392, 448: z.string().nullable().optional()
z.optional(z.nullable(z.string()))

// Line 404, 465, 481: z.number().optional()
z.optional(z.number())
```

- [ ] **Step 3: Convert `utils.ts`** (4 sites)

```ts
// Line 81: z.string().nullable().optional()
z.optional(z.nullable(z.string()))

// Lines 100, 112: z.number().optional()
z.optional(z.number())

// Line 105: z.number().nullable()
z.nullable(z.number())
```

- [ ] **Step 4: Convert `ids.ts`** (1 site — `.refine().describe()` chain)

```ts
// BEFORE (lines 36-43):
const baseSchema = z
  .string()
  .refine(val => typeof val === 'string' && val.length > 0, {
    message: `Invalid ID for table "${tableName}"`
  })
  .describe(`convexId:${tableName}`)

// AFTER:
const baseSchema = z.describe(
  z.refine(z.string(), val => typeof val === 'string' && val.length > 0, {
    message: `Invalid ID for table "${tableName}"`
  }),
  `convexId:${tableName}`
)
```

- [ ] **Step 5: Convert `zx.ts`** (1 site — `.refine().describe()` chain in `id()`)

Same pattern as ids.ts — lines 90-95:

```ts
// BEFORE:
const baseSchema = z
  .string()
  .refine(val => typeof val === 'string' && val.length > 0, {
    message: `Invalid ID for table "${tableName}"`
  })
  .describe(`convexId:${tableName}`)

// AFTER:
const baseSchema = z.describe(
  z.refine(z.string(), val => typeof val === 'string' && val.length > 0, {
    message: `Invalid ID for table "${tableName}"`
  }),
  `convexId:${tableName}`
)
```

- [ ] **Step 6: Run tests**

Run: `bun run test`
Expected: All 860 tests pass

- [ ] **Step 7: Run type-check**

Run: `bun run type-check`
Expected: Clean

- [ ] **Step 8: Commit**

```
git commit -m "refactor: convert method chaining to functional forms for zod-mini compat"
```

---

### Task 5: Verify — full test suite, build, example apps

- [ ] **Step 1: Full test suite**

Run: `bun run test`
Expected: 860 tests pass

- [ ] **Step 2: Type check**

Run: `bun run type-check`
Expected: Clean

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: Clean (watch for any `'zod'` imports in mini entrypoint warnings)

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: Clean (may need `bun run lint:fix` for formatting changes)

- [ ] **Step 5: Example app tests**

Run:
```bash
cd examples/task-manager && bun run test
cd ../task-manager-mini && bun run test
```
Expected: 10/10 pass in both

- [ ] **Step 6: Verify no `import { z } from 'zod'` remains in src/ (except entrypoints)**

Run: `grep -r "import { z } from 'zod'" packages/zodvex/src/ --include='*.ts' | grep -v '/core/index.ts' | grep -v '/index.ts'`
Expected: No results (only entrypoint files should import from 'zod')

- [ ] **Step 7: Commit if any fixes were needed**

---

### Task 6: Stress test — measure the memory improvement

- [ ] **Step 1: Run the full stress test report**

```bash
cd examples/stress-test && bun run report
```

- [ ] **Step 2: Read the results**

```bash
cat examples/stress-test/results/report.md
```

Compare zod-mini numbers at 200 endpoints (both mode):
- Before (consumer-only mini): 58.16 MB
- After (full mini mode): should be significantly lower

- [ ] **Step 3: Commit updated results**

```
git add examples/stress-test/results/
git commit -m "perf: stress test results with full zod-mini mode"
```

---

### Task 7: Codegen — emit correct import path for mini consumers

The codegen (`zodvex generate`) emits `import { z } from 'zod'` in generated code. When a consumer uses mini, this should emit `import { z } from 'zod/mini'`.

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts`
- Modify: `packages/zodvex/src/codegen/zodToSource.ts`

- [ ] **Step 1: Check if codegen detects mini mode**

Read `packages/zodvex/src/codegen/generate.ts` to understand how it discovers the consumer's schema. The codegen needs a way to know whether the consumer uses mini. Options:
- Check if `zod/mini` is in the consumer's dependencies
- Add a `--mini` flag to the CLI
- Detect from the `zodvex/mini` import in the consumer's code

This is a research step — determine the right approach and implement accordingly.

- [ ] **Step 2: Update `zodToSource.ts` chaining**

Lines 53 and 56 emit `.optional()` and `.nullable()` as chained method calls. When targeting mini, these should emit `z.optional(...)` and `z.nullable(...)` functional forms instead.

- [ ] **Step 3: Run codegen verification**

```bash
cd examples/task-manager && bun x zodvex generate
git diff examples/task-manager/convex/_zodvex/
```

Expected: No diff (full zod codegen unchanged)

- [ ] **Step 4: Commit**

```
git commit -m "feat(codegen): emit mini-compatible imports and functional forms"
```
