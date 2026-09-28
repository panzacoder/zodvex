# Memory experiment status

The target is to leave more memory for application work as unrelated models are
added, while preserving the behavior applications rely on. These experiments
extend the [benchmark foundation](memory-benchmarks.md) with consumer import
graphs and explicit correctness checks. They do not establish a universal model
limit or recommend changing the library's architecture.

> **WARNING: none of these historical experiments is a production-ready upgrade.**
> Smaller memory measurements do not compensate for lost codec behavior. An
> action that works does not establish query or mutation support.

| Experiment | Current disposition | Evidence |
| --- | --- | --- |
| [#80: generated descriptors](https://github.com/panzacoder/zodvex/pull/80) | **INCOMPLETE.** Codec-only descriptors change ordinary read semantics; union codec failures and default handling also need fixes. The isolated port has an additional patch integration gap. | [Correctness matrix and memory study](../../examples/stress-test/results/descriptor-experiment-2026-09-09/README.md) |
| [#84: dynamic model imports](https://github.com/panzacoder/zodvex/pull/84) | **ACTION MECHANISM ONLY.** Loading selected models works in V8 actions. Queries and mutations reject dynamic imports on the tested backend; current Zodvex database/registry integration is also unfinished. | [Module evaluation, memory and runtime checks](../../examples/stress-test/results/dynamic-import-experiment-2026-09-09/README.md) |
| [#63: compile away Zod](https://github.com/panzacoder/zodvex/pull/63) | **INCOMPATIBLE.** The real compiler drops argument decoding, return encoding, refinements and defaults. Excluded from memory ranking. | [Before/after compiler audit](../../examples/stress-test/results/compile-experiment-2026-09-09/README.md) |

## How to read the results

The descriptor and dynamic-import fixtures separately control the models used by
an operation and the unused background models. Their shapes differ, so compare
variants **within** a study. Do not rank their raw bytes against each other or
against older table-count sweeps.

Local Convex observations use the pinned official backend and fresh isolates,
with explicit GC after the measured operation. Reports include repeated samples,
actual model initialization, exact source/build/dependency identities and raw
evidence. These are retained object measurements, not peak memory or a direct
measurement of remaining hosted heap. Runtime canaries are labeled separately
from memory measurements and from mocked database operations.

The compile audit is a paired correctness experiment on the original compiler's
frozen dependencies. The current library is a separate compatibility control.
It makes no Convex deployment or memory claim: failing to preserve behavior is
enough to exclude its historical capacity claims from an equivalent comparison.

## What this inventory changes

Keep dynamic module loading as a candidate for reducing the cost of unused
models. Its action results give a concrete mechanism to discuss with Convex;
query/mutation support and a working asynchronous Zodvex integration are still
separate requirements.

Keep descriptors as an explicitly different contract proposal. Fix codec defects
and decide which ordinary validation/default behavior must survive before
presenting their smaller graph as an application improvement. The current
library remains the compatibility reference.

Leave compile-away parked until it can preserve codecs or reliably refuse to
compile unsupported functions. A smaller bundle produced by deleting required
behavior is not a capacity improvement for this library.

New proposals should name the behavior they preserve, the graph they avoid
initializing and the matched measurement that would demonstrate a benefit.
The [historical inventory](../../examples/stress-test/results/retrospective-2026-09-09/history.md)
also records closed #60 and the already-shipped slim/cache/Mini changes; this
study does not revive that combined branch or repeat the old ceiling searches.
