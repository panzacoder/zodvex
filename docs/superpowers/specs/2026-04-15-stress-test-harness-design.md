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
# Single measurement
bun run stress-test --count=200 --slim --mini

# Full matrix report
bun run stress-test --report --scales=50,100,150,200,250

# Convex deploy test (real OOM ceiling)
bun run stress-test --count=200 --deploy

# Find OOM ceiling via binary search
bun run stress-test --find-ceiling --slim --mini
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--count=N` | number | 50 | Number of models/endpoints |
| `--slim` | boolean | false | Pass `{ schemaHelpers: false }` to `defineZodModel` |
| `--mini` | boolean | false | Compile zod → zod/mini before measuring |
| `--deploy` | boolean | false | Deploy to Convex and measure real isolate |
| `--report` | boolean | false | Run full matrix across all flag combinations |
| `--scales=N,N,...` | number[] | 50,100,150,200,250 | Scale points for report/ceiling modes |
| `--find-ceiling` | boolean | false | Binary search for max endpoints under 64MB |
| `--budget=N` | number | 64 | MB budget for ceiling search |

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

For `--report` mode, iterates the full matrix:
```
for scale in scales:
  compose(scale)
  measure(composed, runtime=zod)                         → "zod"
  measure(composed, runtime=zod, env=ZODVEX_SLIM=1)      → "zod + slim"
  compile(composed → composed-mini)
  measure(composed-mini, runtime=mini)                    → "mini"
  measure(composed-mini, runtime=mini, env=ZODVEX_SLIM=1) → "mini + slim"
```

For `--deploy` mode, uses `npx convex deploy` instead of local heap measurement.

For `--find-ceiling` mode, binary searches for the max count under the budget.

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

```markdown
# Stress Test Report

**Date:** 2026-04-15
**Scales:** 50, 100, 150, 200, 250

## Local Heap Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| zod | 50 | 15.95 | 18.69 | 100 |
| zod + slim | 50 | 14.20 | 16.94 | 100 |
| mini | 50 | 8.05 | 10.80 | 100 |
| mini + slim | 50 | 7.10 | 9.85 | 100 |
| ... | ... | ... | ... | ... |

## OOM Ceilings (local, 64MB budget)

| Variant | Max Endpoints | Heap at Ceiling |
|---------|--------------|-----------------|
| zod | ~185 | 63.8 MB |
| zod + slim | ~205 | 63.9 MB |
| mini | ~360 | 63.4 MB |
| mini + slim | ~400 | 63.8 MB |
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
