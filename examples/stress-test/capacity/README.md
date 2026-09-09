# Codec workload benchmark

For model graph memory/headroom, start with the [memory benchmark](../memory/README.md).
This workload benchmark measures the separate cost of processing documents.

This benchmark measures the cost and bounded batch capacity of **one real operation**:
read ordered documents through an index, decode their codecs, use the runtime values,
transform them, and encode the complete result. It compares a fixed workload across
native Convex, convex-helpers/Zod 4, Zodvex and Zodvex Mini.

The units are **documents processed, serialized bytes, and server milliseconds**.
There is no allocation-block-to-MB conversion, table-count ceiling, or deploy-until-OOM
loop. A successful deployment is setup, not the performance result.

See the [2026-09-09 baseline and raw evidence](../results/capacity-2026-09-09/README.md)
for observed overhead, repeat runs and a shared read-limit control.

## Questions this answers

1. What additional execution cost does the codec pipeline impose at useful batch sizes?
2. Does loading unrelated model/function schemas change the cost of the same operation?
3. At the tested batch sizes, which implementations finish correctly, and which hit a
   named query memory, execution-time, read, or return-size limit?

This is a baseline for comparisons and regressions. It is not a universal maximum
number of tables, a production sizing calculator, or a measurement of peak heap bytes.

## Run

From `examples/stress-test`, after the repository's frozen dependency installation
and library build:

```sh
bun run capacity --deployment=<dedicated-development-deployment>
```

Use a dedicated benchmark Convex project with the normal CLI account login. The command
replaces that development deployment's functions/schema with the benchmark app and
seeds only its synthetic `benchmarkRows` table. It does not use a consumer app, create
deployments, or require a deploy key. The explicit deployment name is passed to
`convex run --push`; ambient deploy-key/self-hosted overrides are rejected.

The default is one push, 256 seeded rows, eight variants, three batch sizes
`1,64,256`, and seven interleaved rounds: 176 sample action calls, plus three
reference calls and setup. Each sample action invokes one measured query. Only a small
verification summary goes to the client, although the measured query returns all rows
inside Convex. The default measured queries read roughly 16 MiB in total for this
fixture, plus small initial/reference/setup costs. Larger batch checks are optional
because their repeated reads dominate consumption. There are no concurrent load generators. Sampling has a five-minute
budget, individual HTTP requests have a 20-second timeout, and setup has a separate
three-minute timeout. There is no automatic retry that hides a failing sample.

Useful variations:

```sh
# Small smoke/pilot; do not publish three samples as a precise percentile estimate.
bun run capacity --deployment=<dev> --rounds=3 --batches=1,64,256

# Repeat with a different recorded invocation order.
bun run capacity --deployment=<dev> --seed=137

# Explore larger batches without changing/uploading a larger application graph.
bun run capacity --deployment=<dev> --batches=256,1024,4096,8192
```

`--payload-bytes=640` controls the ASCII payload field, not the total document size.
Actual read/return bytes come from Convex telemetry. Inputs are capped at 8,192 rows,
2,048 payload bytes per row, and 512 sample calls. Each result directory is new;
existing output is never overwritten. The deployment retains the benchmark app and
synthetic data for inspection/repetition; it does not schedule background work.

## Operation and comparison contract

The same seeded rows contain strings, tags, nested checkpoint objects, timestamp↔Date
codecs, and a string↔`SecretText` codec. Optional timestamps cycle through absent, null,
and present. `SecretText` demonstrates runtime class values; **it is not encryption,
redaction, or a reproduction of Hotpot's SensitiveField implementation**.

Every query performs `.query('benchmarkRows').withIndex('by_seq').take(n)`. The common
domain function calls Date and SecretText methods, advances a timestamp, uppercases
the secret value, and computes a checksum over every row. Declared return validation
and encoding execute before the measured query completes. This is not a handler-only
timer, repeated parse loop, or a read-modify-write benchmark.

| Implementation | DB reads | Return handling | Contract difference |
|---|---|---|---|
| Native | Explicit manual codec conversion | Explicit manual encoding + Convex validator | Validates codec leaves, not the full modeled Zod schema |
| Helpers | Explicit full Zod document parsing | Reversed per-field codecs in helpers' forward return parser | Shows the extra integration required; not built-in codec DB wrapping |
| Zodvex | Normal codec-aware DB wrapper | Declared forward schemas, encoded by Zodvex | Full modeled schema handling |
| Mini | Same Zodvex contract using Mini | Same encoding contract | Different schema implementation/import graph |

All cases retain native Convex argument and return validation. Helpers uses reverse
return codecs because its declared returns are parsed forward; passing Zodvex's
forward codecs directly would produce the wrong wire contract. The native control
performs equivalent domain work and valid output, but does not promise equivalent
validation for every malformed value. No performance win may be claimed by silently
dropping the codec operation or the declared return schema.

