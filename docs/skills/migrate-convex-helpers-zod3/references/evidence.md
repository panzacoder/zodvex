# Collecting useful evidence

## Package and command availability

`inspect-schema` landed after the **v0.7.10 release**. Main initially retained that
package version, so a version string is insufficient. Use the project's locally
installed Zodvex executable and check its help before invoking the command. Do
not let an unpinned package-runner download silently select the candidate.

If the command is absent, use a maintainer-supplied release or built tarball that
contains it. Record the package version, full source commit and SHA-256 of the
actual tarball; disclose any uncommitted build changes. The inspector's dependency
version alone cannot distinguish two builds labeled `0.7.10`. Otherwise mark
the diagnostic unavailable and continue compatibility checks. A source checkout
must be built and packaged first; a local package-manager link can resolve a
different Convex dependency tree and cause misleading nominal-type errors.

## Local schema report

Use **Node 22+**, the application's installed dependencies and its actual
`defineZodSchema` default export. For example, with a local executable available:

```sh
./node_modules/.bin/zodvex inspect-schema convex/schema.ts > schema-report.json
```

Adapt the executable/input paths to the workspace layout. The command does not
support Bun as its runtime. It cannot inspect a helpers-only/native Convex schema;
do not create dummy models or undocumented table-map adapters to make a baseline
look comparable. A partial modeled candidate reports only that candidate's scope.

The command bundles and imports the trusted schema in fresh local Node processes.
Schema module initializers can execute application code with the user's local
environment and permissions. The diagnostic itself does not deploy or upload.
Review import side effects before running it on an unfamiliar app.

The output includes dependency/runtime versions, aggregate schema/codec/check
counts, traversal coverage, bundle/module totals and three retained-memory import
measurements. It excludes field/table names, literal values, source, file paths
and schema hashes. Application stdout/stderr are discarded. Review the output
before sharing; keep source, bundles, environment files and raw heap snapshots
local.

Interpretation:

- Node retained heap is an import proxy, not hosted isolate memory, peak usage or
  remaining headroom. A report does not predict whether the app fits.
- Aggregate counts do not reconstruct dependencies, closure captures or module
  topology. Incomplete traversal makes the definition census partial.
- A schema import does not necessarily include the function registry, auth/client
  imports or all state retained by a real endpoint.
- Do not compare a native-only schema's bytes with a full modeled schema and call
  it equal coverage. Do not sum heap and external bytes into a hosted budget.

The [diagnostic guide](https://github.com/panzacoder/zodvex/blob/main/docs/guide/schema-diagnostics.md)
defines the exact report contract. This JSON is a starting point for a maintainer
to construct representative synthetic fixtures, not a schema reconstruction.

## Deployment and runtime checks

Distinguish dependency installation/type checking, deployment analysis, schema
validation and function execution. Record the failed stage and a reviewed error
summary. Avoid repeating deployments merely to seek a failure threshold.

For an authorized dev deployment, compare preserved baseline and candidate using
the same target and a bounded, relevant workload. Record CLI/dependency versions,
local backend revision if applicable, candidate commit, commands and outcomes.
Do not attribute a historic Cloud failure to today's backend or infer the backend
revision from the CLI version. Report environment/data differences that prevent
a matched comparison.

A representative check should call real authenticated queries/mutations with
synthetic or approved existing rows, confirm wire outputs, and verify any
modeled codec operations. Native validation and serialization must be exercised
before claiming deployment compatibility. Clean up only rows the trial creates.
Do not turn off validation, unwrap DB codecs or reduce fixture coverage merely to
obtain a passing memory result.

The old table-count ceilings are not current limits. Convex changed deployment
analysis and Zod 4.5 reduced allocations; neither proves that an arbitrary customer
application now fits. A current successful deployment plus representative runtime
checks establishes that tested app/workload, not a universal capacity promise.

## Shareable handoff

Prepare `schema-report.json` when available and a short, reviewed summary of:

1. Baseline/candidate dependency versions and trial coverage.
2. Whether installation, local behavior, deployment and runtime checks passed.
3. Any semantic blocker, failed stage or skipped measurement.
4. Which measured quantities changed under a matched comparison.

Endpoint/table names, source revisions for private apps, raw error paths and logs
can identify the application. Keep those in the private working report unless
the customer chooses to share them. No account credentials or schema export is
needed for the aggregate report.
