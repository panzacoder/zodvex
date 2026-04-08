# zod/mini Compatibility Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix zodvex/mini type declarations so they correctly type mini schemas, add a mini/server entrypoint, and add tests that prevent regression.

**Architecture:** The build-time esbuild alias (`zodMiniAliasPlugin` in tsup.config.ts) already rewrites `import { z } from 'zod'` → `import { z } from 'zod/mini'` for the mini build. The runtime is correct. The problem is purely in the TypeScript type declarations: `mini/index.ts` has incorrect type overrides that cause the InsertSchema generic to reference an undefined `ZodObject` type, cascading into broken DataModel types for consumers. The fix is to correct the type annotations and add the missing mini/server entrypoint.

**Tech Stack:** TypeScript, zod v4, zod/mini, Convex, tsup, vitest

**Spec:** `docs/superpowers/specs/2026-04-06-zod-mini-compat-redesign.md`

---

### Task 1: Fix the InsertSchema type in mini/index.ts

The root type bug. Line 112 references bare `ZodObject` (not imported). Must use `$ZodObject<Fields>` from `zod/v4/core`.

**Files:**
- Modify: `packages/zodvex/src/mini/index.ts:107-118`

- [ ] **Step 1: Fix the InsertSchema type on line 112**

Change the `defineZodModel` overload to use `$ZodObject` (already imported on line 83):

```ts
export const defineZodModel: {
  <Name extends string, Fields extends $ZodShape>(
    name: Name,
    fields: Fields
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, Fields, $ZodObject<Fields>, MiniModelSchemas<Name, Fields>, {}, {}, {}>
  <Name extends string, Schema extends $ZodType>(
    name: Name,
    schema: Schema
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, $ZodShape, Schema, _ModelSchemas, {}, {}, {}>
} = _defineZodModel as any
```

The key change: `ZodObject<Fields>` → `$ZodObject<Fields>` on the InsertSchema position (3rd generic param).

- [ ] **Step 2: Run type-check to verify the fix compiles**

Run: `bun run type-check`
Expected: The `TS2552: Cannot find name 'ZodObject'` error on `mini/index.ts:112` is gone.

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/src/mini/index.ts
git commit -m "fix(mini): use \$ZodObject for InsertSchema type in mini overload

The mini defineZodModel overload referenced bare ZodObject (undefined)
instead of \$ZodObject from zod/v4/core, breaking the entire type chain
for mini consumers."
```

---

### Task 2: Verify the type fix resolves task-manager-mini errors

The InsertSchema fix should cascade: correct InsertSchema → correct ConvexTableFor → correct DataModel → correct withIndex/filter types.

**Files:**
- Read-only verification of: `examples/task-manager-mini/convex/`

- [ ] **Step 1: Type-check task-manager-mini**

Run: `cd examples/task-manager-mini/convex && bun run tsc --noEmit 2>&1 | head -50`

Expected: Significantly fewer type errors. The `Id<"users"> not assignable to undefined` and `not assignable to "required"` errors should be gone — these indicate broken DataModel field type extraction.

- [ ] **Step 2: If errors remain, investigate**

If there are remaining errors, they are likely in:
1. The `MiniModelSchemas` type (lines 86-105 of `mini/index.ts`) — the schema bundle types may need to use `$ZodObject`, `$ZodArray`, etc. from core instead of `ZodMiniObject`, `ZodMiniArray` from `zod/mini`.
2. The union overload (line 113-117) — the second overload for pre-built schemas.

The principle: all types in the `.d.ts` output must come from `zod/v4/core` (which both `zod` and `zod/mini` extend), not from `zod/mini` directly. The tsc generates `.d.ts` from source, and `import type { ZodMiniObject } from 'zod/mini'` may not resolve correctly in the consumer's type environment when they're using the built package.

If `MiniModelSchemas` is the issue, replace `ZodMini*` types with core `$Zod*` types:

```ts
import type { $ZodArray, $ZodBoolean, $ZodNullable, $ZodNumber, $ZodObject, $ZodOptional, $ZodString } from '../zod-core'

export type MiniModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }>
  readonly base: $ZodObject<Fields>
  readonly insert: $ZodObject<Fields>
  readonly update: $ZodObject<
    { _id: ZxMiniId<Name>; _creationTime: $ZodOptional<$ZodNumber> } & {
      [K in keyof Fields]: $ZodOptional<Fields[K]>
    }
  >
  readonly docArray: $ZodArray<
    $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }>
  >
  readonly paginatedDoc: $ZodObject<{
    page: $ZodArray<
      $ZodObject<Fields & { _id: ZxMiniId<Name>; _creationTime: $ZodNumber }>
    >
    isDone: $ZodBoolean
    continueCursor: $ZodOptional<$ZodNullable<$ZodString>>
  }>
}
```

This is valid because all mini classes extend the core `$Zod*` classes. The runtime objects (created by zod/mini via the build alias) ARE `$ZodObject` instances.

- [ ] **Step 3: Re-run type-check on both zodvex and task-manager-mini**

Run: `bun run type-check && cd examples/task-manager-mini/convex && bun run tsc --noEmit`
Expected: Zero type errors in both.

- [ ] **Step 4: Commit if changes were needed**

```bash
git add packages/zodvex/src/mini/index.ts
git commit -m "fix(mini): use core types in MiniModelSchemas for correct .d.ts output

