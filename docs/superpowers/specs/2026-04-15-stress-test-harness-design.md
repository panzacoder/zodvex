# Stress Test Black-Box Harness

**Date:** 2026-04-15
**Branch:** `feat/pagination-helpers`
**Status:** Design

## Problem

The current stress test is tightly coupled to zodvex internals. Templates reference specific API shapes (`Model.schema.doc.nullable()` vs `Model.doc.nullable()`), the measurement script knows about variant types, and adding a new scenario (like slim models) requires modifying the test infrastructure itself. This makes measurements unreproducible — if you have to change the test to run it, the results aren't comparable to previous runs.

The stress test should be a stable black box: feed in a convex/zodvex project, get heap measurements out. The test infrastructure should not change when the library API changes.

## Solution

Replace the template-based synthetic generator with:

1. **Hand-written seed files** — real zodvex code covering small/medium/large complexity tiers
2. **A composer** that scales seeds to N models via file copy + table name replacement
3. **A compiler pass** (existing zod-to-mini) for the mini variant
4. **A black-box measurer** that imports any directory and reports heap
5. **A runner** with a uniform flag interface that orchestrates everything

## Design

### Public Interface

All configuration is via flags to the runner. The runner translates flags into the appropriate internal mechanism (env vars, compiler passes, file composition).

```bash
# Find OOM ceiling for all 4 variants (primary workflow)
# Produces ceiling table + report with every measurement point
bun run stress-test

# Find ceiling for a specific variant only
bun run stress-test --slim --mini

# Single ad-hoc measurement (for debugging)
bun run stress-test --count=200 --slim

# Find ceiling using real Convex deploy instead of local heap
bun run stress-test --deploy
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--count=N` | number | — | Ad-hoc: measure at exactly N endpoints (skips ceiling search) |
| `--slim` | boolean | false | Pass `{ schemaHelpers: false }` to `defineZodModel` |
| `--mini` | boolean | false | Compile zod → zod/mini before measuring |
| `--deploy` | boolean | false | Deploy to Convex and measure real isolate |
| `--budget=N` | number | 64 | MB budget for ceiling search |

When `--count` is omitted, the harness runs ceiling search for all applicable variants. If `--slim` or `--mini` is specified, only that variant is searched. If neither is specified, all 4 variants (zod, zod+slim, mini, mini+slim) are searched.

Every measurement taken during the search is recorded and included in the report — the coarse passes (50, 100, 150...) provide comparable data points across variants, and the fine-grained passes near each ceiling show the exact threshold.

### Internal Architecture

```
┌─────────────────────────────────────────────────┐
│ Runner (stress-test.ts)                         │
│ Parses flags, orchestrates pipeline             │
│                                                 │
│  flags → compose → [compile] → measure → report │
└────┬───────┬──────────┬────────────┬────────────┘
     │       │          │            │
     ▼       ▼          ▼            ▼
  Composer  Compiler   Measurer    Reporter
  (scale)  (zod→mini) (black box) (markdown)
```

**Composer** (`compose.ts`)

Input: count N, seed directory
Output: a composed `convex/` directory ready to measure

- Copies seed models round-robin up to N, replacing table names with unique variants (`tasks` → `tasks_042`, model export names `TaskModel` → `TaskModel042`)
- Generates `schema.ts` (import list + `defineZodSchema` call)
- Generates endpoint files referencing each composed model
- Generates `functions.ts` bootstrap

The only string replacement is table names, export names, and import paths. No API-level templating.

**Compiler** (existing `zod-to-mini` from `packages/zod-to-mini/`)

Runs on the composed directory to produce the mini variant. Transforms:
- `import { z } from 'zod'` → `import { z } from 'zod/mini'`
- `import { ... } from 'zodvex'` → `import { ... } from 'zodvex/mini'`
- `.optional()` → `z.optional(...)`, `.nullable()` → `z.nullable(...)`, etc.

Already exists and proven equivalent in memory profile to hand-written mini.

**Measurer** (`measure.ts` — simplified)

Input: directory path, runtime flag (zod or mini)
Output: JSON with heap stats

Black box. It:
1. Pre-imports base libraries (`zod` or `zod/mini`, `zodvex` or `zodvex/mini`)
2. Force GC, snapshot heap baseline
3. Imports `schema.ts` and all endpoint files from the directory
4. Force GC, snapshot heap after
5. Reports delta, peak, modules loaded/failed

Knows nothing about zodvex internals, models, slim, seeds, or variants. If an import fails, the measurement fails and that's a signal about the library code, not the test.

**Runner** (`stress-test.ts`)

Parses flags, runs the pipeline:

1. `compose(count)` — creates `convex/composed/` from seeds
2. If `--slim`: sets `ZODVEX_SLIM=1` in subprocess environment
3. If `--mini`: runs compiler on composed output → `convex/composed-mini/`
4. Invokes measurer in isolated subprocess (for heap isolation)
5. Collects and reports results

