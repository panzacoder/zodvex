# Local schema diagnostics

Run this from your application root with Node 22+ and your normal dependencies
installed:

```sh
npx zodvex inspect-schema > schema-report.json
```

The default input is `convex/schema.ts`. For another layout, pass the schema file:

```sh
npx zodvex inspect-schema packages/backend/convex/schema.ts > schema-report.json
npx zodvex inspect-schema --help
```

The input must default-export the result of `defineZodSchema`. Review and share
only `schema-report.json`. This experimental diagnostic runs locally and makes
no upload, account lookup, or deployment request. It requires neither codegen
nor a benchmark checkout. The Node 22 requirement applies to this diagnostic,
not to the rest of the library or CLI.

The command imports your trusted application schema in a normal local child
process, including its module initializers. That process has your environment
and filesystem/network access; the diagnostic is not a sandbox. It does not
parse documents, call codec/default callbacks, or resolve explicit `z.lazy`
callbacks. Object-shape evaluation can evaluate application field getters.

## Report contents

The `zodvex-local-schema-report-v1` JSON contains only:

- Runtime and dependency versions.
- Model count, unique schema instances, repeated references, schema kinds,
  object field slots, codecs, checks, and explicit callback references.
- Counts of unresolved lazy definitions, skipped field accessors, and
  unrecognized schema kinds, which mark an incomplete definition traversal.
- Three fresh Node-process import measurements: median/min/max changes in
  retained heap and external bytes, plus aggregate bundle bytes/module count.

It contains no table/field names, literal/default values, descriptions, paths,
source text, function bodies, or schema hashes. Application stdout/stderr are
discarded. Import/bundling errors produce a fixed diagnostic message on stderr,
a nonzero exit code, and no JSON report. The temporary bundle is removed after
inspection; bundles and raw heap snapshots do not belong in the support report.

## Interpreting the measurements

The definition census starts at the exported table map's `doc` and `insert`
schemas and deduplicates instances by identity. Reusing one schema is therefore
distinguished from constructing several identical schemas. The report separates
classic, Mini, and core implementations because equal definition counts do not
imply equal memory cost. Three imports must yield the same census.

Field slots count fields across distinct object schemas, including generated
document schemas, rather than distinct source fields. The census does not cover
every JavaScript object, helper schema retained elsewhere, registry entry, or
object captured in a codec closure. It does not recover the graph's topology.
`definitionTraversalComplete` refers only to this definition traversal.

The local import measurement happens before the census, after two GCs, while
the imported module remains reachable. It includes bundled libraries and
reachable application module state. It excludes the later traversal's
allocations, including object-shape evaluation. External bytes already include
ArrayBuffer bytes; do not add those fields.

The worker has a 512 MiB Node heap setting and a 20-second diagnostic timeout.
Bundling targets Node with Convex export conditions; it can differ from actual
Convex bundling/evaluation. A diagnostic failure is not a Convex capacity limit.
The measurements are not hosted isolate heap bytes, runtime peak allocation,
free hosted memory, or a prediction of whether an application will fit.

This report is a starting point for manual support triage and representative
synthetic workloads. It can indicate many distinct instances, substantial
wrapping/checks, large imported state, or incomplete traversal. None alone
identifies an OOM cause. Closure captures, dependencies, graph topology, and
endpoint behavior can differ even when aggregate counts are close. There is no
validated formula mapping the report to a supported model count or safe/unsafe
score.
