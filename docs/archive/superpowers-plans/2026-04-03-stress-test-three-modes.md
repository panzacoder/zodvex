# Stress Test Three-Mode Restructuring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the stress test to prove all three consumer paths produce correct and equivalent memory profiles, using genuine hand-written code for each variant (no regex pseudo-compilation).

**Architecture:** Templates are organized into `templates/zod/` (hand-written full zod) and `templates/mini/` (hand-written zod/mini). The generator selects templates by variant: `baseline` uses zod templates, `zod-mini` uses mini templates, `compiled` uses zod templates then runs the actual zod-to-mini compiler. The report shows three columns at every scale point.

**Tech Stack:** TypeScript, Bun, zod-to-mini compiler (`transformCode` + `transformImports`)

---

## Current State

- Templates live in `examples/stress-test/templates/` (full-zod only)
- `applyVariant()` in `generate.ts` uses regex to convert zod→mini (pseudo-compilation)
- Two variants measured: `baseline` and `zod-mini`
- Report covers 5 scales × 2 variants × 3 modes = 30 combinations

## Target State

- `templates/zod/` — existing templates, unchanged (hand-written full zod)
- `templates/mini/` — new, hand-written zod/mini equivalents
- Three variants: `baseline`, `compiled`, `zod-mini`
- `applyVariant()` regex transforms deleted
- `compiled` variant uses the real compiler from `packages/zod-to-mini`
- Report covers 5 scales × 3 variants × 3 modes = 45 combinations

---

### Task 1: Reorganize templates into zod/ and mini/ directories

**Files:**
- Move: `examples/stress-test/templates/*.ts.tmpl` → `examples/stress-test/templates/zod/`
- Create: `examples/stress-test/templates/mini/` with hand-written mini versions

- [ ] **Step 1: Create directory structure and move existing templates**

```bash
cd examples/stress-test
mkdir -p templates/zod templates/mini
mv templates/model-small.ts.tmpl templates/zod/
mv templates/model-medium.ts.tmpl templates/zod/
mv templates/model-large.ts.tmpl templates/zod/
mv templates/functions.ts.tmpl templates/zod/
mv templates/schema.ts.tmpl templates/zod/
mv templates/functions-bootstrap.ts.tmpl templates/zod/
```

- [ ] **Step 2: Create mini model-small template**

Create `examples/stress-test/templates/mini/model-small.ts.tmpl`:

```typescript
import { z } from 'zod/mini'
import { defineZodModel } from 'zodvex/mini'
import { zx } from 'zodvex/mini'

export const {{NAME}}Model = defineZodModel('{{TABLE}}', {
  title: z.string(),
  active: z.boolean(),
  count: z.number(),
  createdAt: zx.date(),
}).index('by_created', ['createdAt'])
```

- [ ] **Step 3: Create mini model-medium template**

Create `examples/stress-test/templates/mini/model-medium.ts.tmpl`:

```typescript
import { z } from 'zod/mini'
import { defineZodModel } from 'zodvex/mini'
import { zx } from 'zodvex/mini'

export const {{NAME}}Model = defineZodModel('{{TABLE}}', {
  title: z.string(),
  description: z.optional(z.string()),
  status: z.enum(['draft', 'active', 'review', 'archived']),
  priority: z.number(),
  ownerId: z.string(),
  tags: z.array(z.string()),
  metadata: z.optional(z.object({
    source: z.string(),
    version: z.number(),
  })),
  isPublic: z.optional(z.boolean()),
  score: z.nullable(z.number()),
  createdAt: zx.date(),
  updatedAt: z.optional(zx.date()),
})
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 4: Create mini model-large template**

Read the existing `templates/zod/model-large.ts.tmpl` first to understand the full schema structure, then write the mini equivalent. Key differences:

- `z.optional(x)` instead of `x.optional()`
- `z.nullable(x)` instead of `x.nullable()`
- `z.union([...])` instead of `z.discriminatedUnion('type', [...])`  
  (Note: Check if `z.discriminatedUnion()` exists in zod/mini — if it does, keep it)
- Import from `'zod/mini'` and `'zodvex/mini'`
- All `.check()` validators use functional form: `.check(z.minLength(n))` etc.

Create `examples/stress-test/templates/mini/model-large.ts.tmpl` with the hand-written mini version.

- [ ] **Step 5: Create mini functions template**

Create `examples/stress-test/templates/mini/functions.ts.tmpl`:

Same structure as zod version but with:
- `import { z } from 'zod/mini'`
- Any `.optional()` args → `z.optional()`

- [ ] **Step 6: Copy shared templates**

The `schema.ts.tmpl` and `functions-bootstrap.ts.tmpl` templates need mini versions too:

```bash
# schema.ts.tmpl — update imports for mini
# functions-bootstrap.ts.tmpl — update imports for mini
```

Create mini versions with `'zod/mini'` and `'zodvex/mini'` imports.

- [ ] **Step 7: Verify both template sets are syntactically correct**

Read through each mini template to verify it's valid zod/mini syntax. The mini templates should represent what a user would actually write — clean, idiomatic zod/mini.

- [ ] **Step 8: Commit**

```bash
git add examples/stress-test/templates/
git commit -m "refactor(stress-test): organize templates into zod/ and mini/ directories"
```

---

### Task 2: Update generator to use template directories and add compiled variant

**Files:**
- Modify: `examples/stress-test/generate.ts`
- Modify: `examples/stress-test/package.json` (add zod-to-mini dependency)

Replace `applyVariant()` regex transforms with directory-based template selection plus real compiler integration.

- [ ] **Step 1: Add zod-to-mini as a dependency**

In `examples/stress-test/package.json`, add:
```json
"dependencies": {
  "zod-to-mini": "workspace:*"
}
```

Run: `bun install`

- [ ] **Step 2: Update generate.ts template loading**

Replace the template loading logic to read from `templates/zod/` or `templates/mini/` based on variant:

```typescript
// Determine template directory
const templateDir = variant === 'zod-mini'
  ? join(__dirname, 'templates/mini')
  : join(__dirname, 'templates/zod')