Replace ZodMini* imports from zod/mini with \$Zod* from zod/v4/core
in the MiniModelSchemas type. Both are structurally identical (mini
classes extend core), but core types resolve correctly in the .d.ts
files that tsc generates from source."
```

---

### Task 3: Add zodvex/mini/server entrypoint

Server modules (builders, db, wrappers, init) currently only build with full zod. Consumers using zod/mini on the server (Convex functions) need a mini server entrypoint.

**Files:**
- Create: `packages/zodvex/src/mini/server/index.ts`
- Modify: `packages/zodvex/tsup.config.ts:54-62`
- Modify: `packages/zodvex/package.json:42` (exports map)

- [ ] **Step 1: Create mini/server entrypoint**

Create `packages/zodvex/src/mini/server/index.ts`:

```ts
/**
 * zodvex/mini/server - Server-only utilities for zod/mini consumers
 *
 * Same API as zodvex/server, but built with zod/mini via the esbuild
 * alias plugin. All internal schema construction uses zod/mini at runtime.
 *
 * Use this in Convex function files when your project uses zod/mini.
 */

// Re-export everything from the standard server entrypoint.
// The build-time esbuild alias rewrites 'zod' → 'zod/mini' in the output,
// so all z.object(), z.string() etc. calls use zod/mini at runtime.
export * from '../../server'
```

- [ ] **Step 2: Add mini/server to tsup mini build**

In `packages/zodvex/tsup.config.ts`, change the mini build entry from:

```ts
entry: { 'mini/index': 'src/mini/index.ts' },
```

to:

```ts
entry: {
  'mini/index': 'src/mini/index.ts',
  'mini/server/index': 'src/mini/server/index.ts',
},
```

- [ ] **Step 3: Add mini/server to package.json exports**

In `packages/zodvex/package.json`, after the `"./mini"` export (line 37), add:

```json
"./mini/server": {
  "types": "./dist/mini/server/index.d.ts",
  "import": "./dist/mini/server/index.js",
  "default": "./dist/mini/server/index.js"
},
```

- [ ] **Step 4: Verify the build**

Run: `bun run build 2>&1 | tail -25`
Expected: Build succeeds. `dist/mini/server/index.js` is listed in output.

- [ ] **Step 5: Verify mini/server output uses zod/mini**

Run: `head -3 packages/zodvex/dist/mini/server/index.js`
Expected: Should contain `from 'zod/mini'`, NOT `from 'zod'`.

- [ ] **Step 6: Commit**

```bash
git add packages/zodvex/src/mini/server/index.ts packages/zodvex/tsup.config.ts packages/zodvex/package.json
git commit -m "feat(mini): add zodvex/mini/server entrypoint

Server modules (builders, db, wrappers, init) now have a mini variant
built with the esbuild alias plugin. Consumers using zod/mini in Convex
functions import from 'zodvex/mini/server' instead of 'zodvex/server'."
```

---

### Task 4: Add runtime assertion tests

Verify that the mini build actually produces mini objects at runtime, not full-zod objects.

**Files:**
- Modify: `packages/zodvex/__tests__/model-mini-types.test.ts`

- [ ] **Step 1: Add runtime mini instance checks**

Add to the end of `packages/zodvex/__tests__/model-mini-types.test.ts`:

```ts
// ============================================================================
// Runtime verification: mini build produces correct instances
// ============================================================================

import { $ZodObject, $ZodArray } from 'zod/v4/core'

