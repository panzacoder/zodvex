# zod-to-mini Vite Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vite plugin that compiles full-zod method chains to zod/mini functional forms at module load time, so the zodvex test suite runs identically under both `zod` and `zod/mini` from the same source files.

**Architecture:** The existing `packages/zod-to-mini/src/transforms.ts` contains proven AST transforms (42 unit tests) using ts-morph. We add a `transformCode()` string-in/string-out wrapper, then wrap that in a vite plugin. The plugin is added to the `zod-mini` vitest project alongside the existing `resolve.alias` (which handles import path rewriting). The plugin handles code-level transforms (method chains → functional forms, class refs → core imports).

**Tech Stack:** TypeScript, ts-morph, vite Plugin API, vitest

---

## Current State

- `packages/zod-to-mini/src/transforms.ts` — AST transforms with `transformFile(file: SourceFile)` entry point. 42 unit tests.
- `packages/zodvex/vitest.config.ts` — two vitest projects: `zod` (872 pass) and `zod-mini` (444 pass / 150 fail). The mini project has `resolve.alias` rewriting `'zod'` → `'zod/mini'` but no code-level transform.
- Failures are all runtime: `.optional is not a function` (28), `.email is not a function` (14), `.nullable is not a function` (14), `z.ZodError is not a constructor` (9), `.extend is not a function` (7), `instanceof` failures (7).
- Fixture files in `__tests__/fixtures/codegen-project/` also fail because they use method chains (`taggedEmail.optional()`, `phoneVariant.extend()`).

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/zod-to-mini/src/transforms.ts` | Modify | Add `transformCode()` string-in/string-out wrapper |
| `packages/zod-to-mini/src/transforms.test.ts` | Modify | Add integration tests for `transformCode()` with realistic multi-line input |
| `packages/zod-to-mini/src/vite-plugin.ts` | Create | Vite plugin wrapping `transformCode()` |
| `packages/zod-to-mini/src/vite-plugin.test.ts` | Create | Tests for the vite plugin |
| `packages/zod-to-mini/src/index.ts` | Modify | Export `transformCode` and `zodToMiniPlugin` |
| `packages/zod-to-mini/package.json` | Modify | Add `vite` as devDependency |
| `packages/zodvex/vitest.config.ts` | Modify | Add plugin to zod-mini project |

---

### Task 1: Add `transformCode()` to transforms.ts

**Files:**
- Modify: `packages/zod-to-mini/src/transforms.ts:429-465` (after `transformFile`)
- Modify: `packages/zod-to-mini/src/index.ts`

This adds a string-in/string-out wrapper around the existing `transformFile()`. The wrapper creates an in-memory ts-morph Project, runs all transforms, and returns the result. This is the reusable unit that both the CLI and the vite plugin call.

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/zod-to-mini/src/transforms.test.ts`:

```typescript
describe('transformCode', () => {
  it('transforms a string and returns the result', () => {
    const input = `import { z } from 'zod'\nconst s = z.string().optional()`
    const result = transformCode(input)
    expect(result.code).toContain('z.optional(z.string())')
    expect(result.changed).toBe(true)
  })

  it('returns changed=false when no transforms apply', () => {
    const input = `const x = 42`
    const result = transformCode(input)
    expect(result.code).toBe(input)
    expect(result.changed).toBe(false)
  })
})
```

Update the import at line 3 to include `transformCode`:
```typescript
import { transformFile, transformCode } from './transforms'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/zod-to-mini test -- src/transforms.test.ts`
Expected: FAIL — `transformCode` is not exported from `./transforms`

- [ ] **Step 3: Implement `transformCode`**

Add to the end of `packages/zod-to-mini/src/transforms.ts` (after the `transformFile` function):

```typescript
/**
 * String-in/string-out transform wrapper.
 * Creates an in-memory ts-morph project, applies all transforms, returns the result.
 */
export function transformCode(code: string, options?: { filename?: string }): { code: string; changed: boolean } {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false },
  })
  const file = project.createSourceFile(options?.filename ?? 'transform.ts', code)
  const result = transformFile(file)
  const transformed = file.getFullText()
  return {
    code: transformed,
    changed: result.totalChanges > 0 || result.classRefs > 0,
  }
}
```

- [ ] **Step 4: Export `transformCode` from index.ts**

Update `packages/zod-to-mini/src/index.ts`:

