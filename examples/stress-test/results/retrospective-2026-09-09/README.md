# Memory retrospective and customer-report trial

These experiments ask how much previous work improved memory use, and whether a
private application can provide a useful support report without sharing its
schema. They do not choose a new optimization or establish a universal capacity.

## Zod and the existing slim-model option

The same current Zodvex build, Convex backend, codec-rich fixture and measurement
code were tested with Zod 4.3.6, 4.4.3 and 4.5.4. Each cell has three independent
collections, pairing **16 background models of width 32** with a same-kind
zero-background-model control. Both retain one fixed probe model. All 144 calls
passed codec-output, graph, GC and source-hash verification.

| Zod version | Native | convex-helpers | Zodvex Full | Zodvex Mini |
| --- | ---: | ---: | ---: | ---: |
| 4.3.6 | 162,504 B | 20,255,864 B | 24,981,896 B | 9,688,552 B |
| 4.4.3 | 162,504 B | 12,227,704 B | 15,663,768 B | 9,679,000 B |
| 4.5.4 | 162,504 B | 2,452,320 B | 3,432,720 B | 2,657,520 B |

These are median **retained graph-growth deltas**, with default schema helpers
on, not total endpoint heap. Full decreased 86.26% from the repository's old
4.3.6 baseline, and 78.08% from 4.4.3. Mini decreased 72.57% and 72.54%
respectively. The framework/probe control itself grew with newer Zod, so the
percentage reduction in total retained memory is smaller; both quantities are
published in the [complete results](zod-and-slim/README.md).

With 4.5.4, the already-shipped `schemaHelpers: false` option lowered Full's
delta to **2,831,232 B (−17.52%)** and Mini's to **2,150,520 B (−19.08%)**.
The native/helpers ON/OFF rows are no-op controls. Full remains about 40% above
helpers in default graph growth, or about 15% with slim models, for this fixture.
Those are observable costs, not evidence of a current customer failure.

The [portable evidence](zod-and-slim/PORTABLE.md) contains all integer samples,
exact dependency locks, built-library identity, canonical/adapted collector
sources, every synthetic bundle and offline hash/oracle verification. The
ordinary same-environment comparator was not changed. Slim behavior was measured
as an option under one fixed current build; this does not separately attribute
the historical #57 table-map and cache changes. Those remain identified, with
their confounds, in the source inventory.

## Hotpot: before and after Zod 4.5

A fresh snapshot of Hotpot main resolves Convex 1.45.0, Zodvex 0.7.10 and Zod
4.4.3. The comparison changed only its application Zod resolution to 4.5.4;
Astro's separate Zod dependency stayed at 4.4.3. The application checkout was
restored afterwards. Neither Hotpot nor a hosted deployment was modified.

| Measurement | Zod 4.4.3 | Zod 4.5.4 | Change |
| --- | ---: | ---: | ---: |
| Median retained Node import delta | 6,118,336 B | 4,589,232 B | −24.99% |
| Median local Convex retained bytes above empty query | 6,411,128 B | 4,805,968 B | −25.04% |
| Node bundle bytes | 723,610 B | 903,230 B | +24.82% |
| Models / unique schemas / codecs | 12 / 353 / 11 | 12 / 353 / 11 | unchanged |

The complete definition census stayed identical. Bundle bytes increased while
retained memory decreased: source size alone would have predicted the wrong
direction for this change.
The dense synthetic graph improved by substantially more than this application.
That gap is observed, not attributed to topology, schema sharing or any single
cause by these experiments.

Node used three diagnostic runs per version, each containing three fresh imports.
The table is the median of those run medians, not nine independently published
raw samples. Each local Convex observation paired an empty query with a schema
import in separate fresh isolates, repeated three times. All query and major-GC
checks passed. The local Convex deltas ranged from 6,406,360–6,412,256 B before,
and 4,805,896–4,805,968 B after.

The local backend was the same May 6 official binary used by the current graph
benchmark; exact identity and aggregate observations are in
[`hotpot-aggregate.json`](hotpot-aggregate.json). The saved
[`collector`](measure-twelve-model-schema.mjs) measures this twelve-model schema
case and the independent twelve-model fixture. It retains the imported schema
through final GC and then verifies all table-map entries remain available.

