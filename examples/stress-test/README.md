# Stress Test Harness

Measures zodvex memory footprint at scale to find the OOM ceiling on Convex's 64 MB V8 isolate.

## Quick Start

```bash
# Build zodvex first (harness imports from built dist)
cd ../.. && bun run build && cd examples/stress-test

# Find OOM ceiling for all 4 variants (zod, zod+slim, mini, mini+slim)
bun run stress-test

# Find ceiling for a specific variant
bun run stress-test -- --slim --mini

# Single measurement at a specific count (for debugging)
bun run stress-test -- --count=200 --slim
```

## How It Works

1. **Seeds** (`seeds/`) — hand-written zodvex models and endpoints covering small/medium/large complexity
2. **Composer** (`compose.ts`) — scales seeds to N models via file copy + table name replacement
3. **Compiler** — runs zod-to-mini on composed output for the mini variant
4. **Measurer** (`measure.ts`) — black-box: imports a directory, reports V8 heap delta
5. **Runner** (`stress-test.ts`) — orchestrates ceiling search across all variants

## Flags

| Flag | Description |
|------|-------------|
| `--count=N` | Single measurement at N endpoints (skips ceiling search) |
| `--slim` | Enable `{ schemaHelpers: false }` via ZODVEX_SLIM env var |
| `--mini` | Compile zod → zod/mini before measuring |
| `--budget=N` | MB budget for ceiling search (default: 64) |

## Architecture

Seeds are real zodvex code — not templates. When the library API changes, the seeds may need updating, but the measurement harness (compose/measure/runner) stays stable.

The `ZODVEX_SLIM` env var controls whether seeds pass `{ schemaHelpers: false }` to `defineZodModel`. The compiler handles the zod → mini transform. All configuration is via flags to the runner.
