# Type-Aware Transforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the zod-to-mini transforms type-aware for ambiguous methods (`pick`, `extend`, `partial`, `omit`, `catchall`) using TypeScript's type checker, eliminating false positives on non-Zod objects like `codec.pick()`.

**Architecture:** The vite plugin creates a persistent ts-morph `Project` with the real tsconfig at startup. `transformMethods()` receives an optional type checker. For ambiguous methods, it queries the receiver's type for a `_zod` property — the universal marker on all Zod schemas. Unambiguous transforms (`.optional()`, `.email()`, class refs) stay purely syntactic. A perf benchmark transforms the task-manager example to measure overhead.

**Tech Stack:** TypeScript, ts-morph (with type checker enabled), vitest

---

## Current State

- `transformMethods()` in `packages/zod-to-mini/src/transforms.ts` converts `pick`, `extend`, `partial`, `omit`, `catchall` unconditionally (any receiver).
- This causes false positives: `codec.pick(...)` → `z.pick(codec, ...)` when `codec` is a zodvex `ConvexCodec`, not a Zod schema.
- Workaround: `codec['pick']` bracket access in `packages/zodvex/__tests__/codec.test.ts:130`.
- The vite plugin uses a quick bail (`'zod'` string check) to avoid transforming mini-native files, which papers over the problem.
- `transformCode()` creates a throwaway `Project({ useInMemoryFileSystem: true })` per file — no type info available.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/zod-to-mini/src/transforms.ts` | Modify | Add `isZodSchema()` type check; gate ambiguous methods behind it |
| `packages/zod-to-mini/src/transforms.test.ts` | Modify | Add type-aware transform tests |
| `packages/zod-to-mini/src/vite-plugin.ts` | Modify | Create persistent `Project` with tsconfig; pass to `transformCode()` |
| `packages/zod-to-mini/src/vite-plugin.test.ts` | Modify | Test type-aware plugin behavior |
| `packages/zodvex/__tests__/codec.test.ts` | Modify | Remove `codec['pick']` bracket-access workaround |
| `packages/zod-to-mini/src/perf.test.ts` | Create | Benchmark: transform task-manager files with and without type checking |

---

### Task 1: Add type-aware check for ambiguous methods in transformMethods

**Files:**
- Modify: `packages/zod-to-mini/src/transforms.ts`
- Modify: `packages/zod-to-mini/src/transforms.test.ts`

Split the current `TOP_LEVEL_METHODS` into two groups: methods safe to transform unconditionally (`pipe`, `brand`) and methods that need type checking (`pick`, `extend`, `partial`, `omit`, `catchall`). When a type checker is available, ambiguous methods only transform if the receiver is a Zod schema (has `_zod` property). Without a type checker, fall back to the existing `isLikelySchemaExpr` heuristic.

- [ ] **Step 1: Write the failing test**

Add to `packages/zod-to-mini/src/transforms.test.ts`, in the `transformMethods` describe block:

```typescript
describe('type-aware ambiguous methods', () => {
  it('does NOT transform codec.pick() without type checker (ambiguous)', () => {
    // Without type info, ambiguous methods require isLikelySchemaExpr
    expect(transform('codec.pick({ name: true })')).toBe('codec.pick({ name: true })')
  })

  it('still transforms z.object().pick() without type checker (schema expr)', () => {
    expect(transform('z.object({ a: z.string() }).pick({ a: true })')).toBe('z.pick(z.object({ a: z.string() }), { a: true })')
  })

  it('still transforms schema.pipe() unconditionally', () => {
    expect(transform('schema.pipe(z.number())')).toBe('z.pipe(schema, z.number())')
  })

  it('still transforms schema.brand() unconditionally', () => {
    expect(transform('schema.brand("Email")')).toBe('z.brand(schema, "Email")')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jshebert/Development/plfx/zodvex/packages/zod-to-mini && bunx vitest run src/transforms.test.ts`

Expected: The first test fails — `codec.pick({ name: true })` is currently transformed to `z.pick(codec, { name: true })` because `pick` is in `TOP_LEVEL_METHODS` with no guard.

- [ ] **Step 3: Split TOP_LEVEL_METHODS and add isLikelySchemaExpr guard**

In `packages/zod-to-mini/src/transforms.ts`, replace:

```typescript
/** Methods that become z.methodName(schema, ...args) */
const TOP_LEVEL_METHODS = [
  'pipe', 'brand',
  'partial', 'extend', 'catchall', 'omit', 'pick',
] as const
```

With:

```typescript
/** Methods that become z.methodName(schema, ...args) — safe to transform unconditionally */
const UNCONDITIONAL_TOP_LEVEL = ['pipe', 'brand'] as const

/** Methods that become z.methodName(schema, ...args) — only transform when receiver is
 *  confirmed as a Zod schema. These method names collide with non-Zod APIs
 *  (e.g., ConvexCodec.pick(), Lodash.extend()). Without type info, we fall back to
 *  the isLikelySchemaExpr heuristic. */
const AMBIGUOUS_TOP_LEVEL = ['partial', 'extend', 'catchall', 'omit', 'pick'] as const
```

Then in `transformMethods()`, update the TOP_LEVEL_METHODS check. Replace:

```typescript
    // Top-level function form: schema.method(args) → z.method(schema, args)
    if ((TOP_LEVEL_METHODS as readonly string[]).includes(method)) {
      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }
```

With:

```typescript
    // Unconditional top-level: always safe to transform (no name collisions)
    if ((UNCONDITIONAL_TOP_LEVEL as readonly string[]).includes(method)) {
      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }

    // Ambiguous top-level: only transform when receiver is a Zod schema.
    // With type checker: query the receiver type for _zod property.
    // Without type checker: fall back to isLikelySchemaExpr heuristic.
    if ((AMBIGUOUS_TOP_LEVEL as readonly string[]).includes(method)) {
      const isSchema = typeChecker
        ? isZodSchemaByType(call, typeChecker)
        : isLikelySchemaExpr(obj)
      if (!isSchema) continue

      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }
```

Add the `typeChecker` parameter to `transformMethods`:

```typescript
export function transformMethods(file: SourceFile, typeChecker?: TypeChecker): number {
```

Add the `isZodSchemaByType` helper near the other helpers at the top of the file:

```typescript
import { Project, type SourceFile, SyntaxKind, type CallExpression, type PropertyAccessExpression, type TypeChecker } from 'ts-morph'

// ... existing helpers ...

/**
 * Uses the TypeScript type checker to determine if the receiver of a method call
 * is a Zod schema. Checks for the `_zod` property which exists on every Zod schema
 * instance (both full zod and zod/mini).
 */
function isZodSchemaByType(call: CallExpression, typeChecker: TypeChecker): boolean {
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false
  const receiver = (expr as PropertyAccessExpression).getExpression()

  try {
    const type = typeChecker.getTypeAtLocation(receiver)
    return type.getProperties().some(p => p.getName() === '_zod')
  } catch {
    // Type resolution failed (unresolved imports, etc.) — can't confirm
    return false
  }
}
```

- [ ] **Step 4: Thread typeChecker through transformFile and transformCode**

Update `transformFile` signature and pass `typeChecker` to `transformMethods`:

```typescript
export function transformFile(file: SourceFile, typeChecker?: TypeChecker): TransformResult {
  // ... existing code ...
  for (let i = 0; i < 10; i++) {
    const cr = transformConstructorReplacements(file)
    const w = transformWrappers(file)
    const c = transformChecks(file)
    const m = transformMethods(file, typeChecker)
    // ... rest unchanged ...
  }
  // ... rest unchanged ...
}
```

Update `transformCode` to accept an optional `Project` and extract the type checker from it:

```typescript
export function transformCode(
  code: string,
  options?: { filename?: string; project?: Project }
): { code: string; changed: boolean } {
  try {
    const project = options?.project ?? new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: false },
    })
    const filename = options?.filename ?? 'transform.ts'
    const file = project.createSourceFile(filename, code, { overwrite: true })

    // If using a real project (not in-memory), we have a type checker
    const typeChecker = options?.project
      ? project.getTypeChecker()
      : undefined

    const result = transformFile(file, typeChecker)
    const transformed = file.getFullText()

    // Clean up the source file from the project if we're reusing it
    if (options?.project) {
      project.removeSourceFile(file)
    }

    return {
      code: transformed,
      changed: result.totalChanges > 0,
    }
  } catch (err) {
    const filename = options?.filename ?? 'unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[zod-to-mini] Transform failed for ${filename}: ${message.slice(0, 120)}`)
    return { code, changed: false }
  }
}
```

Also update the `TypeChecker` import at the top of the file:

```typescript
import { Project, type SourceFile, SyntaxKind, type CallExpression, type PropertyAccessExpression, type TypeChecker } from 'ts-morph'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jshebert/Development/plfx/zodvex/packages/zod-to-mini && bunx vitest run src/transforms.test.ts`

Expected: All tests pass. The new tests verify that without a type checker, `codec.pick()` is NOT transformed (because `codec` doesn't match `isLikelySchemaExpr`), while `z.object(...).pick()` IS transformed (because `z.object(` matches).

- [ ] **Step 6: Run the full zodvex test suite**

Run: `bun run --cwd packages/zodvex test`

Expected: Existing tests may break where `schema.partial()` or `insertSchema.extend()` are no longer transformed because the receiver doesn't match `isLikelySchemaExpr`. This is expected — those will be fixed in Task 2 when the vite plugin provides a type checker.

Note the failing test count and file names for Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/zod-to-mini/src/transforms.ts packages/zod-to-mini/src/transforms.test.ts
git commit -m "feat(zod-to-mini): add type-aware guards for ambiguous method transforms

Split TOP_LEVEL_METHODS into UNCONDITIONAL_TOP_LEVEL (pipe, brand) and
AMBIGUOUS_TOP_LEVEL (pick, extend, partial, omit, catchall). Ambiguous
methods use TypeChecker when available, falling back to isLikelySchemaExpr."
```

---

### Task 2: Wire type-aware Project into the vite plugin

**Files:**
- Modify: `packages/zod-to-mini/src/vite-plugin.ts`
- Modify: `packages/zod-to-mini/src/vite-plugin.test.ts`
- Modify: `packages/zodvex/__tests__/codec.test.ts` (remove workaround)

The vite plugin creates a persistent `Project` with the workspace tsconfig. This Project is reused across all file transforms, giving each transform access to the type checker. The `codec['pick']` workaround is removed since type checking now correctly identifies `ConvexCodec.pick()` as non-Zod.

- [ ] **Step 1: Update the vite plugin to create a persistent Project**

Replace `packages/zod-to-mini/src/vite-plugin.ts` with:

```typescript
import { Project } from 'ts-morph'
import type { Plugin } from 'vite'
import { transformCode } from './transforms'

export interface ZodToMiniPluginOptions {
  /** Only transform files matching this pattern. Default: all .ts/.tsx/.js/.jsx files */
  include?: RegExp
  /** Skip files matching this pattern. Default: none */
  exclude?: RegExp
  /** Path to tsconfig.json for type-aware transforms. When provided, ambiguous methods
   *  (pick, extend, partial, omit, catchall) are only transformed when the receiver is
   *  confirmed to be a Zod schema via the TypeScript type checker. Without this, falls
   *  back to a syntactic heuristic (isLikelySchemaExpr). */
  tsconfig?: string
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
  let project: Project | undefined

  return {
    name: 'zod-to-mini',
    enforce: 'pre',

    buildStart() {
      if (options?.tsconfig) {
        project = new Project({
          tsConfigFilePath: options.tsconfig,
          skipAddingFilesFromTsConfig: true,
        })
      }
    },

    transform(code, id) {
      // Only process JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return

      // Apply include/exclude filters
      if (options?.include && !options.include.test(id)) return
      if (options?.exclude && options.exclude.test(id)) return

      // Only transform files that import from 'zod' (not 'zod/mini' or 'zod/v4/core').
      if (!code.includes("'zod'") && !code.includes('"zod"') && !code.includes('z.Zod')) return

      const result = transformCode(code, {
        filename: id,
        project: project,
      })

      if (!result.changed) return

      return { code: result.code, map: null }
    },
  }
}
```

- [ ] **Step 2: Update vitest.config.ts to pass tsconfig**

In `packages/zodvex/vitest.config.ts`, update the plugin call:

```typescript
import { defineConfig } from 'vitest/config'
import { zodToMiniPlugin } from '../zod-to-mini/src/vite-plugin'
import { resolve } from 'path'

export default defineConfig({
  test: {
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
        plugins: [zodToMiniPlugin({
          tsconfig: resolve(__dirname, 'tsconfig.json'),
        })],
        resolve: {
          alias: [
            { find: /^zod$/, replacement: 'zod/mini' },
          ],
        },
      },
    ],
  },
})
```

Note: the tsconfig at `packages/zodvex/tsconfig.json` has `"include": ["src/**/*.ts"]` and excludes `**/*.test.ts`. However, the ts-morph Project is created with `skipAddingFilesFromTsConfig: true` — it only uses the tsconfig for compiler options and path resolution. Test files are added on-the-fly via `createSourceFile()`, and the type checker resolves their imports through the tsconfig paths.

- [ ] **Step 3: Remove the codec.pick() workaround**

In `packages/zodvex/__tests__/codec.test.ts`, replace:

```typescript
    const codec = convexCodec(schema)
    // Use bracket access to avoid zod-to-mini transform matching .pick() as a Zod method
    const pickFn = codec['pick'] as typeof codec.pick
    const pickedCodec = pickFn({ name: true, email: true })
```

With:

```typescript
    const codec = convexCodec(schema)
    const pickedCodec = codec.pick({ name: true, email: true })
```

- [ ] **Step 4: Run the full test suite**

Run: `bun run --cwd packages/zodvex test`

Expected: 1746/1746 pass. The type checker correctly identifies:
- `codec.pick(...)` → NOT a Zod schema → not transformed ✓
- `schema.partial()` → IS a Zod schema → transformed ✓
- `insertSchema.extend(...)` → IS a Zod schema → transformed ✓
- `UserModel.schema.doc.partial()` → IS a Zod schema → transformed ✓

If any tests fail, investigate whether the type checker is resolving imports correctly. Common issues: tsconfig paths not matching, `zod` not resolvable from the project root.

- [ ] **Step 5: Update vite-plugin tests**

Update `packages/zod-to-mini/src/vite-plugin.test.ts` to test the `tsconfig` option. Add:

```typescript
  it('accepts tsconfig option', () => {
    const plugin = zodToMiniPlugin({ tsconfig: '/fake/tsconfig.json' })
    expect(plugin.name).toBe('zod-to-mini')
    // The Project is created in buildStart, not in the constructor
    // so this just verifies the option is accepted
  })
```

- [ ] **Step 6: Commit**

```bash
git add packages/zod-to-mini/src/vite-plugin.ts packages/zod-to-mini/src/vite-plugin.test.ts packages/zodvex/vitest.config.ts packages/zodvex/__tests__/codec.test.ts
git commit -m "feat(zod-to-mini): wire type-aware Project into vite plugin

Create persistent ts-morph Project with tsconfig in buildStart().
Ambiguous methods (pick, extend, partial, omit, catchall) now use the
TypeScript type checker to confirm the receiver is a Zod schema.

Remove codec['pick'] bracket-access workaround — no longer needed."
```

---

### Task 3: Performance benchmark

**Files:**
- Create: `packages/zod-to-mini/src/perf.test.ts`

Benchmark the transform with and without type checking by transforming the task-manager example project files. This measures real-world overhead to determine if type-aware transforms are viable as the default.

- [ ] **Step 1: Create the benchmark test**

Create `packages/zod-to-mini/src/perf.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { transformCode } from './transforms'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const TASK_MANAGER_DIR = resolve(__dirname, '../../../examples/task-manager')
const ZODVEX_TESTS_DIR = resolve(__dirname, '../../../packages/zodvex/__tests__')

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === 'node_modules' || entry === '_generated' || entry === '_zodvex') continue
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full))
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('transform performance', () => {
  it('benchmarks task-manager without type checker', () => {
    const files = collectTsFiles(join(TASK_MANAGER_DIR, 'convex'))
    expect(files.length).toBeGreaterThan(0)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] task-manager (no types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks task-manager WITH type checker', () => {
    const tsconfig = join(TASK_MANAGER_DIR, 'tsconfig.json')
    const project = new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: true,
    })

    const files = collectTsFiles(join(TASK_MANAGER_DIR, 'convex'))

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file, project })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] task-manager (with types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks zodvex test suite without type checker', () => {
    const files = collectTsFiles(ZODVEX_TESTS_DIR)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] zodvex tests (no types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks zodvex test suite WITH type checker', () => {
    const tsconfig = resolve(__dirname, '../../../packages/zodvex/tsconfig.json')
    const project = new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: true,
    })

    const files = collectTsFiles(ZODVEX_TESTS_DIR)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file, project })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] zodvex tests (with types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })
})
```

- [ ] **Step 2: Run the benchmark**

Run: `cd /Users/jshebert/Development/plfx/zodvex/packages/zod-to-mini && bunx vitest run src/perf.test.ts`

Record the output. Expected format:
```
[perf] task-manager (no types): 25 files, N changed, Xms (X.Xms/file)
[perf] task-manager (with types): 25 files, N changed, Yms (Y.Yms/file)
[perf] zodvex tests (no types): 55 files, N changed, Xms (X.Xms/file)
[perf] zodvex tests (with types): 55 files, N changed, Yms (Y.Yms/file)
```

This gives us per-file overhead with and without type checking on two real projects.

- [ ] **Step 3: Also time the full vitest run**

Run both vitest projects and record wall-clock times:

```bash
time bun run --cwd packages/zodvex test -- --project zod
time bun run --cwd packages/zodvex test -- --project zod-mini
```

Compare with the pre-type-checker baseline:
- Current zod: ~6.5s
- Current zod-mini (no types): ~7.7s (1.2s plugin overhead)

- [ ] **Step 4: Commit**

```bash
git add packages/zod-to-mini/src/perf.test.ts
git commit -m "test(zod-to-mini): add perf benchmark for type-aware transforms"
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Type check method | `_zod` property on receiver type | Universal on all Zod schemas (both full and mini). No need to resolve `$ZodType` inheritance. |
| Which methods get type guard | `pick`, `extend`, `partial`, `omit`, `catchall` only | These have known collisions (ConvexCodec.pick, Lodash.extend). `pipe`, `brand` are unique enough to transform unconditionally. |
| Fallback without type checker | `isLikelySchemaExpr` heuristic | CLI and unit tests don't need a full Project. The heuristic is conservative (false negatives are fine, false positives are not). |
| Project lifecycle | Created once in `buildStart`, reused across transforms | Amortizes the cost of creating the TypeScript program. Source files are added/removed per transform. |
| tsconfig parameter | Opt-in via `ZodToMiniPluginOptions.tsconfig` | Not all consumers will have a tsconfig. Without it, falls back to syntactic transforms. |

## Risks

1. **Type resolution may not work for test files.** The zodvex tsconfig has `"include": ["src/**/*.ts"]` and excludes test files. ts-morph's `createSourceFile` adds files to the Project regardless of tsconfig includes, but import resolution still depends on the tsconfig's `paths` and `moduleResolution`. If `import { z } from 'zod'` can't be resolved, the type checker won't know `z.string()` returns a Zod schema, and `isZodSchemaByType` will return `false`. The test in Task 2 Step 4 will surface this — if it fails, the tsconfig may need adjustment or the Project may need additional source files.

2. **Performance may be worse than expected.** Type checking involves loading and analyzing the full dependency graph. Even with `skipAddingFilesFromTsConfig`, resolving `import { z } from 'zod'` requires loading zod's type declarations. This is a one-time cost (cached in the Project), but the first file transform will be slower. The benchmark in Task 3 quantifies this.

3. **ts-morph Project state management.** Adding and removing source files from a shared Project must be done carefully. If `removeSourceFile` is not called after each transform, stale files could interfere with type resolution. The try/catch in `transformCode` handles cleanup on error.