For ceiling search (the default mode), runs binary search per variant:
```
for variant in [zod, zod+slim, mini, mini+slim]:
  lo=50, hi=500
  coarse pass: step by 50, find where heap > budget
  fine pass: binary search between last-good and first-over
  every measurement recorded in results[]
```

Each measurement at a given count composes the project, optionally compiles, and measures in an isolated subprocess.

For `--deploy` mode, uses `npx convex deploy` (or `npx convex dev --once`) instead of local heap measurement. Deploy success = under ceiling, OOM error = over ceiling.

For `--count=N` mode (ad-hoc), skips the search and runs a single measurement at N.

### Seed Files

Located in `examples/stress-test/seeds/`:

```
seeds/
├── models/
│   ├── task.ts          (small — 4 fields)
│   ├── project.ts       (small — 5 fields)
│   ├── user.ts          (medium — 11 fields)
│   ├── document.ts      (medium — 10 fields)
│   ├── notification.ts  (medium — 9 fields)
│   ├── activity.ts      (large — 18 fields, discriminated union)
│   ├── report.ts        (large — 16 fields, nested objects)
│   └── ... (10-20 total)
├── endpoints/
│   ├── task.ts          (get, list, create, update, delete)
│   ├── project.ts
│   └── ... (matching each model)
└── functions.ts.seed    (bootstrap template — only file with any substitution)
```

Each seed model reads the `ZODVEX_SLIM` env var:

```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const taskFields = {
  title: z.string(),
  done: z.boolean(),
  priority: z.number(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const TaskModel = defineZodModel('tasks', taskFields, opts)
  .index('by_created', ['createdAt'])
```

Seeds are valid, runnable zodvex code. They can be imported directly for testing.

Endpoint seeds reference the model's API surface in a way that works for both slim and full:

```typescript
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { TaskModel, taskFields } from '../models/task'

// Use zx.doc() helper — works for both full and slim models
export const getTask = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(TaskModel).nullable(),
})

export const listTasks = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
  returns: zx.docArray(TaskModel),
})
```

By using `zx.doc(Model)` / `zx.docArray(Model)` instead of `Model.schema.doc` or `Model.doc`, the endpoints work identically for full and slim models. No conditional logic needed in endpoints.

### Convex Deploy Testing

The stress-test project is already a real Convex project. For `--deploy` mode:

1. Compose the project at the target scale
2. If `--mini`, compile
3. Run `npx convex deploy` (or `npx convex dev --once`)
4. If deploy succeeds → count is under the ceiling
5. If deploy fails with OOM → count is over the ceiling

This gives the real Convex isolate ceiling, including runtime overhead.

### Report Output

The ceiling search produces a single report with two sections:

```markdown
# Stress Test Report

**Date:** 2026-04-15
**Budget:** 64 MB

## OOM Ceilings

| Variant | Max Endpoints | Heap at Ceiling (MB) |
|---------|--------------|---------------------|
| zod | 185 | 63.85 |
| zod + slim | 205 | 63.90 |
| mini | 360 | 63.40 |
| mini + slim | 400 | 63.87 |

## All Measurements

Every data point collected during the binary search, sorted by variant then count.
Coarse-pass points (50, 100, 150...) overlap across variants for comparison.

| Variant | Count | Heap Delta (MB) | Peak (MB) |
|---------|-------|-----------------|-----------|
| zod | 50 | 15.95 | 18.69 |
| zod | 100 | 31.47 | 34.24 |
| zod | 150 | 46.65 | 49.41 |
| zod | 175 | 55.20 | 57.97 |
| zod | 188 | 65.06 | 67.83 |
| zod | 182 | 62.10 | 64.87 |
| zod | 185 | 63.85 | 66.62 |
| zod + slim | 50 | 14.20 | 16.94 |
| ... | ... | ... | ... |
```

## Scope

### In scope
- Seed files (10-20 hand-written models + endpoints)
- Composer (scale seeds to N)
- Simplified measurer (black-box, directory-agnostic)
- Runner with uniform flag interface
- Report generation
- Convex deploy mode (`--deploy`)
- OOM ceiling binary search (`--find-ceiling`)
- Slim toggle via `ZODVEX_SLIM` env var
- Mini variant via existing zod-to-mini compiler

### Out of scope
- Backwards compatibility with old result files
- The `compiled` variant (proven equivalent to mini — no longer needed as separate scenario)
- Per-schema property count analysis (diagnostic, can be a separate script)
- Convex-validator-only baseline (useful but separate from the main harness)

## Migration

1. Write new harness alongside existing stress-test code
2. Validate new harness produces comparable numbers to old harness at same scales
3. Remove old `generate.ts`, templates, `report.ts`, `find-ceiling.ts`
4. Old result files preserved in `results/legacy/` for reference
