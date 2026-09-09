# Measuring schema memory

Zodvex's memory cost depends on the schema graph an endpoint imports and retains.
Table count, source size and bundle bytes are useful context, but none is a
general memory limit. In the
[Hotpot retrospective](../../examples/stress-test/results/retrospective-2026-09-09/README.md),
upgrading Zod increased bundle bytes while reducing retained schema-import heap
by about 25% in both Node and local Convex.

## Published evidence

| Study | Question answered |
| --- | --- |
| [Model graph memory](../../examples/stress-test/results/memory-2026-09-09/README.md) | Retained bytes for native, helpers, Full and Mini; bounded hosted query pass/OOM observations at declared shapes |
| [Repeatability](../../examples/stress-test/results/repeatability-2026-09-09/README.md) | Variation across six unchanged-build collections using the regression comparison protocol |
| [Historical improvements and support reports](../../examples/stress-test/results/retrospective-2026-09-09/README.md) | Zod/slim-model effects, the Convex analysis fix, and a report-only reconstruction trial |
| [Codec workloads](../../examples/stress-test/results/capacity-2026-09-09/README.md) | Cost of processing documents and database read limits, separate from imported graph memory |

The studies include machine-readable results, exact measurement scope, pinned
dependencies and backend identities, and reproduction material. Private
application examples expose aggregates only; public synthetic fixtures provide
independently reproducible cases.

## Comparing a library change

Use the [comparison protocol](../../examples/stress-test/memory/comparison.md):
three baseline and three candidate collections, each pairing a fixed model graph
with its own zero-background-model control. The collector uses actual local
Convex V8 retained-object measurements after explicit GC in fresh isolates.

Keep graph shape, dependencies, backend and measurement code fixed. Record the
actual built JavaScript digest so two builds with the same package version cannot
be mistaken for the same implementation. The offline comparator rejects missing,
invalid or incompatible evidence before producing median changes and ranges.
Intentional Zod/backend upgrades belong to separately labeled experiments, with
the changed variable explicit. Start a new baseline when measurement code or the
fixture changes; preserve previous records.

Retained object bytes are not peak memory, external allocations or remaining
hosted heap. A meaningful capacity claim needs a bounded execution experiment
with the same graph and workload, successful codec behavior, repeated outcomes,
and the failure phase recorded. Re-run a few informative passing/failing cases
when needed; a large deployment sweep is not a prerequisite for ordinary fixes.

## Investigating an application's report

The [local schema diagnostic](../../examples/stress-test/memory/customer-diagnostic.md)
runs without a Convex account or deployment and emits a small report that a
developer can inspect before sharing. It records schema counts and sharing,
implementation and dependency versions, unresolved definitions, bundle bytes,
and repeated local Node import measurements. It includes no schema names,
literal values, paths, source or application logs.

A maintainer can use that report to hand-author a neutral fixture and measure it
with the public benchmark. The first report-only trial matched the input's
schema counts closely but retained about 13% less memory in both Node and local
Convex. That is a useful test case, not a reconstruction or a fit/no-fit verdict.
Captured codec state, imported dependencies and endpoint registries remain
relevant even when the definition census is complete.

Keep reviewed results as Markdown, versioned JSON and compressed evidence in the
repository. These files can back a static website without a benchmark service.
For now, review measurements rather than enforcing a percentage performance gate;
retain the native/helpers controls and investigate changes beyond observed noise.
