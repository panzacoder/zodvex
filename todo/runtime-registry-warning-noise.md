# Runtime "No registry entry" warning is noisy and non-actionable

## Problem

`boundaryHelpers.ts:encodeArgs()` emits a `console.warn` on **every invocation** of a function that has no registry entry:

```
[zodvex] No registry entry for "visits/dropIn:create" — args will not be codec-encoded. Run `zodvex generate` to update the registry.
```

This fires at runtime in the client boundary layer, not at codegen time. It produces repeated log noise in tests and would do the same in production.

## Why it's wrong

A missing registry entry can mean two things:

1. **Codegen wasn't run** — actionable, but a dev-time concern
2. **The function intentionally uses raw Convex primitives** (e.g. `mutation()` instead of `zm`) — not a bug, no fix needed

In case 2 (which is the case for hotpot's `visits/dropIn:create`), the warning is incorrect — it tells the developer to run `zodvex generate`, but regenerating won't help because the function has no `__zodvexMeta` and never will.

In both cases, a per-call `console.warn` is the wrong severity and frequency.

## Observed in

hotpot `bun test` on `main` — `patientDropIn.test.ts` logs the warning twice per run for `visits/dropIn:create`, which intentionally uses raw `mutation()` because the endpoint is unauthenticated.

## Suggested fix

Options (not mutually exclusive):

- **Deduplicate**: warn once per path per process, not on every call
- **Downgrade to debug**: if codegen ran and excluded the function, that's the authoritative signal
- **Make it opt-in**: a `strict` mode in zodvex config that elevates this to a warning; silent by default
- **Distinguish "not discovered" from "not generated"**: if codegen actively skipped a function (no meta), don't warn at runtime about it
