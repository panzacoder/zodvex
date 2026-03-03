# Codegen Form Resolver Auto-Detection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Conditionally emit pre-bound `mantineResolver` in `_zodvex/client.ts` when `mantine-form-zod-resolver` is installed.

**Architecture:** `generate()` in `commands.ts` auto-detects optional form integrations by checking package resolution, then passes flags to `generateClientFile()` which conditionally appends the resolver import and pre-bound export.

**Tech Stack:** TypeScript, Bun test runner, tsup

---

### Task 1: Add failing test for generateClientFile with mantine option

**Files:**
- Modify: `packages/zodvex/__tests__/codegen-generate.test.ts`

**Step 1: Write the failing tests**

Add to the existing `describe('generateClientFile', ...)` block:

```ts
it('includes mantineResolver when mantine option is true', () => {
  const content = generateClientFile({ form: { mantine: true } })
  expect(content).toContain("import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'")
  expect(content).toContain('export const mantineResolver')
  expect(content).toContain('_mantineResolver(zodvexRegistry, ref)')
})

it('omits mantineResolver when mantine option is false', () => {
  const content = generateClientFile({ form: { mantine: false } })
  expect(content).not.toContain('mantineResolver')
})

it('omits mantineResolver when no options passed', () => {
  const content = generateClientFile()
  expect(content).not.toContain('mantineResolver')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: FAIL — `generateClientFile` doesn't accept arguments yet.

### Task 2: Implement generateClientFile options

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts:289-310`

**Step 1: Add options type and update generateClientFile**

Add interface before `generateClientFile`:

```ts
export interface ClientFileOptions {
  form?: { mantine?: boolean }
}
```

Update `generateClientFile` signature and body:

```ts
export function generateClientFile(options: ClientFileOptions = {}): string {
  const mantineSection = options.form?.mantine
    ? `
import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'
import type { FunctionReference } from 'convex/server'

export const mantineResolver = (ref: FunctionReference<any, any, any, any>) =>
  _mantineResolver(zodvexRegistry, ref)
`
    : ''

  return `${HEADER}
import { createZodvexHooks } from 'zodvex/react'
import { createZodvexReactClient, type ZodvexReactClientOptions } from 'zodvex/react'
import { createZodvexClient, type ZodvexClientOptions } from 'zodvex/client'
import { createBoundaryHelpers } from 'zodvex/core'
import { zodvexRegistry } from './api'

export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

export const createClient = (options: ZodvexClientOptions) =>
  createZodvexClient(zodvexRegistry, options)

export const createReactClient = (options: ZodvexReactClientOptions) =>
  createZodvexReactClient(zodvexRegistry, options)

export const { encodeArgs, decodeResult } = createBoundaryHelpers(zodvexRegistry)
${mantineSection}`
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: PASS — all tests including new ones.

**Step 3: Commit**

```bash
git add packages/zodvex/src/codegen/generate.ts packages/zodvex/__tests__/codegen-generate.test.ts
git commit -m "feat(codegen): conditionally emit mantineResolver in client.ts"
```

### Task 3: Add detection and wiring in commands.ts

**Files:**
- Modify: `packages/zodvex/src/cli/commands.ts`

**Step 1: Add detection function and wire into generate()**

Add helper before `generate()`:

```ts
import type { ClientFileOptions } from '../codegen/generate'

function detectFormIntegrations(projectRoot: string): ClientFileOptions {
  return {
    form: {
      mantine: canResolve('mantine-form-zod-resolver', projectRoot),
    },
  }
}

function canResolve(pkg: string, fromDir: string): boolean {
  try {
    require.resolve(pkg, { paths: [fromDir] })
    return true
  } catch {
    return false
  }
}
```

Update the `generate()` call site — change:

```ts
const clientContent = generateClientFile()
```

to:

```ts
const clientOptions = detectFormIntegrations(resolved)
const clientContent = generateClientFile(clientOptions)
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: PASS — all 878+ tests.

**Step 3: Run build and lint**

Run: `bun run build && bun run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/zodvex/src/cli/commands.ts
git commit -m "feat(cli): auto-detect mantine integration for codegen"
```

### Task 4: Add test for detection logic

**Files:**
- Modify: `packages/zodvex/__tests__/codegen-generate.test.ts` (or create `packages/zodvex/__tests__/codegen-detect.test.ts` if cleaner)

**Step 1: Write test for canResolve behavior**

Since `mantine-form-zod-resolver` IS installed in this repo (it's a dev dep), we can test the real detection:

```ts
describe('detectFormIntegrations', () => {
  it('detects mantine-form-zod-resolver when installed', () => {
    // mantine-form-zod-resolver is a dev dependency in this repo
    const result = detectFormIntegrations(process.cwd())
    expect(result.form?.mantine).toBe(true)
  })

  it('returns false for uninstalled packages', () => {
    const result = detectFormIntegrations(process.cwd())
    // This package doesn't exist
    expect(canResolve('nonexistent-package-xyz', process.cwd())).toBe(false)
  })
})
```

Note: `detectFormIntegrations` and `canResolve` will need to be exported from `commands.ts` (or extracted to a shared util) for testability. If exporting from `commands.ts` feels wrong, extract to a small `packages/zodvex/src/codegen/detect.ts` module that `commands.ts` imports.

**Step 2: Run tests**

Run: `bun test`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/zodvex/src/codegen/detect.ts packages/zodvex/__tests__/codegen-detect.test.ts packages/zodvex/src/cli/commands.ts
git commit -m "test: add detection tests for form integrations"
```

### Task 5: Verify end-to-end in example app

**Step 1: Run codegen against the example app**

Run: `bun run packages/zodvex/src/cli/index.ts generate examples/task-manager/convex`

**Step 2: Inspect generated client.ts**

Check if `examples/task-manager/convex/_zodvex/client.ts` does or doesn't contain `mantineResolver` (depends on whether example app has `mantine-form-zod-resolver` installed).

**Step 3: Run full checks**

Run: `bun run build && bun test && bun run lint`
Expected: PASS
