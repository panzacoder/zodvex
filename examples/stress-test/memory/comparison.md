# Compare memory before and after a change

The [initial six-collection repeatability check](../results/repeatability-2026-09-09/README.md)
exercises this protocol without changing the library, to observe measurement variation.

Use the same graph and the same local Convex backend to measure the built library
before and after an optimization. Start with **128 background models, width 32,
`codec-rich`**. This has one additional fixed probe model, zero registry entries,
static initialization and explicit final GC. Changing the fixture answers a
different question and needs its own baseline.

Build the baseline library with frozen dependencies. Start the diagnostic backend
as described in [the memory benchmark](README.md#local-convex-retained-heap), then
run this command **three times**, saving each printed `Evidence:` directory:

```sh
bun memory/local.mjs /private/tmp/zodvex-memory-backend 128 32 codec-rich
```

Each collection makes eight calls: a zero-background-model control and a 128-model
observation for each of native, helpers, Full and Mini, using fresh isolates.
Build the candidate library, preserve the dependencies and backend, and run the
same command three more times. Keep the fixture and collector files identical
across both builds. There is no requirement to deploy, publish or make a release.

From `examples/stress-test`, compare the explicit directories:

```sh
bun memory/compare.mjs \
  --baseline=/path/base-1,/path/base-2,/path/base-3 \
  --candidate=/path/candidate-1,/path/candidate-2,/path/candidate-3

# Save a machine-readable report; the comparison itself only reads evidence.
bun memory/compare.mjs \
  --baseline=/path/base-1,/path/base-2,/path/base-3 \
  --candidate=/path/candidate-1,/path/candidate-2,/path/candidate-3 \
  --json > comparison.json
```

For each variant, the comparator first subtracts its own zero-model control in
each collection, then reports the median and observed minimum/maximum of those
deltas, the candidate's absolute and percentage change, and average bytes per
background model. It accepts one collection per side for an initial check and
labels fewer than three repeats. Three repeats give a first view of variability;
the range is not a confidence interval. Repeating an evidence directory does not
create another sample and is rejected.

A negative change means fewer retained object bytes. Small changes within the
observed variation need another baseline/candidate repetition. Keep the native
and helpers controls visible when interpreting Full or Mini changes. This command
has **no performance threshold**: it exits unsuccessfully only when evidence is
invalid or incompatible. A zero baseline delta has no defined percentage change.
Bytes per model is an average at this count, not a general application sizing rule.

## What must match

The comparison checks these values before reporting numerical changes:

| Evidence | Required match |
|---|---|
| Fixture | Count, width, profile, entries, initialization and GC mode; hashes of `profile.mjs` and `bundle.mjs` |
| Measurement | Hashes of `local.mjs`, `oracle.mjs` and `start-local.py` |
| Dependencies | Resolved Convex, convex-helpers, Zod and esbuild versions |
| Backend | Binary SHA-256, recorded source revision, GC flags and fresh-isolate policy |
| Driver runtime | Bun/Node compatibility version, platform and architecture |
| Repeats within one side | Same Zodvex version and built-JavaScript digest |

The Zodvex version and build digest may change **between** baseline and candidate.
Git commit/status are recorded for context; the digest identifies the actual
JavaScript files in the resolved Zodvex `dist` directory, excluding declarations
and source maps. It does not claim the build is fresh from checkout HEAD. The
collector checks that build, dependencies and measurement identities stayed
unchanged during collection. Process IDs, backend paths and loopback ports do not
affect compatibility. Test and report edits do not change the fixture identity.

Every accepted collection must have a valid completion summary, all eight distinct
measurements, matching manifest/call hashes, saved bundles with matching hashes,
successful codec-oracle results and consistent major-GC records. The comparator
recalculates the deltas from calls. Interrupted collections and older evidence
without this completion/provenance format require a new collection; do not fill
missing metadata with guesses. If dependencies or the runtime change, collect a
new baseline with that same environment before attributing a change to Zodvex.

## Check the other questions separately

Local retained bytes are the first comparison for graph-memory changes. For a
meaningful improvement, also repeat the same hosted passing/failing counts three
times with the existing memory runner, preserving query versus analysis failures
and mixed outcomes. Hosted backend revision and isolate placement are unobserved,
so an old hosted result is context; a fresh baseline and candidate comparison is
stronger evidence. All-pass counts remain lower bounds, not certified maxima.

Use the [codec workload benchmark](../capacity/README.md) if the change affects
document operations. Keep its fixture hash, batch sizes, payload, dependencies
and seven-round protocol fixed; compare median/IQR, paired native ratios and
failures together. This local-memory comparator does not combine those timings
or hosted failure brackets into a score, and retained local bytes do not reveal
hosted free MiB or construction peaks.
