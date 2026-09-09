# Model graph memory and capacity — 2026-09-09

**The model graph alone can still exhaust a Convex query's memory.** This benchmark
finds a Full Zodvex failure where native Convex, helpers and Mini succeed, with zero
database reads and an identical tiny codec operation. It also measures the graph's
retained weight in an official local Convex backend.

These are results for a specified factory-generated graph. They are not a universal
maximum number of models. [Methodology and commands](../../memory/README.md) explain
the controls and limitations. The earlier [codec workload results](../capacity-2026-09-09/README.md)
answer a separate question; their read-limit control did not establish graph headroom.

## Same count, different model weight

Each cell below has **512 background models plus one fixed probe model**, zero
registry entries, and three query calls. A width-32 background model has 32 top-level
fields, 48 total fields including nested objects, and 24 codec sites. Width 8 uses
the same four-field pattern at one quarter the width.

| Variant | Width 32 | Width 8 |
|---|---|---|
| Native Convex | 3/3 pass | Not run hosted |
| convex-helpers/Zod | 3/3 pass | Not run hosted |
| Zodvex Full | **3/3 query OOM** | **3/3 pass** |
| Zodvex Mini | 3/3 pass | Not run hosted |

The final width-32 control took **23.0 seconds for 12 calls**; the width-8 control
took **6.9 seconds for three calls**, including bundling/transport. Neither required
a deployment push or database I/O. These are experiment durations, not server
performance timings or complete billing estimates.

The graphs were constructed inside the query so these failures are demonstrably
**query execution**, not upload-time module analysis. A separate ordinary deployed
query calibration reproduced Full's 512-model query OOM three times while the
other three variants passed three times with construction in the same phase.
Those calls used unique arguments. No forced GC was used in hosted tests.

## Capacity brackets for the large shape

Exploratory bounded searches established these repeated endpoints. Counts are
background models; add one for the probe. Intermediate counts are not certified.

| Variant | Query passes | Query OOM | Repetitions at each endpoint |
|---|---:|---:|---:|
| Full | 416 | 448 | 3 |
| Mini | 544 | 576 | 3 |
| Helpers | 576 | 608 | 3 |
| Native | 8,192 | Not found | 1 success; lower bound only |

Top-level construction produced the same coarse brackets, but its failures were
in **one-off module analysis**. Keep those observations separate. An ordinary
deployed Full query with 416 statically initialized background models also passed
three times. No read, return-size, or execution-time limit explains these OOMs.

The early search logs retain responses and prototype source, but lack the final
runner's per-call timestamp/source-hash provenance. Treat these as exploratory
brackets. The fully archived final controls above reproduce the central runtime
failure and the model-weight distinction.

## Actual retained bytes on local Convex

These observations use an official local backend, fresh isolates, and explicit
final GC. Each entry is the retained V8 object-byte **increase from adding 128
background models**, compared with the same variant's fixed-probe-only control.

| Variant | Width 8, MiB | Width 32, MiB |
|---|---:|---:|
| Native | 0.28 | 0.99 |
| Helpers | 4.84 | 17.82 |
| Full | 9.70 | 24.62 |
| Mini | 7.36 | 18.87 |

For example, Full retained 4,888,488 object bytes with only the probe and
30,705,792 with 128 width-32 background models: an additional **25,817,304 bytes**.
These are individual diagnostic observations, not confidence intervals or an
exact peak allocation measurement. The summaries preserve integer byte readings.

This establishes that larger models consume more of the heap, and quantifies the
retained cost for each representation. It does **not** reveal hosted free memory
in MiB. Forced GC, construction peaks, code/external allocations, and backend
version prevent converting these readings into `64 MiB minus graph = headroom`.
The hosted success/failure bracket measures usable capacity for the named query.

## Scope and versions

All cases use distinct schema instances but share one factory's code. They retain
models, source schemas and builders; Full/Mini use real `defineZodModel` and
`initZodvex` with default schema helpers on. Native and helpers deliberately retain
the whole graph for a matched representation comparison. Consumer applications
using them may import less. Native does not provide all Zodvex's guarantees.
This experiment does not include a growing function registry or separately authored
module/code graph, and does not claim that the synthetic shape represents Hotpot.

- Zodvex library source: `ad4a23241b7a351e2406fe555283f9e81591139a` (main build;
  package metadata still says 0.7.10, not a measurement of published 0.7.10).
- Convex 1.32.0, convex-helpers 0.1.113, Zod 4.5.4, Convex's esbuild 0.27.0, Bun 1.3.9.
- Hosted: `lovable-donkey-430`, `panzacoder/zodvex-stress-harness`; actual hosted
  backend revision and isolate reuse/placement are not observed.
- Local: official macOS ARM64 binary `precompiled-2026-05-06-8bc6aa4`, source
  `8bc6aa4645adfd66584034b175dbef96536938b8`; binary SHA-256 in the summary.
  This is a known local runtime, not an assertion about today's hosted version.

## Evidence and next comparison

[summary.json](summary.json) holds outcomes and integer bytes.
[evidence.tar.gz](evidence.tar.gz), checked by [SHA256SUMS](SHA256SUMS), includes
the final query bundles, manifests, raw calls, per-query GC excerpts, ordinary
deployed query sources, and clearly separated exploratory evidence. It contains no
credentials or environment files. See its `PROVENANCE.md` for later driver changes
and the supplemental provenance for early local manifests. After extraction,
`bun verification-performed.mjs` rechecks saved outputs and final bundle hashes.

Independent verification accepted 90 successful outputs and confirmed 42 memory
error responses across the curated experiments; all final emitted-source hashes
matched. Memory failures remain failures, rather than being discarded from results.

Use **retained bytes at fixed shape and the repeated hosted query bracket** to
judge graph optimizations. The first useful target is reducing Full's retained
cost and reaching the helpers success bracket for this fixture, while preserving
the codec oracle. A future real consumer graph should become another named fixture.
Avoid treating a three-sample boundary as a universal supported model limit or a
hard release gate before repeating across time.