These are **schema-only imports**, not Hotpot's complete endpoint registry,
request-processing peak, external memory, or hosted free heap. Node and Convex
measurements have different baselines and cannot be subtracted from one another.
Private source, module names, paths and schema hashes are absent from the public
artifact. The exact private snapshot and source bundles remain with the
maintainer, so the application-specific result cannot be independently
reproduced using public files alone. The synthetic experiments below can.

## Can a maintainer use only a customer's report?

An independent reviewer received only the first sanitized Hotpot report, public
Zodvex code and the diagnostic contract. It had no access to Hotpot source,
history, lockfile, names, literals or callback bodies. It constructed a neutral
fixture with working codecs, then made one revision to represent ordinary shared
text schemas. Neither heap padding nor bundle-size tuning was allowed.

| Metric | Customer report | Independent fixture |
| --- | ---: | ---: |
| Models | 12 | 12 |
| Unique schemas | 353 | 351 |
| Repeated references | 138 | 132 |
| Object field slots | 314 | 312 |
| Codecs | 11 | 11 |
| Checks / callback references | 49 / 89 | 52 / 81 |
| Node import delta | 6,120,856 B | 5,299,640 B |
| Local Convex delta above empty query | 6,411,128 B | 5,570,680 B |

Ten of fifteen schema-kind counts matched exactly. All eleven codec round trips,
invalid codec inputs and representative document checks passed. The synthetic
fixture nevertheless used **13.42% less Node heap** and **13.11% less local Convex
heap**. Matching aggregate counts does not reconstruct topology, captured state,
dependencies or registry reachability. For example, the report does not currently
include convex-helpers' version, and the independently resolved version differed.
No part of that unexplained gap is attributed to a specific cause.

This validates the report as a useful starting point for a manually constructed
benchmark case. It does not validate a capacity prediction or exact reproduction.
The fixture, first attempt, reports, locked dependencies, behavior verification
and assumptions are in [`report-only/`](report-only/PROVENANCE.md). Use the small
report first; add aggregate fields only when a support case demonstrates a need.

## The older Convex analysis problem

The same 256-module, 32-field-per-module application failed with a deployment
analysis OOM **3/3 times** on the official pre-fix backend, then deployed and
passed endpoint checks **3/3 times** on the post-fix backend. Everything ran
locally, with the same CLI and Zod versions and no database operations.

See [`module-analysis/`](module-analysis/README.md) for the generator, exact
binaries, raw results and distinction between many-module analysis and the
remaining memory cost of one endpoint's imported graph. This corroborates a
platform improvement that the previous table-ceiling reports mixed with runtime
capacity.

## What has shipped, and what remains experimental?

The [source inventory](history.md) identifies exact before/after commits. Mini,
mapper memoization, slim models, the reduced doc/insert table map, shared helper
caches and the Zod dependency upgrade are on main. Their merge commits are not
all single-variable experiments.

PR #60's deferred table map and asynchronous registry thunk **did not merge**.
The descriptor architecture in #80 and action dynamic-import experiment in #84
remain unmerged. Archived claims that those mechanisms already solved main's
runtime graph cost are incorrect. The old harness in #81 merged, but its favorable
early results had consumer-import and runtime-validation confounds documented in
the inventory.

## Keeping results comparable

Store reviewed Markdown plus versioned JSON and compressed raw evidence in this
repository. This is sufficient for a static documentation page and preserves
reviewable history; a benchmark database is not needed for the current volume.
Keep three separate series: fixed-environment library regressions, intentional
dependency/backend retrospectives, and private-application support reports.

Use the [existing strict comparator](../../memory/comparison.md) for ordinary
library changes. It deliberately rejects changed dependency/backend identities.
Retrospectives must name the changed variable and preserve their own complete
inputs instead of weakening that safeguard. Keep original observations when a
collector or fixture changes; start a new series rather than silently replacing
the baseline. No new runtime optimization is selected by these results.