The benchmark deliberately separates the actual operation from unused schema load:

| Profile | Models used | Models imported | Eager function-registry entries |
|---|---:|---:|---:|
| Native / helpers reference | 1 | 1 | 0 |
| Full / Mini lean | 1 | 1 | 0 |
| Full / Mini models | 1 | 32 | 0 |
| Full / Mini registry | 1 | 32 | 128 |

These are controlled sensitivity points, **not typical-app claims**. The deployment
always declares the same 32 native tables, of which only one contains data. There are
eight measured query functions. The 128 entries are a synthetic fixture of the current
eager registry shape, not 128 registered/used functions and not a codegen throughput
test. `defineZodModel` keeps its default schema-helper setting in all Zodvex profiles.

Each profile has a separate module graph. `graph.ts` uses Convex's installed esbuild
version and multi-entry code splitting to verify that native imports no Zod, helpers
imports no Zodvex, Mini imports no classic Zod, and profiles do not accidentally import
one another. It also verifies that the background models and registry entries remain
in reachable emitted code. These emitted bytes are diagnostic, not a memory metric.

## Correctness and telemetry

An independent wire oracle checks all returned values, optional fields, ordering,
payloads and checksum in the driver action. Separate bounded native metadata queries supply
SHA-256 reference hashes of ordered document IDs/creation timestamps. Every variant's
result must match that reference. Reference collection uses small indexed batches so
it can still prepare a reference when a measured single query exceeds its read limit.
The driver verifier's execution and client transport
are outside the measured query's server timer. If the verifier itself fails after a
successful query, that is a harness failure, not the library's capacity ceiling.

Each query has a unique run/sample argument and one log marker. The CLI's raw JSONL
Completion records are correlated by marker, query identifier and batch size. A
measured timing requires `cachedResult === false`; missing timing or collector failure
invalidates comparative timing claims. First-observed calls are recorded separately
and excluded. There is no observable proof of a fresh/warm isolate, so neither label
is promised. Query/mutation `Date.now()` cannot supply a useful handler timer here.

The standalone report prominently marks valid/invalid runs and shows usable timing
counts alongside missing telemetry and cache hits. Initial calls also participate in
validity checks. An attributable query capacity limit is a measured outcome; other
query errors and driver correctness failures invalidate the run. If module evaluation
fails before the marker, relevant raw completions and the observed error classification
are retained without guessing attribution; the run remains invalid for comparison.

The report records:

- `executionTime`: complete server execution duration, excluding the client round trip.
- `userExecutionTime`, when available: Convex's elapsed server timer excluding tracked
  system waits. It can include module initialization; **it is not OS CPU time**.
- Database documents/bytes read and returned bytes.
- Verified successes, errors and failure source, cache status, and missing telemetry.
- Median and interquartile range; paired native ratios within the same round/batch.

Convex's `memoryUsedMb` field is the configured heap allowance, not measured peak or
retained heap, and is intentionally not used as a memory-overhead measurement. See the
[runtime usage implementation](https://github.com/get-convex/convex-backend/blob/bbc3e3c8d03a75296fc00523d7849bf9ce0865c2/crates/isolate/src/environment/udf/mod.rs#L450)
and [user-time accounting](https://github.com/get-convex/convex-backend/blob/bbc3e3c8d03a75296fc00523d7849bf9ce0865c2/crates/isolate/src/timeout.rs#L365).
The hosted backend revision is not exposed by this runner; those links document the
semantics, not a claim that the hosted instance runs that exact commit.

## What can be published

Keep `manifest.json`, `results.json`, raw calls/completions, identity references and
graph manifests together. They record fixture hash, library commit and dirty state,
resolved dependency/bundler versions, target, timestamps, seed and invocation order.
Do not publish timing summaries from missing/cached telemetry or failed correctness.

A suitable claim names the workload, stack and sample range: “With this fixture,
Zodvex's 256-document export took X server milliseconds versus Y for manual conversion.”
An OOM at a larger batch is a failure for that operation/configuration, not a library
maximum. If every batch succeeds, report a lower bound at the largest tested batch.
If a read/return limit arrives first, the memory ceiling is unknown. Keep mixed
pass/fail outcomes and do not infer a precise transition from them.

Before making a release gate or strong public performance claim, repeat with another
order/run and, where relevant, another deployment/time window. Seven samples support
descriptive median/spread, not a credible p95 or universal regression percentage.
Consumer schemas/codecs and payload shapes remain additional workloads to validate;
this initial benchmark does not cover writes, pagination, concurrency, encryption,
cross-function codec calls, or dynamic model imports. Those should be small explicit
extensions with the same oracle and telemetry, not another broad table-ceiling sweep.
