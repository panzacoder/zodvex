# Codec workload baseline — 2026-09-09

For the primary model graph memory/headroom question, see the separate
[retained-heap and query OOM benchmark](../memory-2026-09-09/README.md).

Use a named operation as the benchmark: **indexed read → decode → domain work →
encode the full return value**. Its useful units are documents, serialized bytes,
and server execution time. Imported schema graphs are a separate controlled input.
A table count does not describe schema complexity, codec work, or per-query data
volume, and a successful push does not establish runtime memory headroom.

The [methodology](../../capacity/README.md) and runner are in this PR. The default
now tests 1/64/256 rows with one deployment push. Its observed total duration was
**27.2 seconds**, with **176 sample calls and 15.8 MiB of query reads**. Reference
reads, seeding, driver execution and logging are additional work; these numbers are
not a complete billing estimate. Large capacity checks are optional.

## What we observed

All runs used Convex 1.32.0, convex-helpers 0.1.113, Zod 4.5.4, and the library tree
at `ad4a23241b7a351e2406fe555283f9e81591139a`. Its package version is still 0.7.10;
this is a build from repository main, not a claim about the published 0.7.10 package.
Runs used the same dedicated development deployment, `lovable-donkey-430`, in the
`panzacoder/zodvex-stress-harness` project. Hosted backend revision, machine placement
and true cold/warm isolate state are not observed.

| Run | Payload field bytes | Batch sizes | Rounds | Calls | Seconds including setup | Query read MiB | Outcome |
|---|---:|---|---:|---:|---:|---:|---|
| [Routine](capacity-default-final.md) | 640 | 1, 64, 256 | 7 | 176 | 27.2 | 15.8 | Every call correct |
| [Extended](capacity-baseline-01.md) | 640 | 1, 64, 256, 1024, 4096 | 7 | 288 | 91.6 | 268.1 | Every call correct |
| [Different order / larger batch](capacity-baseline-02.md) | 640 | 64, 256, 8192 | 7 | 176 | 108.9 | 419.9 | Every call correct |
| [Read-limit control](capacity-read-limit.md) | 2048 | 64, 8192 | 3 | 56 | 40.9 | 397.3 | 64 passes; 8192 hits read limit in every variant |

All 696 calls have uncached, correlated query Completion records. There were 672
verified outputs and 24 attributable query read-limit failures, with no correctness,
collector or unknown-source failures. All three attempts in every large-payload
8,192-row cell failed with the same read-limit classification. This agrees with
Convex's documented [transaction limits](https://docs.convex.dev/production/state/limits#transactions).

Median **query server milliseconds at 256 rows**, excluding the driver verifier and
client transport (seven samples per cell):

| Implementation | Routine | Extended | Different order |
|---|---:|---:|---:|
| Native manual codec conversions | 45.5 | 43.6 | 46.6 |
| Helpers, explicit modeled DB parsing and return codecs | 58.2 | 60.5 | 62.3 |
| Zodvex, one imported model | 67.9 | 72.9 | 66.5 |
| Zodvex, 32 imported models | 77.2 | 79.2 | 80.6 |
| Zodvex, 32 models + 128 registry entries | 82.2 | 85.5 | 82.2 |
| Mini, one imported model | 58.2 | 65.1 | 63.0 |
| Mini, 32 imported models | 71.5 | 80.4 | 70.6 |
| Mini, 32 models + 128 registry entries | 75.8 | 82.3 | 74.9 |

The native control performs the same domain transformations and returns correct wire
values, but omits full modeled Zod validation. Helpers is the closer validation
comparison. Every profile uses only one model; the others are imported but unused.
The 128 registry entries are schemas in the current eager registry shape, not 128
registered endpoints. Bundled graphs are audited for accidental cross-profile imports
and dead-code elimination of these background schemas.

Extra imported schemas have a visible execution cost in this fixture, even when the
query touches one table. Mini lowers some observations, but its advantage varies by
cell and run. The recorded IQRs and paired ratios should accompany any comparison;
seven samples do not justify p95 claims or a precise universal overhead percentage.

## Capacity conclusions and goals

The 640-byte-payload workload completes through 8,192 rows for every implementation.
With larger payloads, all encounter a native read limit at the tested large batch.
There is **no observed Zodvex-only failure in these configurations**. This establishes
bounded workload results, not a maximum table count or parity for arbitrary apps.

In particular, this benchmark does **not** quantify how much of the isolate heap the
unused graph occupies or locate a schema-graph OOM boundary. The 1/32 model and 0/128
registry points measure sensitivity, not calibrated memory units or representative
consumer sizes. The read-limit control cannot expose a later memory ceiling.
`memoryUsedMb` is a configured allowance, not measured heap. We should not convert
bundle bytes, table counts, or allocation blocks into a claimed memory budget.

For release work, use these initial goals:

- All completed workloads produce the exact expected wire result and preserve IDs.
- No new Zodvex-specific failures in the named batches where controls still succeed.
- Compare execution medians and spread at fixed workloads/graphs. Investigate a
  repeatable regression; establish a numerical timing gate only after collecting
  enough runs across time to distinguish ordinary platform variation.
- Evaluate a proposed graph optimization against the same operation and oracle.
  Add a bounded consumer-derived graph or codec case when it answers a specific
  remaining question, rather than restarting broad deploy-until-OOM sweeps.

Dynamic imports in actions remain a separate mechanism experiment. These query runs
do not test dynamic imports, writes, concurrency, encryption, or Hotpot itself.

## Evidence and reproduction

[summary.json](summary.json) holds machine-readable configuration, validity, resource
counts and statistics. [evidence.tar.gz](evidence.tar.gz), checked by
[SHA256SUMS](SHA256SUMS), contains original manifests, raw calls/completions, full
observations, graph metadata, identity references, logs and exact generated fixture
sources for all four runs. No credentials or environment files are included.

The first two runs preceded the reference-pagination/reporting fixes. All their
measured query sources are identical to the final fixture; only the untimed driver
changed. Their raw manifests retain the original dirty-worktree state and fixture
hashes. The linked reports were rendered from saved observations and all runs were
reassessed with the final validity rules. Original reports remain in the archive.
The final routine run used committed harness source `dc0179e` and a clean tree at
startup. Later commits add evidence and report formatting only.

From `examples/stress-test`, with dependencies installed and the library built:

```sh
bun run capacity --deployment=<dedicated-dev>
bun run capacity --deployment=<dedicated-dev> --batches=64,256,8192 --seed=137
bun run capacity --deployment=<dedicated-dev> --rounds=3 --batches=64,8192 --payload-bytes=2048 --seed=73
```
