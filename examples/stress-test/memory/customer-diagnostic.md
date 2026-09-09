# Local schema diagnostic for support

This experimental command gives a developer an aggregate report about their own
schema without sending the schema to us or using a Convex deployment. It is a
starting point for a support conversation, **not a prediction that an application
will fit in a hosted isolate**.

Use Node 22+ and a checkout containing this script. The application must have its
normal dependencies installed, including Convex. The script resolves the bundler
from the application's installed Convex package; it does not require installing
the benchmark workspace or running codegen.

```sh
cd /path/to/your-project
node /path/to/zodvex/examples/stress-test/memory/inspect.mjs \
  /path/to/your-project/convex/schema.ts > schema-report.json
```

The input must default-export the result of `defineZodSchema`. Review and share
only `schema-report.json`. The script makes no upload, account lookup or deployment
request. It writes its temporary bundle into an OS temporary directory, then
removes it. Neither bundles nor raw heap snapshots belong in the support report.
No package release or public `zodvex` CLI command is added by this experiment.

The [first report-only trial](../results/retrospective-2026-09-09/README.md)
used Hotpot's sanitized report to construct an independent working fixture.
Counts matched closely, while retained memory remained about 13% lower in both
Node and local Convex. That supports manual triage, not capacity prediction.

The JSON contains only:

- Runtime and dependency versions.
- Model count, unique schema instances, repeated references, schema kinds,
  object field slots, codecs, checks, and explicit callback references.
- Counts of unresolved lazy definitions, skipped field accessors, and unrecognized
  schema kinds; these mark an incomplete definition traversal.
- Three fresh Node-process import measurements: median/min/max change in retained
  heap and external bytes, plus aggregate bundle bytes/module count.

It contains no table/field names, literal/default values, descriptions, paths,
source text, function bodies, or schema hashes. Application stdout/stderr are
discarded. Import/bundling errors produce a fixed diagnostic message and no JSON
report; raw error messages are not copied into a support artifact. Tests cover
both successful and failing imports with private names, values and log messages.

## What the numbers mean

The **definition census** is deterministic for deterministic module initialization:
three separate imports must yield the same census. Instances are deduplicated by
identity, so reusing a schema is distinguished from constructing identical copies.
The report separates classic, Mini and core schemas; equal definition counts do
not imply equal memory cost across those implementations.

Traversal starts at the exported table map's `doc` and `insert` schemas. It is not
a census of all JavaScript objects, helper schemas retained elsewhere, registry
entries, or objects captured inside codec closures. Those are important reasons
not to convert a schema count into a claimed heap size. Field slots count fields
across distinct object schemas, including generated document schemas, rather than
claiming to count distinct source fields.

The **local import measurement** occurs before the census, after two GCs, while
the imported module remains reachable. It measures the import's retained Node heap
change, including bundled library code and reachable application module state.
It excludes the later traversal's allocations. External bytes include ArrayBuffer
bytes; do not add those fields. The worker has a 512 MiB Node heap setting and a
20-second diagnostic timeout: a diagnostic failure is not a Convex capacity limit.

Bundling targets Node with Convex export conditions. It can differ from actual
Convex bundling/evaluation. The local process has Node's runtime and GC policy,
not the hosted isolate's memory allowance. Record the version and observed range;
do not convert this delta to free hosted MiB or a supported model count.

Importing runs the application's trusted module initializers in a normal local
child process with its environment and filesystem/network access. The diagnostic
is not a sandbox. It does not parse documents or call codec/default callbacks.
It also does not resolve explicit `z.lazy` callbacks. Zod 4.5 can evaluate object
field getters when exposing a shape; those shape evaluations are counted and
happen after heap measurement. Any data access in the application's initializers
or getters remains application behavior, not something this tool can forbid.

## How this helps decide what to improve

The synthetic benchmark already demonstrates that both model width and schema
implementation affect weight. The customer report lets us learn whether a real
case involves many distinct schema instances, heavy nesting/wrapping/checks,
large imported module state, or definitions the census cannot resolve. None of
those observations alone identifies the cause of an OOM.

We do not yet have a validated formula mapping this report to hosted capacity.
The width-8/width-32 measurements are too narrow to fit a trustworthy general
predictor, particularly for arbitrary codec closures and function registries.
Before adding a safe/unsafe score, validate proposed predictors against additional
independent fixtures with measured Convex retained bytes and runtime boundaries.
Reports from developers can guide those fixtures without disclosing their schemas.

For lazy module initialization, total schema weight is only half the question.
The next mechanism experiment must hold the declared application graph fixed and
vary **models actually initialized/touched by one endpoint**. Compare identical
operations and codec results in eager and lazy cases, and observe construction
or module-evaluation counts. The current eager graph fixture cannot prove that
lazy imports will work in queries; the earlier action experiment is supporting
evidence for a separate Convex-runtime hypothesis. No optimization is selected by
this diagnostic.
