# Stress Test Harness

Start with the [codec workload benchmark](capacity/README.md) for a bounded,
repeatable comparison of native Convex, convex-helpers/Zod 4, Zodvex and Mini.
It measures real codec operations in documents, bytes and server execution time,
using one fixed application deployment.

The older table-count sweeps below remain diagnostic tools for specific generated
application shapes. Their results do not establish universal table capacity,
measured isolate heap usage, or parity with native Convex. Repeated deployment and
schema-analysis outcomes must be distinguished from runtime query behavior.

## Quick Start

```bash
# Build zodvex first (harness imports from built dist)
cd ../.. && bun run build && cd examples/stress-test

# Single-N regression gate (used by `bun run validate:network` at the repo root).
# Defaults: N=100 in the explicit shape — the level and shape zodvex main
# passes. Thin-schema feature branches raise their own gate, e.g.
# `--target=600 --shape=consolidated`.
bun run regression -- --flavors=zodvex,zodvex-mini

# Full ceiling sweep across all flavors and N values
bun run sweep -- --ns=200,400,500,600,700,750,800 --continue

# Bench a single flavor at a single N (heap proxy + per-endpoint bundle KB)
bun run bench -- --flavor=zodvex --count=200
```

## Setup: the harness's own deployment

Real-deploy steps (`regression`, `sweep`) push to the deployment pinned in
`_deploy/.env.local` — a gitignored, per-developer file. **The harness resets
(wipes) whatever deployment it targets**, so an ambient `CONVEX_DEPLOYMENT`
env var is deliberately refused; only the pinned file (or an explicit
`deployment` option) is used.

One-time provisioning:

```bash
cd _deploy && bunx convex dev --once --configure new   # writes _deploy/.env.local
```

Use a dedicated project (e.g. `zodvex-stress-test`) — never point this at a
deployment you care about. Convex deletes inactive dev deployments; if a
deploy fails with `DeploymentNotFound`, re-run the command above. Afterwards
check `git status`: `--configure` can regenerate tsconfig files to the stock
template.

## How It Works

1. **Seeds** (`seeds/<flavor>/`) — hand-written models and endpoints
   per flavor (zodvex, convex, convex-helpers). Two flavors derive at
   compose time instead of duplicating a corpus: zodvex-mini from the
   zodvex seeds via the zod-to-mini codemod, and convex-helpers-zod3
   from the convex-helpers seeds via import rewrites (zod → zod/v3,
   server/zod4 → server/zod3).
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
   the 5 flavors with expected outcomes. The repo-root `validate:network`
   runs it for the zodvex flavors only, at `--target=100
   --shape=explicit` — a deploy-parity gate at main's known-good
   level, not a ceiling search.
7. **Sweep** (`sweep.ts`) — full flavor × N grid for ceiling
   discovery. Each cell does `resetDeployment()` first so the
   `finish_push` diff is "0 → N" (the true fresh-diff ceiling). The
   first N per flavor runs a runtime smoke check.

## Flags

### regression / sweep
| Flag | Description |
|------|-------------|
| `--target=N` (regression) | Endpoints per flavor (default 100) |
| `--ns=200,400,500,...` (sweep) | Comma-separated N values |
| `--flavors=zodvex,zodvex-mini` | Subset of flavors to run |
| `--shape=explicit\|consolidated\|harness` | zodvex consumer shape (default `explicit`, the main-compatible shape) |
| `--continue` (sweep) | Don't skip a flavor after its first failure |
| `--out=path` | Write JSON results to this path |

### bench
| Flag | Description |
|------|-------------|
| `--flavor=zodvex` | Which flavor to compose (zodvex / zodvex-mini / convex / convex-helpers / convex-helpers-zod3) |
| `--count=200` | Endpoints to compose |
| `--lazy-tables` | Use the codegen-emitted `_zodvex/tables.ts` shape |
| `--keep` | Don't delete `tmp/<flavor>/composed/` after measure |

## Results

Authoritative ceiling snapshots live in `results/`. See
[`results/README.md`](results/README.md) for an index. Journey-of-the-PR
snapshots (early registry experiments, deploy-only sweeps,
spike-validation notes) live in `results/archive/`.

## Zod dependency baseline (local only)

`schemaBaseline.mjs` compares exact Zod 4.3.6 and 4.5.4 schema construction and
retained heap in fresh Node processes. It makes no deployment calls. See the
[reproduction instructions and limitations](../../docs/planning/zod-4.5-baseline.md).
The raw output is a local diagnostic proxy, not a Convex capacity estimate.
