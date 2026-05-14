# Stress Test Harness

Measures zodvex memory footprint at scale and validates the runtime
codepath on real Convex deploys. Backs the "zodvex matches pure-Convex
deploy headroom" claim.

## Quick Start

```bash
# Build zodvex first (harness imports from built dist)
cd ../.. && bun run build && cd examples/stress-test

# Single-N regression gate (used by `bun run validate` at the repo root)
bun run regression -- --target=600 --flavors=zodvex,zodvex-mini

# Full ceiling sweep across all flavors and N values
bun run sweep -- --ns=200,400,500,600,700,750,800 --continue

# Bench a single flavor at a single N (heap proxy + per-endpoint bundle KB)
bun run bench -- --flavor=zodvex --count=200
```

## How It Works

1. **Seeds** (`seeds/<flavor>/`) — hand-written models and endpoints
   per flavor (zodvex, convex, convex-helpers, convex-helpers-zod3).
   The zodvex seeds are reused for zodvex-mini via the zod-to-mini
   codemod at compose time.
2. **Composer** (`compose.ts`) — scales seeds to N models +
   endpoints per flavor via file copy with table-name + symbol
   replacement. Outputs to `tmp/<flavor>/composed/`.
3. **Bundler** (`bundle.ts`) — esbuild per entrypoint, config copied
   from Convex's `innerEsbuild`. Used by `bench.ts` for the heap
   proxy.
4. **Bench** (`bench.ts`) — compose → bundle → measure (node
   `--max-old-space-size=64`) → distribution. Heap proxy only; not a
   real Convex deploy.
5. **Real deploy** (`realDeploy.ts`) — pushes a composed tree to a
   configured Convex dev instance via `bunx convex dev --once`.
   Optionally fires a `bunx convex run` smoke call after deploy to
   verify Q/M handlers actually run at runtime (catches the
   dynamic-import-unsupported regression class).
6. **Regression** (`regression.ts`) — fixed-N pass/fail run across
   the 5 flavors with expected outcomes. Used by `validate`.
7. **Sweep** (`sweep.ts`) — full flavor × N grid for ceiling
   discovery. Each cell does `resetDeployment()` first so the
   `finish_push` diff is "0 → N" (the true fresh-diff ceiling). The
   first N per flavor runs a runtime smoke check.

## Flags

### regression / sweep
| Flag | Description |
|------|-------------|
| `--target=N` (regression) | Endpoints per flavor (default 600) |
| `--ns=200,400,500,...` (sweep) | Comma-separated N values |
| `--flavors=zodvex,zodvex-mini` | Subset of flavors to run |
| `--continue` (sweep) | Don't skip a flavor after its first failure |
| `--out=path` | Write JSON results to this path |

### bench
| Flag | Description |
|------|-------------|
| `--flavor=zodvex` | Which flavor to compose (zodvex / zodvex-mini / convex / convex-helpers / convex-helpers-zod3) |
| `--count=200` | Endpoints to compose |
| `--lazyTables` | Use the codegen-emitted `_zodvex/tables.ts` shape |
| `--keep` | Don't delete `tmp/<flavor>/composed/` after measure |

## Results

Authoritative ceiling snapshots live in `results/`. See
[`results/README.md`](results/README.md) for an index. Journey-of-the-PR
snapshots (early registry experiments, deploy-only sweeps,
spike-validation notes) live in `results/archive/`.
