---
name: migrate-convex-helpers-zod3
description: Use when assessing or trialing a Convex application's migration from convex-helpers with Zod 3 to Zodvex, including teams returning after memory-related deployment failures.
---

# Try Zodvex in an existing Zod 3 application

Produce a reversible migration trial and an evidence-based recommendation. Preserve
the application's behavior, stored representation and authorization. A passing
endpoint pilot is progress; it does not establish full application capacity.

## Establish the comparison

Read the application's instructions, package manifests and lockfile, Convex schema,
function setup and relevant tests. Determine which imports really use Zod 3,
including shared workspace packages and the installed helpers implementation.
Record resolved Zod, Zodvex, helpers and Convex versions, runtime, baseline commit
and existing test failures. Use the project's package manager and test commands.
Verify the runtime inside the trial directory; directory-specific version
managers can select a different Node version there.

If the team previously left Zodvex, distinguish its current helpers/Zod 3 app from
any archived Zodvex revision. Ask only for missing information that affects the
trial: the previous failure stage, desired scope and any approved dev deployment.
An old OOM report is not evidence that the current versions still fail.

Work in a branch or isolated checkout consistent with the user's instructions.
Keep the baseline reproducible. Pin the target packages or maintainer-supplied
tarball; record its identity. Do not change unrelated dependencies to make the
comparison easier. Run the relevant baseline checks before changing application
code.

## Migrate a representative slice

Read [compatibility.md](references/compatibility.md) before changing imports or
builders. Start with a real authenticated query/mutation pair and the schemas
they actually use. Include a default, union, transformation or custom wrapper if
the application relies on one. Avoid inventing features merely to make a demo.

Endpoint adoption can retain native Convex tables and database access. Use the
current public `zCustomQuery` / `zCustomMutation` builders with the application's
existing customization. Keep old schemas explicitly on `zod/v3` and migrated
schemas on `zod/v4`, after checking dependency compatibility. These schema
instances cannot be mixed in one shape.

Treat model/database adoption as its own step. Preserve table names, wire types,
indexes and application checks; then verify decoded reads and encoded writes.
Native tables cannot simply be mixed into `defineZodSchema`. Do not introduce
manual internal table maps or cast native schemas into `initZodvex`.

Run paired behavior checks on the selected operations, including rejected inputs,
authorization, omitted versus null fields, defaults, returns and any success
hooks. Resolve unintended changes instead of weakening assertions. Record an
intentional behavior change for the user to assess. Continue unaffected work if
one slice is blocked. Expand to the remaining application when that is within
the requested scope.

## Measure the candidate honestly

Read [evidence.md](references/evidence.md) for diagnostic availability, privacy
and deployment comparisons. Inspect the actual modeled schema when available;
label a partial conversion as partial. Helpers-only/native schemas do not work
with `inspect-schema`. Its local report cannot certify hosted memory capacity.

For local-only requests, report deployment checks as unperformed; no deployment
target question is needed. Otherwise use already approved dev deployments for
the baseline/candidate comparison. If
no target is authorized, finish local work and request the missing target before
deploying. A trial does not require a production push, customer-data export or
deleting existing rows. Keep bounded runtime checks representative of the app.

## Deliver the trial

Provide a reviewable diff and concise report containing:

- **Scope:** endpoints/tables migrated, remaining Zod 3 usage and excluded paths.
- **Identity:** baseline/candidate revisions and resolved dependency/build versions.
- **Behavior:** checks run, results and each unresolved semantic difference.
- **Performance evidence:** report scope, measured quantities, deployment/runtime
  outcomes and checks not performed. Keep local memory separate from hosted results.
- **Recommendation:** continue, ready for app review, or blocked by a named issue;
  include how to return to the preserved baseline.

Keep source, endpoint names, logs and diffs local by default. Prepare the aggregate
diagnostic JSON and a separately reviewed summary for sharing; sending them is a
separate action from preparing the migration.
