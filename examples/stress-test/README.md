# Zodvex benchmarks

Use the [model graph memory benchmark](memory/README.md) to measure retained heap
in local Convex and probe hosted query OOM at a specified model shape. Use the
[codec workload benchmark](capacity/README.md) to compare document processing
overhead, database bytes read, and server execution time.

Both compare native Convex, convex-helpers/Zod 4, Zodvex, and Mini. Their separate
measurements distinguish the memory cost of a schema graph from the cost of
processing documents. Neither establishes a universal table capacity.

For ongoing work, use the [before/after comparison protocol](memory/comparison.md).
For support, the [local schema diagnostic](memory/customer-diagnostic.md) produces
an aggregate report from a developer's schema without deploying or uploading it.
The [retrospective](results/retrospective-2026-09-09/README.md) measures previous
improvements and tests report-only support with Hotpot. The
[public guide](../../docs/guide/memory-benchmarks.md) indexes the evidence and
explains how to compare it over time.

The [historical experiment status](../../docs/guide/memory-experiments.md) adds
bounded consumer import tests for descriptors and dynamic imports, plus a
compile-away correctness audit. **These are incomplete experiments, not
production alternatives.** Read their compatibility and runtime warnings before
interpreting memory savings.

## Running the benchmarks

Install the repository's frozen dependencies and build Zodvex from the repository
root first:

```bash
bun install --frozen-lockfile
bun run build
cd examples/stress-test

# Offline correctness checks, also included in the root local validation gate.
bun run typecheck
bun run test

# Bounded hosted experiments; each guide explains setup, scope, and output.
bun run memory --help
bun run capacity --help
```

The memory guide includes the local Convex retained-byte measurement setup. Hosted
memory probes require an explicit dedicated development deployment and do not push
an app or read database documents. The workload runner uses the `_deploy/` scaffold,
pushes one fixed app to an explicitly named dedicated development deployment, and
seeds synthetic rows. Follow each guide's setup before running an experiment.

Benchmark runs remain separate from `bun run validate:network`, which deploys and
smoke-tests the example apps. Default benchmark output goes under the gitignored
`results/local/`; deliberately promote evidence into `results/` when recording a
finding.

## Dedicated development deployment

For hosted experiments, use a dedicated benchmark project with your existing
Convex CLI login. From `examples/stress-test`, provision its development deployment
once:

```bash
cd _deploy
bunx convex dev --once --configure new
```

This writes the gitignored `_deploy/.env.local`. Both hosted runners require the
development slug explicitly as `--deployment=<slug>`; follow the individual
benchmark guide for the complete invocation. The workload benchmark replaces this
deployment's functions and schema with its fixed app.

## Coverage after retiring the table-count harness

The old `bench`, `regression`, and `sweep` commands, their seed composer, Node heap
proxy, and harness-specific tests were retired on 2026-09-09. Their generated
table-count sweeps mixed deployment analysis, push limits, and query runtime.
Recorded results remain in [`results/`](results/README.md); the implementation is
available in Git history.

Both task-manager example smoke tests continue to exercise codec-aware writes,
reads, and encoded returns against Convex. The workload benchmark additionally
checks decoded Date/custom-codec values and exact returned documents during real
query execution, including the runtime path that previously exposed unsupported
dynamic imports.

The exploratory sweep's hosted scheduler Date-argument probe was retired with the
harness. Scheduler codec encoding remains covered by the library's
[`init.test.ts`](../../packages/zodvex/__tests__/init.test.ts) and
[`action-ctx.test.ts`](../../packages/zodvex/__tests__/action-ctx.test.ts) tests.
The memory and workload benchmarks do not claim hosted scheduler coverage.

## Zod dependency baseline

`schemaBaseline.mjs` remains a separate historical experiment comparing exact Zod
4.3.6 and 4.5.4 schema construction and retained heap in fresh Node processes. It
makes no deployment calls. See the
[reproduction instructions and limitations](../../docs/planning/zod-4.5-baseline.md).
The output is a local diagnostic proxy, not a Convex capacity estimate.