```typescript
export { transformFile, transformCode, transformWrappers, transformChecks, transformMethods, transformImports, transformClassRefs, findObjectOnlyMethods } from './transforms'
export type { TransformResult } from './transforms'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/zod-to-mini test -- src/transforms.test.ts`
Expected: All 44 tests pass (42 existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add packages/zod-to-mini/src/transforms.ts packages/zod-to-mini/src/transforms.test.ts packages/zod-to-mini/src/index.ts
git commit -m "feat(zod-to-mini): add transformCode() string-in/string-out wrapper"
```

---

### Task 2: Integration test with realistic file content

**Files:**
- Modify: `packages/zod-to-mini/src/transforms.test.ts`

The unit tests cover isolated expressions. This task adds a test with a realistic multi-line file (imports, objects, chains, class refs) to verify the full pipeline works on real-world code before wiring into the vite plugin.

- [ ] **Step 1: Write the integration test**

Add to the `transformCode` describe block in `packages/zod-to-mini/src/transforms.test.ts`:

```typescript
  it('transforms a realistic file with mixed patterns', () => {
    const input = `import { z } from 'zod'

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  age: z.number().int().positive(),
  bio: z.string().nullable(),
  role: z.string().default("user"),
})

const InsertSchema = UserSchema.partial().extend({ id: z.string() })

function validate(schema: z.ZodType) {
  return schema.describe("validated")
}
`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    // Wrappers
    expect(result.code).toContain('z.optional(z.string().check(z.email()))')
    expect(result.code).toContain('z.nullable(z.string())')
    // Checks
    expect(result.code).toContain('.check(z.minLength(1))')
    expect(result.code).toContain('.check(z.int())')
    expect(result.code).toContain('.check(z.positive())')
    // Methods
    expect(result.code).toContain('z._default(')
    expect(result.code).toContain('z.extend(z.partial(UserSchema)')
    expect(result.code).toContain('z.describe(schema, "validated")')
    // Class refs
    expect(result.code).toContain('$ZodType')
    expect(result.code).toContain("from 'zod/v4/core'")
  })

  it('handles fixture-style code with non-z schema expressions', () => {
    const input = `import { z } from 'zod'

const taggedEmail = tagged(z.string())
const schema = z.object({
  email: taggedEmail.optional(),
  notes: z.string().nullable().optional(),
})
`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('z.optional(taggedEmail)')
    expect(result.code).toContain('z.optional(z.nullable(z.string()))')
  })

  it('handles z.ZodError constructor usage', () => {
    const input = `import { z } from 'zod'

function makeError() {
  return new z.ZodError([{ code: 'custom', path: [], message: 'fail' }])
}

if (err instanceof z.ZodError) { throw err }
`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('new $ZodError(')
    expect(result.code).toContain('instanceof $ZodError')
    expect(result.code).toContain("from 'zod/v4/core'")
  })
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun run --cwd packages/zod-to-mini test -- src/transforms.test.ts`
Expected: All 47 tests pass (44 + 3 new)

These tests verify the transforms work correctly on realistic multi-line code. If any fail, the transform logic needs fixing BEFORE building the vite plugin.

- [ ] **Step 3: Commit**

```bash
git add packages/zod-to-mini/src/transforms.test.ts
git commit -m "test(zod-to-mini): add integration tests for transformCode with realistic files"
```

---

### Task 3: Create the vite plugin

**Files:**
- Create: `packages/zod-to-mini/src/vite-plugin.ts`
- Create: `packages/zod-to-mini/src/vite-plugin.test.ts`
- Modify: `packages/zod-to-mini/src/index.ts`
- Modify: `packages/zod-to-mini/package.json`

The vite plugin is a thin wrapper around `transformCode()`. It intercepts `.ts`/`.tsx`/`.js`/`.jsx` files during Vite's transform phase and applies the zod-to-mini transforms. A quick bail check skips files that don't reference zod at all.

- [ ] **Step 1: Add vite as a dev dependency**

Run: `bun add --cwd packages/zod-to-mini vite --dev`

- [ ] **Step 2: Write the test file**

Create `packages/zod-to-mini/src/vite-plugin.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { zodToMiniPlugin } from './vite-plugin'

describe('zodToMiniPlugin', () => {
  it('returns a vite plugin with correct name', () => {
    const plugin = zodToMiniPlugin()
    expect(plugin.name).toBe('zod-to-mini')
    expect(plugin.enforce).toBe('pre')
  })

  it('transforms .ts files with zod method chains', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`
    const result = transform.call({}, input, '/test/file.ts')

    expect(result).not.toBeUndefined()
    expect(result!.code).toContain('z.optional(z.string())')
  })

  it('skips non-ts/js files', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const result = transform.call({}, 'const x = 1', '/test/file.css')
    expect(result).toBeUndefined()
  })

  it('skips files without zod references', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const result = transform.call({}, 'const x = 1', '/test/file.ts')
    expect(result).toBeUndefined()
  })

  it('skips files where no transforms apply', () => {
    const plugin = zodToMiniPlugin()
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    // File imports zod but uses no method chains
    const input = `import { z } from 'zod'\nconst s = z.string()`
    const result = transform.call({}, input, '/test/file.ts')
    expect(result).toBeUndefined()
  })

  it('respects include option', () => {
    const plugin = zodToMiniPlugin({ include: /__tests__/ })
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`

    const included = transform.call({}, input, '/project/__tests__/file.ts')
    expect(included).not.toBeUndefined()

    const excluded = transform.call({}, input, '/project/src/file.ts')
    expect(excluded).toBeUndefined()
  })

  it('respects exclude option', () => {
    const plugin = zodToMiniPlugin({ exclude: /node_modules/ })
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | undefined

    const input = `import { z } from 'zod'\nconst s = z.string().optional()`

    const excluded = transform.call({}, input, '/project/node_modules/zod/index.ts')
    expect(excluded).toBeUndefined()

    const included = transform.call({}, input, '/project/src/file.ts')
    expect(included).not.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --cwd packages/zod-to-mini test -- src/vite-plugin.test.ts`
Expected: FAIL — `./vite-plugin` module not found

- [ ] **Step 4: Implement the vite plugin**

Create `packages/zod-to-mini/src/vite-plugin.ts`:

```typescript
import type { Plugin } from 'vite'
import { transformCode } from './transforms'

export interface ZodToMiniPluginOptions {
  /** Only transform files matching this pattern. Default: all .ts/.tsx/.js/.jsx files */
  include?: RegExp
  /** Skip files matching this pattern. Default: none */
  exclude?: RegExp
}

/**
 * Vite plugin that transforms full-zod method chains to zod/mini functional forms.
 *
 * Use alongside resolve.alias to rewrite import paths:
 *   resolve: { alias: [{ find: /^zod$/, replacement: 'zod/mini' }] }
 *
 * The alias handles import path rewriting. This plugin handles code transforms:
 *   .optional() → z.optional(schema)
 *   .email()    → .check(z.email())
 *   .extend()   → z.extend(schema, shape)
 *   z.ZodError  → $ZodError (+ import from zod/v4/core)
 *   etc.
 */
export function zodToMiniPlugin(options?: ZodToMiniPluginOptions): Plugin {
  return {
    name: 'zod-to-mini',
    enforce: 'pre',

    transform(code, id) {
      // Only process JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return

      // Apply include/exclude filters
      if (options?.include && !options.include.test(id)) return
      if (options?.exclude && options.exclude.test(id)) return

      // Quick bail: skip files that don't reference zod
      if (!code.includes("'zod'") && !code.includes('"zod"') && !code.includes('z.Zod')) return

      const result = transformCode(code, { filename: id })

      if (!result.changed) return

      return { code: result.code, map: null }
    },
  }
}
```

- [ ] **Step 5: Export from index.ts**

Update `packages/zod-to-mini/src/index.ts`:

```typescript
export { transformFile, transformCode, transformWrappers, transformChecks, transformMethods, transformImports, transformClassRefs, findObjectOnlyMethods } from './transforms'
export type { TransformResult } from './transforms'
export { zodToMiniPlugin } from './vite-plugin'
export type { ZodToMiniPluginOptions } from './vite-plugin'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run --cwd packages/zod-to-mini test`
Expected: All tests pass (47 transforms tests + 7 plugin tests)

- [ ] **Step 7: Commit**

```bash
git add packages/zod-to-mini/src/vite-plugin.ts packages/zod-to-mini/src/vite-plugin.test.ts packages/zod-to-mini/src/index.ts packages/zod-to-mini/package.json
git commit -m "feat(zod-to-mini): add vite plugin for compile-time zod → mini transforms"
```

---

### Task 4: Wire plugin into vitest config

**Files:**
- Modify: `packages/zodvex/vitest.config.ts`

Add the plugin to the `zod-mini` vitest project. The plugin runs alongside the existing `resolve.alias` — the alias rewrites import paths (`'zod'` → `'zod/mini'`), the plugin rewrites code (`.optional()` → `z.optional()`).

- [ ] **Step 1: Update vitest.config.ts**

Replace the contents of `packages/zodvex/vitest.config.ts` with:

```typescript
import { defineConfig } from 'vitest/config'
import { zodToMiniPlugin } from '../zod-to-mini/src/vite-plugin'

export default defineConfig({
  test: {
    // Run the suite twice: once with full zod, once with zod aliased to zod/mini.
    // This validates compatibility with both variants from the same test code.
    //
    // Codegen tests (codegen-cli, codegen-e2e, codegen-generate) share a single fixture
    // directory (__tests__/fixtures/codegen-project) and write/delete files in it during
    // each test. Running those files in parallel causes races between afterEach cleanup
    // and the next test's writes. Disabling file-level parallelism is the simplest fix;
    // the full suite runs in ~7s so the cost is acceptable.
    //
    // If the suite grows significantly, consider migrating the codegen tests to isolated
    // temp directories (fs.mkdtempSync) and re-enabling fileParallelism here.
    projects: [
      {
        test: {
          name: 'zod',
          include: ['__tests__/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'zod-mini',
          include: ['__tests__/**/*.test.ts'],
          fileParallelism: false,
        },
        plugins: [zodToMiniPlugin()],
        resolve: {
          alias: [
            // Exact-match alias: only the bare specifier 'zod' is rewritten to
            // 'zod/mini'. Subpath imports like 'zod/v4/core' and 'zod/mini' are
            // NOT affected because the regex anchors prevent prefix matching.
            { find: /^zod$/, replacement: 'zod/mini' },
          ],
        },
      },
    ],
  },
})
```

- [ ] **Step 2: Run the zod project to verify it's unaffected**

Run: `bun run test -- --project zod`
Expected: 872 tests pass, 55 files pass. The plugin is NOT applied to the zod project.

- [ ] **Step 3: Run the zod-mini project**

Run: `bun run test -- --project zod-mini`
Expected: Significant improvement over current 444/150 pass/fail ratio. Ideally close to 872 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/zodvex/vitest.config.ts
git commit -m "feat: wire zod-to-mini vite plugin into zod-mini vitest project"
```

---

### Task 5: Fix remaining zod-mini failures

**Files:**
- Potentially modify: `packages/zod-to-mini/src/transforms.ts` (new transform patterns)
- Potentially modify: test files (if failures reveal genuine mini incompatibilities vs codemod gaps)

After wiring the plugin, some tests may still fail due to:
1. **Transform gaps**: patterns the codemod doesn't handle yet (investigate and add)
2. **Genuine mini incompatibilities**: features that truly don't exist in mini (these tests should be skipped in the mini project, not "fixed")
3. **Fixture files needing transforms**: the plugin transforms all `.ts` files in the module graph, including fixtures — verify this works

For each failure category:
- Transform gap → add the missing transform to `transforms.ts` with a unit test
- Genuine incompatibility → add a `// @vitest-skip-mini` comment or conditional skip
- Runtime difference → investigate and decide (may be a zodvex source-level fix)

- [ ] **Step 1: Run zod-mini and capture all failures**

Run: `bun run test -- --project zod-mini --reporter=verbose 2>&1 | tee /tmp/zod-mini-results.txt`

Analyze the output to categorize failures.

- [ ] **Step 2: Fix transform gaps (if any)**

For each missing transform:
1. Add a unit test to `packages/zod-to-mini/src/transforms.test.ts`
2. Run it to verify it fails
3. Add the transform to `packages/zod-to-mini/src/transforms.ts`
4. Run it to verify it passes

- [ ] **Step 3: Handle genuine incompatibilities (if any)**

If a test exercises a feature that genuinely doesn't exist in mini, skip it for the mini project. The cleanest approach: check `import.meta.env` or the vitest project name in the test file.

- [ ] **Step 4: Verify both projects pass**

Run: `bun run test`
Expected: Both projects green. Zod project: 872 pass. Zod-mini project: as close to 872 as possible (minus any genuinely-skipped tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(zod-to-mini): address remaining zod-mini test failures"
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transform engine | ts-morph | Reuses proven transform code (42 unit tests). Optimize to oxc/magic-string later if perf is a problem. |
| Plugin scope | Vite-specific | Immediate need is vitest. Wrap in unplugin later for consumer-facing use. |
| Source maps | `null` | Acceptable for test suite. Stack traces point to original files. |
| Import handling | Plugin does NOT transform imports | The vitest `resolve.alias` already handles `'zod'` → `'zod/mini'` at the resolve level. |
| Class refs | Plugin DOES transform | `z.ZodError` → `$ZodError` + core import, because mini doesn't expose classes on `z` namespace. |
| File filtering | Quick bail on `'zod'` string presence | Avoids ts-morph overhead for files that don't reference zod. Configurable via `include`/`exclude`. |
| Plugin placement | `packages/zod-to-mini/src/vite-plugin.ts` | Co-located with transforms it wraps. Imported via relative path from vitest config. |

## Risks

1. **ts-morph performance**: Creating an in-memory Project per file adds overhead. Current test suite runs in ~6.5s. If ts-morph doubles this to ~13s, it's acceptable for CI but noticeable. Mitigation: quick bail skips files without zod references.

2. **Transform correctness on full files**: Unit tests cover isolated expressions. Real test files have imports, multi-line objects, closures, type annotations. The Task 2 integration tests mitigate this, but edge cases may surface in Task 5.

3. **Fixture files**: Codegen tests dynamically import fixture files at runtime. These go through Vite's module pipeline, so the plugin transforms them. The transforms should produce equivalent schemas (same `_zod.def` structure), but codegen test expectations may need adjusting if the transformed code looks different.