```

Load all templates from the selected directory.

- [ ] **Step 3: Add compiler step for `compiled` variant**

For the `compiled` variant, after generating files from `templates/zod/`, run the compiler:

```typescript
import { transformCode, transformImports } from 'zod-to-mini'

if (variant === 'compiled') {
  // Run compiler on each generated file
  for (const filePath of generatedFiles) {
    const code = readFileSync(filePath, 'utf-8')
    
    // Apply all transforms (method chains → functional forms, class refs → core)
    const result = transformCode(code)
    let transformed = result.code
    
    // Transform imports: 'zod' → 'zod/mini'
    // Use ts-morph for precise import rewriting
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile('tmp.ts', transformed)
    transformImports(sf)
    // Also rewrite zodvex imports
    for (const imp of sf.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() === 'zodvex/core') {
        imp.setModuleSpecifier('zodvex/mini')
      }
    }
    transformed = sf.getFullText()
    
    writeFileSync(filePath, transformed)
  }
}
```

- [ ] **Step 4: Delete applyVariant() regex transforms**

Remove the entire `applyVariant()` function and its usage. The three variants are now:
- `baseline`: templates from `templates/zod/`, used as-is
- `compiled`: templates from `templates/zod/`, then compiler
- `zod-mini`: templates from `templates/mini/`, used as-is

- [ ] **Step 5: Update variant validation**

Update the variant type/validation to accept `'baseline' | 'compiled' | 'zod-mini'`.

- [ ] **Step 6: Test all three variants generate successfully**

```bash
cd examples/stress-test
bun run generate.ts --count=10 --mode=both --variant=baseline
bun run generate.ts --count=10 --mode=both --variant=compiled
bun run generate.ts --count=10 --mode=both --variant=zod-mini
```

Inspect the generated files in `convex/generated/` to verify:
- `baseline`: full zod method chains, imports from `'zod'`
- `compiled`: functional forms, imports from `'zod/mini'`
- `zod-mini`: functional forms, imports from `'zod/mini'`

The `compiled` output should look very similar to `zod-mini` — that's the proof.

- [ ] **Step 7: Commit**

```bash
git add examples/stress-test/
git commit -m "feat(stress-test): replace regex transforms with compiler + template directories"
```

---

### Task 3: Update report to include compiled variant

**Files:**
- Modify: `examples/stress-test/report.ts`

- [ ] **Step 1: Add compiled to VARIANTS**

```typescript
const VARIANTS = ['baseline', 'compiled', 'zod-mini'] as const
```

This automatically includes `compiled` in all 5 scales × 3 modes combinations (total: 45 measurements).

- [ ] **Step 2: Update report markdown generation**

The report should show three columns per scale/mode combination. Update the table headers:

```typescript
const header = `| Scale | Mode | Baseline Heap | Compiled Heap | Mini Heap | Compiled Savings | Mini Savings |`
```

- [ ] **Step 3: Run the full report**

```bash
cd examples/stress-test
bun run report.ts
```

This runs 45 measurement combinations. Expected output in `results/report.md`:
- Baseline: ~64MB at 200 endpoints (both mode)
- Compiled: ~32MB at 200 endpoints (should match mini)
- Mini: ~32MB at 200 endpoints

If compiled ≈ mini at all scales, the compiler is proven.

- [ ] **Step 4: Commit the report**

```bash
git add examples/stress-test/
git commit -m "feat(stress-test): three-mode report — baseline vs compiled vs zod-mini"
```

---

## Expected Results

| Scale | Mode | Baseline | Compiled | Mini | Compiler = Mini? |
|-------|------|----------|----------|------|-----------------|
| 50 | both | ~20 MB | ~11 MB | ~11 MB | ✅ |
| 100 | both | ~36 MB | ~19 MB | ~19 MB | ✅ |
| 150 | both | ~51 MB | ~27 MB | ~27 MB | ✅ |
| 200 | both | ~67 MB | ~34 MB | ~34 MB | ✅ |
| 250 | both | ~83 MB | ~42 MB | ~42 MB | ✅ |

The key proof: "Compiled" and "Mini" columns should be within ±5% at every scale.

## Risks

1. **Compiler may miss patterns in large templates.** The model-large template has discriminated unions, nested objects, and complex codecs. If the compiler doesn't handle all patterns, compiled output may not match mini. Fix: add missing transforms to the compiler.

2. **Import rewriting for zodvex.** The compiler handles `'zod'` → `'zod/mini'` but `'zodvex/core'` → `'zodvex/mini'` is zodvex-specific. The compiled variant needs to handle this explicitly.

3. **Performance of 45 measurements.** Adding a third variant increases the report from 30 to 45 combinations. At ~5s per measurement, the full report takes ~4 minutes. Acceptable for CI but noticeable during development.
