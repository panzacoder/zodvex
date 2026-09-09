# Runtime-selected model module experiment

> **WARNING — ACTION MECHANISM ONLY.** Query and mutation imports fail on the tested backend. Whole-consumer Zodvex integration is unfinished; these results do not describe a production-ready optimization.

This ports the useful mechanism from historical PR [#84](https://github.com/panzacoder/zodvex/pull/84): selecting a model module by a runtime table key and decoding through its schema. It replaces the retired 750-model application corpus with a bounded, explicit fixture. It does not add an asynchronous registry to Zodvex.

[Recorded local results](../results/dynamic-import-experiment-2026-09-09/README.md) include successful deployed V8 actions, actual query/mutation negative controls, emitted split-module audits, and repeated retained-heap observations.

## Cases and guarantees

The primary cases touch one model while declaring 0, 16, or 64 unused models. A fourth case touches eight models spread across 72 declared models, leaving 64 unused. Each model occupies a separate source module and constructs distinct schema instances.

Every model has 32 top-level fields. Eight repetitions contain a timestamp↔Date codec, a string↔SecretText codec, a nested discriminated union of a dated object or custom-class object, and an array of string-or-number values. Across the union alternatives there are 40 nested fields and 32 declared codec sites per model. SecretText is a small synthetic class, not encryption or an application-specific sensitive-value type. Default `defineZodModel` schema helpers remain enabled.

The models have no DB tables, seeded rows, or growing document workload. Every touched model performs the same 32-field manual conversion. Checks exercise Date and custom-class methods, both nested union branches, full wire round trips, wrong primitive inputs, invalid union input, invalid runtime output, and a wire-valid number (`1e100`) that cannot represent a valid Date.

| Endpoint | Imported graph | Operation and builder |
| --- | --- | --- |
| `static:probe` | Eager central registry imports all model modules | Native Convex V8 action; manual `decodeDoc`/`encodeDoc` against model insert schemas |
| `dynamic:probe` | Runtime-key map calls literal `import()` for selected modules | Same manual model operation and native action builder |
| `helpers:probe` | Only one required Zod schema | Actual `zCustomAction(action, NoOp)` from `convex-helpers/server/zod4`; manual Zod parse/encode of the same field shape |

The helpers control runs at unused=0 and unused=64, touched=1. Other model modules remain deployed but are not imported by its endpoint. Its emitted dependency closure must contain the helpers builder and no Zodvex dependency. It also has Zod argument/return validation, which the native action builders do not share. Therefore unused-model growth is the clearest comparison; total bytes do not compare identical production endpoint contracts.

Module initialization records a unique marker from each model module, independently of the requested key list. The oracle checks the complete before/after marker arrays. Static initialization must include every model before the handler; dynamic initialization must start empty and end with only the selected modules. References and schema field counts are read after GC so the required graph remains live.

## Local reproduction

Use the repository's frozen dependencies, build the current library, and select an explicit Node 22 executable. From `examples/stress-test`, start a dedicated official backend with the existing foundation launcher:

```sh
python3 memory/start-local.py \
  --binary=/absolute/path/to/convex-local-backend \
  --directory=/private/tmp/zodvex-dynamic-backend \
  --admin-key=/absolute/path/to/matching-admin-key \
  --source-revision=<known-backend-commit> \
  --port=3250 --site-port=3251
```

In another terminal:

```sh
mkdir -p results/local
/absolute/path/to/node22 consumer-dynamic-import/run.mjs \
  /private/tmp/zodvex-dynamic-backend results/local/dynamic-import-new-run
/absolute/path/to/node22 consumer-dynamic-import/evidence.mjs pack \
  results/local/dynamic-import-new-run
/absolute/path/to/node22 consumer-dynamic-import/evidence.mjs verify \
  results/local/dynamic-import-new-run
```

The runner accepts only a loopback backend with fresh isolates, exposed GC, and a recorded source revision. It generates temporary apps, deploys with `convex dev --once --typecheck enable`, exports the official CLI's split bundles from unchanged inputs, and invokes a deployed canary. There are at most 60 sequential calls, three repeats per retained-heap case, a three-minute request-loop budget, and no automatic retries. Dedicated local apps are replaced; no hosted deployment is selected.

Each case also runs unforced actions and both query/mutation controls. Dynamic query/mutation results are tested, not inferred from action success. The recorded backend rejects them as unsupported; a future successful result must pass the same result oracle. Unexpected failures invalidate the collection.

Two final explicit GCs run inside each measured handler. The collector waits for log quiescence, requires major testing GCs from one isolate, rejects reused measurement identities, and records the last positive `end_object_size`. This follows the [foundation method](../memory/README.md#local-convex-retained-heap). It measures retained local V8 objects/code, not external allocations, construction peaks, RSS, or hosted capacity. For helpers, this point precedes its wrapper's return validation/finalization; it is not a post-wrapper measurement.

The archive preserves exact generated source, generated server bindings, emitted modules, module hashes/import edges, GC excerpts, fixture descriptions, deployment output, canaries, and a snapshot of measurement code. Credentials, backend storage, and absolute private paths are excluded. `evidence.mjs verify` needs the result directory and repository measurement sources, but no running backend, credentials, or original temporary directory.

## Integration still missing

The full-model actions use `defineZodModel` plus manual conversion. They do not use the whole `initZodvex` endpoint registry, asynchronous `ctx.db` model discovery, automatic argument/return codecs, outbound function calls, rules, or audit hooks. No DB I/O, real foreign-key traversal, transactional dependency tracking, or reactive subscriptions are measured. The eight-key case is a runtime-selected multi-model control, not a database relationship walk.

Convex actions are a distinct execution context and access the database through queries/mutations; their successful imports do not establish transaction parity. See the [official action documentation](https://docs.convex.dev/functions/actions). A production optimization needs a separate consumer integration and query/mutation runtime support. The different union shape and separate-module topology also prohibit comparing these absolute bytes directly with the foundation's factory graph or historical PR #84 thresholds.