describe('mini runtime: schemas are core-compatible instances', () => {
  it('model.schema.doc is an instanceof $ZodObject', () => {
    expect(miniModel.schema.doc).toBeInstanceOf($ZodObject)
  })

  it('model.schema.insert is an instanceof $ZodObject', () => {
    expect(miniModel.schema.insert).toBeInstanceOf($ZodObject)
  })

  it('model.schema.docArray is an instanceof $ZodArray', () => {
    expect(miniModel.schema.docArray).toBeInstanceOf($ZodArray)
  })

  it('model.schema.update is an instanceof $ZodObject', () => {
    expect(miniModel.schema.update).toBeInstanceOf($ZodObject)
  })

  it('model.schema.paginatedDoc is an instanceof $ZodObject', () => {
    expect(miniModel.schema.paginatedDoc).toBeInstanceOf($ZodObject)
  })

  it('core and mini models produce structurally equivalent schemas', () => {
    // Both should have the same field names in their shape
    const coreShape = Object.keys((coreModel.schema.doc as any)._zod.def.shape)
    const miniShape = Object.keys((miniModel.schema.doc as any)._zod.def.shape)
    expect(coreShape.sort()).toEqual(miniShape.sort())
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- packages/zodvex/__tests__/model-mini-types.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/zodvex/__tests__/model-mini-types.test.ts
git commit -m "test(mini): add runtime assertions for mini schema instances

Verifies that schemas produced by defineZodModel via the mini entrypoint
are instanceof core \$ZodObject/\$ZodArray classes and have the correct
shape structure."
```

---

### Task 5: Add import isolation test for mini path

Verify that the built mini entrypoint never imports from `'zod'` (full). This catches regressions where someone adds a new `import { z } from 'zod'` that the esbuild plugin misses (e.g., dynamic imports or new entrypoints not covered by the alias).

**Files:**
- Create: `packages/zodvex/__tests__/mini-import-isolation.test.ts`

- [ ] **Step 1: Write the import isolation test**

Create `packages/zodvex/__tests__/mini-import-isolation.test.ts`:

```ts
/**
 * Import isolation test for zodvex/mini.
 *
 * Verifies that the built mini entrypoint contains no references to
 * bare 'zod' (full) — only 'zod/mini' and 'zod/v4/core'.
 * This catches regressions where the esbuild alias plugin fails to
 * rewrite an import.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(__dirname, '../dist/mini')

function readBuiltFile(name: string): string {
  return readFileSync(resolve(distDir, name), 'utf-8')
}

describe('mini build: import isolation', () => {
  it('dist/mini/index.js has no bare zod imports', () => {
    const content = readBuiltFile('index.js')
    // Match 'zod' but not 'zod/mini' or 'zod/v4/core'
    const bareZodImports = content.match(/from\s+['"]zod['"]/g)
    expect(bareZodImports).toBeNull()
  })

  it('dist/mini/index.js imports from zod/mini', () => {
    const content = readBuiltFile('index.js')
    expect(content).toContain("from 'zod/mini'")
  })

  it('dist/mini/server/index.js has no bare zod imports', () => {
    const content = readBuiltFile('server/index.js')
    const bareZodImports = content.match(/from\s+['"]zod['"]/g)
    expect(bareZodImports).toBeNull()
  })

  it('dist/mini/server/index.js imports from zod/mini', () => {
    const content = readBuiltFile('server/index.js')
    expect(content).toContain("from 'zod/mini'")
  })
})
```

- [ ] **Step 2: Run build first (tests depend on dist output)**

Run: `bun run build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Run the import isolation tests**

Run: `bun run test -- packages/zodvex/__tests__/mini-import-isolation.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/__tests__/mini-import-isolation.test.ts
git commit -m "test(mini): add import isolation test for built mini output

Reads dist/mini/*.js files and verifies they contain no bare 'zod'
imports — only 'zod/mini' and 'zod/v4/core'. Catches regressions
where the esbuild alias plugin fails to rewrite an import."
```

---

### Task 6: Add task-manager-mini type-check to CI verification

Ensure the example app type-checks as part of the test suite so type regressions are caught.

**Files:**
- Modify: `packages/zodvex/package.json` (add a script)
- Or: Add a standalone check script

- [ ] **Step 1: Verify task-manager-mini type-checks clean**

Run: `cd examples/task-manager-mini/convex && bun run tsc --noEmit 2>&1`
Expected: Zero errors. If there are still errors, they must be resolved first (go back to Task 2).

- [ ] **Step 2: Add a type-check script for examples**

In `packages/zodvex/package.json`, add to scripts:

```json
"type-check:examples": "tsc -p examples/task-manager-mini/convex/tsconfig.json --noEmit"
```

Note: This may need path adjustment depending on where `tsc` resolves the project. If the tsconfig is relative, run from the workspace root instead. Test it:

Run: `cd /Users/jshebert/Development/plfx/zodvex && bun run tsc -p examples/task-manager-mini/convex/tsconfig.json --noEmit 2>&1 | head -10`

If the path doesn't work from root, use:
```json
"type-check:examples": "cd examples/task-manager-mini/convex && tsc --noEmit"
```

- [ ] **Step 3: Run the script to verify it works**

Run: `bun run type-check:examples`
Expected: Clean exit, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/package.json
git commit -m "chore: add type-check:examples script for mini example verification"
```

---

### Task 7: Run full test suite and verify everything passes

**Files:**
- None modified — verification only

- [ ] **Step 1: Run the zodvex type checker**

Run: `bun run type-check`
Expected: Zero errors.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`
Expected: All tests pass (including the new mini runtime tests from Task 4).

- [ ] **Step 3: Run the build**

Run: `bun run build`
Expected: Clean build with no tsc errors. Both `dist/mini/index.js` and `dist/mini/server/index.js` produced.

- [ ] **Step 4: Verify no full-zod imports in mini outputs**

Run:
```bash
grep '"zod"' packages/zodvex/dist/mini/index.js packages/zodvex/dist/mini/server/index.js || echo "PASS: no full-zod imports in mini outputs"
```
Expected: "PASS: no full-zod imports in mini outputs"

- [ ] **Step 5: Verify mini outputs use zod/mini**

Run:
```bash
grep -c 'zod/mini' packages/zodvex/dist/mini/index.js && grep -c 'zod/mini' packages/zodvex/dist/mini/server/index.js
```
Expected: At least 1 occurrence in each file.
