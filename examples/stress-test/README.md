# Stress Test Harness

Measures memory footprint at scale to find the OOM ceiling on Convex's 64 MB V8 isolate, across four seed **flavors**:

- **`zodvex`** — zodvex models (`defineZodModel` + `zq`/`zm`), measured in four variants: `zod`, `zod + slim`, `mini`, `mini + slim`.
- **`convex-helpers`** — `convex-helpers/server/zod4` (`zCustomQuery`/`zCustomMutation` + `zodToConvexFields` + `zid`). What you'd get rolling your own zod4-for-convex layer today without zodvex.
- **`convex-helpers-zod3`** — `convex-helpers/server/zod3` (same API but Zod v3 instead of v4). Useful for comparing against projects that haven't migrated off Zod v3 yet.
- **`convex`** — pure Convex (`defineTable` + `v.*` + plain `query`/`mutation`). This is the **ideal baseline**: what Convex itself can fit in the 64 MB budget with zero zod/zodvex overhead.

The `convex` baseline tells you how much headroom zodvex is spending; `convex-helpers` (and the zod3 variant) tells you how much of that is inherent to zod validation vs. zodvex's own helpers.

## Quick Start

```bash
# Build zodvex first (harness imports from built dist)
cd ../.. && bun run build && cd examples/stress-test

# Find OOM ceiling for all variants (convex, convex-helpers/zod3, convex-helpers/zod4, + 4 zodvex)
bun run stress-test

# Only the convex baseline
bun run stress-test -- --convex

# Only convex-helpers/zod4
bun run stress-test -- --convex-helpers

# Only convex-helpers/zod3
bun run stress-test -- --convex-helpers-zod3

# Only a specific zodvex variant
bun run stress-test -- --slim --mini

# Single measurement at a specific count (for debugging)
bun run stress-test -- --count=200 --slim
bun run stress-test -- --count=1000 --convex
```

## How It Works

1. **Seeds** (`seeds/<flavor>/`) — hand-written models and endpoints covering small/medium/large complexity. All four flavors share the same 7 models (user, task, project, comment, document, activity, notification) with the same field shapes, so the only difference between variants is the library under test. Date fields use `v.number()`/`z.number()` since `convex-helpers`' zod3 and zod4 adapters both reject `z.date()`.
2. **Composer** (`compose.ts`) — scales seeds to N models via file copy + table/identifier rename. Emits a flavor-appropriate `schema.ts` (+ `functions.ts` for zodvex).
3. **Compiler** — runs zod-to-mini on composed output for the `mini` variant.
4. **Measurer** (`measure.ts`) — black-box: imports a directory, reports V8 heap delta. Pre-imports only the runtime libraries the flavor uses, so the baseline is fair.
5. **Runner** (`stress-test.ts`) — orchestrates ceiling search across all variants. The convex baseline probes up to 10 000 endpoints (coarser step) since its per-model cost is tiny.

## Flags

| Flag | Description |
|------|-------------|
| `--count=N` | Single measurement at N endpoints (skips ceiling search) |
| `--convex` | Use the pure-Convex baseline (no zod / no zodvex) |
| `--convex-helpers` | Use `convex-helpers/server/zod4` directly (no zodvex) |
| `--convex-helpers-zod3` | Use `convex-helpers/server/zod3` directly (Zod v3) |
| `--slim` | Enable `{ schemaHelpers: false }` via ZODVEX_SLIM env var |
| `--mini` | Compile zod → zod/mini before measuring |
| `--budget=N` | MB budget for ceiling search (default: 64) |

## Architecture

Seeds are real code, not templates. When either library's API changes, the seeds may need updating, but the measurement harness (compose/measure/runner) stays stable.

The `ZODVEX_SLIM` env var controls whether zodvex seeds pass `{ schemaHelpers: false }` to `defineZodModel`. The compiler handles the zod → mini transform. All configuration is via flags to the runner.
